import { afterEach, describe, expect, it, vi } from "vitest";

describe("demoMode helpers", () => {
	afterEach(() => {
		delete process.env.DEMO_INTERNAL_EMAIL_MATCHERS;
		vi.resetModules();
	});

	it("classifies internal vs demo users from email matchers", async () => {
		process.env.DEMO_INTERNAL_EMAIL_MATCHERS = "anirudh,smartdeploy";
		const { getAccountModeForEmail } = await import("@/lib/demoMode");

		expect(getAccountModeForEmail("owner@smartdeploy.dev")).toBe("internal");
		expect(getAccountModeForEmail("guest@example.com")).toBe("demo");
	});

	it("defaults to demo when no internal email matchers are configured", async () => {
		const { getAccountModeForEmail } = await import("@/lib/demoMode");
		expect(getAccountModeForEmail("anirudh@example.com")).toBe("demo");
	});

	it("parses the curated demo repo catalog", async () => {
		const { buildDemoRepoList, findDemoRepoConfig } = await import("@/lib/demoMode");
		const repoList = buildDemoRepoList();

		expect(repoList).toHaveLength(2);
		expect(repoList.map((repo) => repo.full_name)).toContain("anirudh-makuluri/chatify");
		expect(repoList.map((repo) => repo.full_name)).toContain("anirudh-makuluri/lexiguess-next");
		expect(findDemoRepoConfig({ owner: "anirudh-makuluri", repo: "chatify" })?.demoRepoKey).toBe("chatify");
	});
});
