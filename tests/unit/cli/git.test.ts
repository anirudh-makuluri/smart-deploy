import { describe, expect, it } from "vitest";
import { normalizeGitHubRemote, readGitRepositoryContext, type GitCommandRunner } from "../../../packages/cli/src/git";

describe("Smart Deploy CLI Git context", () => {
	it("normalizes HTTPS and SSH GitHub origin remotes", () => {
		expect(normalizeGitHubRemote("https://github.com/acme/storefront.git")).toBe("https://github.com/acme/storefront");
		expect(normalizeGitHubRemote("git@github.com:acme/storefront.git")).toBe("https://github.com/acme/storefront");
	});

	it("reads the current repository context", () => {
		const values = new Map<string, string>([
			["rev-parse --show-toplevel", "/work/storefront"],
			["config --get remote.origin.url", "git@github.com:acme/storefront.git"],
			["branch --show-current", "main"],
			["rev-parse HEAD", "abc123"],
			["status --porcelain", ""],
		]);
		const runCommand: GitCommandRunner = (args) => values.get(args.join(" ")) ?? "";

		expect(readGitRepositoryContext("/work/storefront", runCommand)).toEqual({
			rootDirectory: "/work/storefront",
			repoUrl: "https://github.com/acme/storefront",
			branch: "main",
			commitSha: "abc123",
			isWorkingTreeClean: true,
		});
	});

	it("rejects a non-GitHub remote", () => {
		expect(() => normalizeGitHubRemote("https://gitlab.com/acme/storefront.git")).toThrow("GitHub origin");
	});
});
