import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSyncUserRepos = vi.fn();
const mockFetchAndBuildRepo = vi.fn();

vi.mock("@/db-helper", () => ({
	dbHelper: {
		syncUserRepos: (...args: unknown[]) => mockSyncUserRepos(...args),
	},
}));

vi.mock("@/lib/sessionHelpers", () => ({
	ensureUserAndRepos: vi.fn(),
}));

vi.mock("@/lib/deploymentStatus", () => ({
	resolveDeploymentStatus: vi.fn(),
}));

vi.mock("@/lib/hostedUrl", () => ({
	hostedUrlFromSubdomain: vi.fn(),
}));

vi.mock("@/lib/cloudResources", () => ({
	isEcsCloudResources: vi.fn(),
}));

vi.mock("@/lib/aws/ecsCloudWatchLogs", () => ({
	getEcsServiceLogs: vi.fn(),
}));

vi.mock("@/lib/graphql/helpers", () => ({
	fetchAndBuildRepo: (...args: unknown[]) => mockFetchAndBuildRepo(...args),
	fetchLatestCommit: vi.fn(),
	sortAndLimitRepos: vi.fn(),
	sortReposByLatestCommit: vi.fn(),
}));

import { resolveRepo } from "@/lib/graphql/resolvers/query";

const repo = {
	id: "repo-1",
	name: "shop",
	full_name: "acme/shop",
	html_url: "https://github.com/acme/shop",
	language: "TypeScript",
	languages_url: "https://api.github.com/repos/acme/shop/languages",
	created_at: "2026-06-24T00:00:00.000Z",
	updated_at: "2026-06-24T00:00:00.000Z",
	pushed_at: "2026-06-24T00:00:00.000Z",
	default_branch: "main",
	private: false,
	visibility: "public",
	owner: { login: "acme" },
	latest_commit: null,
	branches: [],
};

describe("resolveRepo", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchAndBuildRepo.mockResolvedValue(repo);
		mockSyncUserRepos.mockResolvedValue(undefined);
	});

	it("returns the GitHub repository after syncing it to the user's catalog", async () => {
		const result = await resolveRepo(
			null,
			{ owner: " acme ", repo: " shop " },
			{ session: {}, userID: "user-1", githubToken: "github-token" } as never
		);

		expect(mockFetchAndBuildRepo).toHaveBeenCalledWith("acme", "shop", "github-token");
		expect(mockSyncUserRepos).toHaveBeenCalledWith("user-1", [repo]);
		expect(result).toEqual(repo);
	});

	it("returns the GitHub repository when catalog syncing fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		mockSyncUserRepos.mockRejectedValue(new Error("Database unavailable"));

		const result = await resolveRepo(
			null,
			{ owner: "acme", repo: "shop" },
			{ session: {}, userID: "user-1", githubToken: "github-token" } as never
		);

		expect(result).toEqual(repo);
		expect(consoleError).toHaveBeenCalledWith(
			"[GraphQL] resolveRepo failed to sync repository:",
			expect.any(Error)
		);
	});
});
