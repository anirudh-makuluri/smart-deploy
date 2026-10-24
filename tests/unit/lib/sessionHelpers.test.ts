import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeRepo } from "../helpers/repoFixture";

const mockGetUserRepos = vi.fn();
const mockSyncUserRepos = vi.fn();
const mockGetGithubRepos = vi.fn();

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getUserRepos: (...args: unknown[]) => mockGetUserRepos(...args),
		syncUserRepos: (...args: unknown[]) => mockSyncUserRepos(...args),
	},
}));

vi.mock("@/github-helper", () => ({
	getGithubRepos: (...args: unknown[]) => mockGetGithubRepos(...args),
}));

const persistedRepo = makeRepo({
	id: "1",
	full_name: "acme/persisted",
});

const githubRepo = makeRepo({
	id: "2",
	full_name: "acme/current",
});

describe("ensureUserAndRepos", () => {
	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		mockGetUserRepos.mockResolvedValue({ repos: [persistedRepo] });
		mockSyncUserRepos.mockResolvedValue(undefined);
	});

	it("refreshes saved repositories from GitHub when a token is available", async () => {
		mockGetGithubRepos.mockResolvedValue({ data: [githubRepo] });
		const { ensureUserAndRepos } = await import("@/lib/sessionHelpers");

		const result = await ensureUserAndRepos({
			user: { id: "user-1" },
			githubToken: "github-token",
		});

		expect(mockGetGithubRepos).toHaveBeenCalledWith("github-token");
		expect(mockSyncUserRepos).toHaveBeenCalledWith("user-1", [githubRepo]);
		expect(result).toEqual({ userID: "user-1", repoList: [githubRepo] });
	});

	it("uses saved repositories when GitHub cannot be refreshed", async () => {
		mockGetGithubRepos.mockResolvedValue({ error: "GitHub unavailable" });
		const { ensureUserAndRepos } = await import("@/lib/sessionHelpers");

		const result = await ensureUserAndRepos({
			user: { id: "user-1" },
			githubToken: "github-token",
		});

		expect(mockSyncUserRepos).not.toHaveBeenCalled();
		expect(result).toEqual({ userID: "user-1", repoList: [persistedRepo] });
	});

	it("returns an empty GitHub repository list instead of stale saved repositories", async () => {
		mockGetGithubRepos.mockResolvedValue({ data: [] });
		const { ensureUserAndRepos } = await import("@/lib/sessionHelpers");

		const result = await ensureUserAndRepos({
			user: { id: "user-1" },
			githubToken: "github-token",
		});

		expect(mockSyncUserRepos).not.toHaveBeenCalled();
		expect(result).toEqual({ userID: "user-1", repoList: [] });
	});

	it("uses saved repositories without a GitHub connection", async () => {
		const { ensureUserAndRepos } = await import("@/lib/sessionHelpers");

		const result = await ensureUserAndRepos({ user: { id: "user-1" } });

		expect(mockGetGithubRepos).not.toHaveBeenCalled();
		expect(result).toEqual({ userID: "user-1", repoList: [persistedRepo] });
	});
});
