import { describe, expect, it } from "vitest";
import { __testing } from "@/lib/handleDeploy";

describe("buildVerificationTargets", () => {
	it("verifies base URL before custom URL", () => {
		expect(
			__testing.buildVerificationTargets(
				"https://shared-alb.example.com",
				"https://app.example.com"
			)
		).toEqual([
			{ label: "base URL", url: "https://shared-alb.example.com" },
			{ label: "custom URL", url: "https://app.example.com" },
		]);
	});

	it("dedupes identical URLs", () => {
		expect(
			__testing.buildVerificationTargets(
				"https://app.example.com",
				"https://app.example.com"
			)
		).toEqual([{ label: "base URL", url: "https://app.example.com" }]);
	});
});
