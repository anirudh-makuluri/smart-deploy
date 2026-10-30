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
		mocks.query.mockResolvedValue({ rows: [{ id: "local-github-account" }] });
	});

	it("uses Better Auth's trusted server path for a CLI bearer request", async () => {
		mocks.getAccessToken.mockResolvedValue({ accessToken: "decrypted-token" });

		await expect(
			getGithubAccessTokenForUserId("user-1", new Headers({ Authorization: "Bearer sd_cli_token" }))
		).resolves.toBe("decrypted-token");
		expect(mocks.getAccessToken).toHaveBeenCalledWith({
			body: { accountId: "local-github-account", userId: "user-1" },
		});
		expect(mocks.query).toHaveBeenCalledWith(
			expect.stringContaining('where "userId" = $1 and "providerId" = \'github\''),
			["user-1"]
		);
	});

	it("keeps the browser session headers for browser requests", async () => {
		mocks.getAccessToken.mockResolvedValue({ accessToken: "browser-token" });
		const headers = new Headers({ cookie: "better-auth.session_token=abc" });

		await expect(getGithubAccessTokenForUserId("user-1", headers)).resolves.toBe("browser-token");
		expect(mocks.getAccessToken).toHaveBeenCalledWith({
			body: { accountId: "local-github-account", userId: "user-1" },
			headers,
		});
	});

	it("returns null without querying accounts for an empty user ID", async () => {
		await expect(getGithubAccessTokenForUserId("  ")).resolves.toBeNull();
		expect(mocks.query).not.toHaveBeenCalled();
		expect(mocks.getAccessToken).not.toHaveBeenCalled();
	});

	it("returns null when the user has no GitHub account", async () => {
		mocks.query.mockResolvedValue({ rows: [] });
		await expect(getGithubAccessTokenForUserId("user-1")).resolves.toBeNull();
		expect(mocks.getAccessToken).not.toHaveBeenCalled();
	});

	it("does not fall back to stored ciphertext when token decryption or refresh fails", async () => {
		mocks.getAccessToken.mockRejectedValue(new Error("Failed to get a valid access token"));
		await expect(getGithubAccessTokenForUserId("user-1")).rejects.toThrow("Failed to get a valid access token");
		expect(mocks.query).toHaveBeenCalledTimes(1);
		expect(mocks.query.mock.calls[0][0]).not.toContain("accessToken");
	});

	it("returns null when Better Auth returns no token", async () => {
		mocks.getAccessToken.mockResolvedValue({ accessToken: "" });
		await expect(getGithubAccessTokenForUserId("user-1")).resolves.toBeNull();
	});
});
