import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCommitMessageFromGitHub } from "@/lib/githubCommitMessage";

describe("getCommitMessageFromGitHub", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("returns undefined for non-github repo URL", async () => {
		const result = await getCommitMessageFromGitHub("t", "https://gitlab.com/a/b");
		expect(result).toBeUndefined();
	});

	it("fetches default branch and returns first line of commit message", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ default_branch: "main" }),
			} as Response)
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ commit: { message: "feat: ship it\n\nbody" } }),
			} as Response);

		const result = await getCommitMessageFromGitHub("token", "https://github.com/acme/repo");
		expect(result).toBe("feat: ship it");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("returns undefined when commit request fails", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: false,
			json: async () => ({}),
		} as Response);

		const result = await getCommitMessageFromGitHub(
			"token",
			"https://github.com/acme/repo",
			"deadbeef"
		);
		expect(result).toBeUndefined();
	});
});
