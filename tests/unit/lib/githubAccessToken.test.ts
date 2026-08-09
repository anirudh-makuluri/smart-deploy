import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getAccessToken: vi.fn(),
	query: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { getAccessToken: mocks.getAccessToken } },
}));

vi.mock("@/lib/dbPool", () => ({
	getDbPool: () => ({ query: mocks.query }),
}));

import { getGithubAccessTokenForUserId } from "@/lib/githubAccessToken";

describe("getGithubAccessTokenForUserId", () => {
	beforeEach(() => {
		mocks.getAccessToken.mockReset();
		mocks.query.mockReset();
	});

	it("uses Better Auth's trusted server path for a CLI bearer request", async () => {
		mocks.getAccessToken.mockResolvedValue({ accessToken: "decrypted-token" });

		await expect(
			getGithubAccessTokenForUserId("user-1", new Headers({ Authorization: "Bearer sd_cli_token" }))
		).resolves.toBe("decrypted-token");
		expect(mocks.getAccessToken).toHaveBeenCalledWith({
			body: { providerId: "github", userId: "user-1" },
		});
	});

	it("keeps the browser session headers for browser requests", async () => {
		mocks.getAccessToken.mockResolvedValue({ accessToken: "browser-token" });
		const headers = new Headers({ cookie: "better-auth.session_token=abc" });

		await expect(getGithubAccessTokenForUserId("user-1", headers)).resolves.toBe("browser-token");
		expect(mocks.getAccessToken).toHaveBeenCalledWith({
			body: { providerId: "github", userId: "user-1" },
			headers,
		});
	});
});
