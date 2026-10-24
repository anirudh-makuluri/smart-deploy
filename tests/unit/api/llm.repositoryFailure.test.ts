import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), token: vi.fn(), repository: vi.fn(), llm: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/githubAccessToken", () => ({ getGithubAccessTokenForUserId: mocks.token }));
vi.mock("@/github-helper", () => ({ getRepoFilePaths: mocks.repository }));
vi.mock("@/lib/llmProviders", () => ({ callLLMWithFallback: mocks.llm }));
import { POST } from "@/app/api/llm/route";

function request() {
	return new Request("http://localhost/api/llm", { method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ full_name: "team/app", branch: "feature/tools" }) });
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.session.mockResolvedValue({ user: { id: "actor" } });
	mocks.token.mockResolvedValue("local-test-token");
	mocks.repository.mockResolvedValue({ filePaths: ["package.json"], fileContents: { "package.json": "{}" } });
	mocks.llm.mockResolvedValue({ text: "analysis" });
});
afterEach(() => vi.restoreAllMocks());

describe("repository inspection before model invocation", () => {
	it("returns a controlled failure without invoking a model when inspection fails", async () => {
		const actual = await vi.importActual<typeof import("@/github-helper")>("@/github-helper");
		mocks.repository.mockImplementationOnce(actual.getRepoFilePaths);
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({ message: "Resource not accessible" }, { status: 403 }),
		);
		const response = await POST(request());
		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({ error: "Repository inspection failed. Check GitHub access and retry." });
		expect(mocks.llm).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("uses the selected branch and only invokes the model after metadata is available", async () => {
		const response = await POST(request());
		expect(response.status).toBe(200);
		expect(mocks.repository).toHaveBeenCalledWith("team/app", "feature/tools", "local-test-token");
		expect(mocks.llm).toHaveBeenCalledWith(expect.stringContaining("package.json"), expect.any(Object));
	});

	it("does not inspect a repository or invoke a model without a connected identity", async () => {
		mocks.session.mockResolvedValue(null);
		expect((await POST(request())).status).toBe(401);
		expect(mocks.repository).not.toHaveBeenCalled();
		expect(mocks.llm).not.toHaveBeenCalled();
	});
});
