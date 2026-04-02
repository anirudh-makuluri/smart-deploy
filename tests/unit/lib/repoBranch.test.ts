import { describe, expect, it } from "vitest";
import { branchNamesFromRepo, resolveInitialRepoBranch, resolveWorkspaceBranch } from "@/lib/repoBranch";

describe("repoBranch helpers", () => {
	it("returns empty branch names for missing repo", () => {
		expect(branchNamesFromRepo(null)).toEqual([]);
	});

	it("resolves initial branch from listed default branch", () => {
		const repo = {
			default_branch: "main",
			branches: [{ name: "dev" }, { name: "main" }],
		};
		expect(resolveInitialRepoBranch(repo as any)).toBe("main");
	});

	it("falls back to well known branch when default branch is stale", () => {
		const repo = {
			default_branch: "main",
			branches: [{ name: "develop" }, { name: "feature/x" }],
		};
		expect(resolveInitialRepoBranch(repo as any)).toBe("develop");
	});

	it("falls back to first remote branch when no well known branch exists", () => {
		const repo = {
			default_branch: "main",
			branches: [{ name: "release" }, { name: "hotfix" }],
		};
		expect(resolveInitialRepoBranch(repo as any)).toBe("release");
	});

	it("keeps stored workspace branch only when remote has it", () => {
		const repo = {
			default_branch: "main",
			branches: [{ name: "main" }, { name: "dev" }],
		};
		expect(resolveWorkspaceBranch(repo as any, "dev")).toBe("dev");
		expect(resolveWorkspaceBranch(repo as any, "stale-branch")).toBe("main");
	});
});
