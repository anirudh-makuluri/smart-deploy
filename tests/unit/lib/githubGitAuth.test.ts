import { describe, expect, it } from "vitest";
import { githubAuthenticatedCloneUrl } from "@/lib/githubGitAuth";

describe("githubAuthenticatedCloneUrl", () => {
	it("injects x-access-token auth info into https clone URL", () => {
		const url = githubAuthenticatedCloneUrl("https://github.com/acme/repo.git", "abc 123");
		expect(url).toBe("https://x-access-token:abc%20123@github.com/acme/repo.git");
	});
});
