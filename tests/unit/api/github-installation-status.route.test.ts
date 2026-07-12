import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getGithubAccessTokenForUserIdMock = vi.fn();

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

describe("GET /api/github/installations/status", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
		getGithubAccessTokenForUserIdMock.mockResolvedValue("github-token");
		vi.stubGlobal("fetch", vi.fn());
	});

	it("reports an accessible installation", async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ installations: [{ id: 42 }] })));
		const { GET } = await import("@/app/api/github/installations/status/route");
		const response = await GET(new Request("https://smart-deploy.xyz/api/github/installations/status"));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ installed: true });
		expect(fetch).toHaveBeenCalledWith(
			"https://api.github.com/user/installations?per_page=100",
			expect.objectContaining({ cache: "no-store" })
		);
	});

	it("reports no installation when GitHub returns an empty installation list", async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ installations: [] })));
		const { GET } = await import("@/app/api/github/installations/status/route");
		const response = await GET(new Request("https://smart-deploy.xyz/api/github/installations/status"));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ installed: false });
	});

	it("does not treat a GitHub API failure as no installation", async () => {
		vi.mocked(fetch).mockResolvedValue(new Response("Unauthorized", { status: 401 }));
		const { GET } = await import("@/app/api/github/installations/status/route");
		const response = await GET(new Request("https://smart-deploy.xyz/api/github/installations/status"));

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({ error: "Could not check GitHub App installation" });
	});

	it("requires a signed-in user", async () => {
		getSessionMock.mockResolvedValue(null);
		const { GET } = await import("@/app/api/github/installations/status/route");
		const response = await GET(new Request("https://smart-deploy.xyz/api/github/installations/status"));

		expect(response.status).toBe(401);
		expect(getGithubAccessTokenForUserIdMock).not.toHaveBeenCalled();
	});
});
