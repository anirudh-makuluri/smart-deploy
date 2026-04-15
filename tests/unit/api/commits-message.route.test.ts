import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getGithubAccessTokenForUserIdMock = vi.fn();
const getCommitMessageFromGitHubMock = vi.fn();

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

vi.mock("@/lib/githubAccessToken", () => ({
	getGithubAccessTokenForUserId: (...args: unknown[]) => getGithubAccessTokenForUserIdMock(...args),
}));

vi.mock("@/lib/githubCommitMessage", () => ({
	getCommitMessageFromGitHub: (...args: unknown[]) => getCommitMessageFromGitHubMock(...args),
}));

describe("POST /api/commits/message", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 if access token is missing", async () => {
		getSessionMock.mockResolvedValue(null);
		const { POST } = await import("@/app/api/commits/message/route");
		const res = await POST(new Request("http://localhost", { method: "POST", body: "{}" }) as any);
		expect(res.status).toBe(401);
	});

	it("returns 400 when repoUrl is invalid", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		getGithubAccessTokenForUserIdMock.mockResolvedValue("t");
		const { POST } = await import("@/app/api/commits/message/route");
		const res = await POST(
			new Request("http://localhost", { method: "POST", body: JSON.stringify({ repoUrl: 123 }) }) as any
		);
		expect(res.status).toBe(400);
	});

	it("returns resolved commit message", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		getGithubAccessTokenForUserIdMock.mockResolvedValue("t");
		getCommitMessageFromGitHubMock.mockResolvedValue("fix: patch bug");
		const { POST } = await import("@/app/api/commits/message/route");
		const res = await POST(
			new Request("http://localhost", {
				method: "POST",
				body: JSON.stringify({ repoUrl: "https://github.com/acme/repo", sha: "abc123" }),
			}) as any
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ message: "fix: patch bug" });
	});
});
