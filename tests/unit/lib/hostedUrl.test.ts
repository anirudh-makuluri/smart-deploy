import { describe, expect, it, vi } from "vitest";
import {
	generateDefaultHostedSubdomain,
	hostedSubdomainOrDefault,
	hostedUrlFromSubdomain,
} from "@/lib/hostedUrl";

describe("generateDefaultHostedSubdomain", () => {
	it("combines sanitized repo name with a 5-char random suffix", () => {
		const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.123456789);
		const suffix = (0.123456789).toString(36).substring(2, 7);
		expect(generateDefaultHostedSubdomain("My Cool App")).toBe(`my-cool-app${suffix}`);
		randomSpy.mockRestore();
	});

	it("returns empty string when repo name is blank", () => {
		expect(hostedSubdomainOrDefault("", null)).toBe("");
	});
});

describe("hostedUrlFromSubdomain", () => {
	it("builds the platform URL from a subdomain slug", () => {
		expect(hostedUrlFromSubdomain("my-app")).toBe("https://my-app.smart-deploy.xyz");
	});
});
