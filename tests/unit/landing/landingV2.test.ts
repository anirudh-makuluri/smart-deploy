import { describe, expect, it } from "vitest";
import { buildDemoStoryContext, DEMO_REPOS } from "@/lib/landing/demoRepos";
import {
	DEPLOY_ANIMATION_MS,
	DEPLOY_LOG_LINES,
	getBackgroundPhase,
	getDeployLogIndex,
} from "@/lib/landing/interactiveDemo";
import { formatLandingStatSentence } from "@/lib/landing/landingCopy";

describe("demoRepos", () => {
	it("builds story context from a demo repo", () => {
		const repo = DEMO_REPOS[0];
		const context = buildDemoStoryContext(repo);
		expect(context.repoSlug).toBe(repo.slug);
		expect(context.services).toEqual(repo.services);
		expect(context.customDomain).toContain(repo.services[0]);
		expect(context.secrets).toEqual(repo.secrets);
	});
});

describe("interactiveDemo", () => {
	it("maps idle and setup to idle background", () => {
		expect(getBackgroundPhase("idle")).toBe("idle");
		expect(getBackgroundPhase("setup")).toBe("idle");
		expect(getBackgroundPhase("scan")).toBe("scan");
	});

	it("reveals deploy log lines over the animation window", () => {
		expect(getDeployLogIndex(0, DEPLOY_ANIMATION_MS, DEPLOY_LOG_LINES.length)).toBe(1);
		expect(getDeployLogIndex(DEPLOY_ANIMATION_MS, DEPLOY_ANIMATION_MS, DEPLOY_LOG_LINES.length)).toBe(
			DEPLOY_LOG_LINES.length
		);
	});
});

describe("landingCopy", () => {
	it("formats stat sentences for crawlers", () => {
		expect(formatLandingStatSentence(130, 47)).toContain("130");
		expect(formatLandingStatSentence(130, 47)).toContain("47");
		expect(formatLandingStatSentence(0, 0)).toContain("Solo developers");
	});
});
