import { afterEach, describe, expect, it } from "vitest";
import { __testing } from "@/lib/handleDeploy";
import { makeDeployment } from "../helpers/deployConfigFixture";

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

describe("verifyDeploymentReadiness", () => {
	const originalForceFailure = process.env.SMARTDEPLOY_FORCE_VERIFICATION_FAILURE;

	afterEach(() => {
		if (originalForceFailure === undefined) {
			delete process.env.SMARTDEPLOY_FORCE_VERIFICATION_FAILURE;
		} else {
			process.env.SMARTDEPLOY_FORCE_VERIFICATION_FAILURE = originalForceFailure;
		}
	});

	it("fails verification without triggering automatic rollback", async () => {
		process.env.SMARTDEPLOY_FORCE_VERIFICATION_FAILURE = "1";
		const deploySteps = [
			{ id: "verify", label: "Verify", logs: [], status: "pending" as const },
			{ id: "rollback", label: "Restore release", logs: [], status: "pending" as const },
		];
		const sent: string[] = [];

		const result = await __testing.verifyDeploymentReadiness({
			deployConfig: makeDeployment({
				repoUrl: "https://github.com/example/shop",
				status: "deploying",
				serviceName: "web",
			}),
			deployUrl: "https://app.example.com",
			send: (msg: string) => {
				sent.push(msg);
			},
			deploySteps,
			serviceDetails: null,
		});

		expect(result).toEqual({
			success: false,
			errorMessage: "Deployment verification failed after all retry attempts.",
		});
		expect(deploySteps.find((step) => step.id === "verify")?.status).toBe("error");
		expect(deploySteps.find((step) => step.id === "rollback")?.status).toBe("pending");
		expect(sent.some((msg) => msg.includes("automatic rollback"))).toBe(false);
	});
});
