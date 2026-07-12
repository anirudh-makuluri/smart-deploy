import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();

vi.mock("@/config", () => ({
	default: {
		GITHUB_APP_SLUG: "smartdeploy-prod",
	},
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

describe("GET /api/github/install", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("redirects signed-in users to the GitHub App installation flow", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
		const { GET } = await import("@/app/api/github/install/route");
		const response = await GET(new Request("https://smart-deploy.xyz/api/github/install"));

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe(
			"https://github.com/apps/smartdeploy-prod/installations/new"
		);
	});

	it("requires a signed-in user", async () => {
		getSessionMock.mockResolvedValue(null);
		const { GET } = await import("@/app/api/github/install/route");
		const response = await GET(new Request("https://smart-deploy.xyz/api/github/install"));

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
	});
});
