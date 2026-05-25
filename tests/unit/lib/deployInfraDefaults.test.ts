import { afterEach, describe, expect, it } from "vitest";
import { defaultAutoFixEnabled, withDeployInfraDefaults } from "@/lib/deployInfraDefaults";

describe("deployInfraDefaults", () => {
	const originalClientFlag = process.env.NEXT_PUBLIC_SMARTDEPLOY_PHASE2_AUTOFIX_DEFAULT;
	const originalServerFlag = process.env.SMARTDEPLOY_PHASE2_AUTOFIX_DEFAULT;

	afterEach(() => {
		if (originalClientFlag === undefined) {
			delete process.env.NEXT_PUBLIC_SMARTDEPLOY_PHASE2_AUTOFIX_DEFAULT;
		} else {
			process.env.NEXT_PUBLIC_SMARTDEPLOY_PHASE2_AUTOFIX_DEFAULT = originalClientFlag;
		}
		if (originalServerFlag === undefined) {
			delete process.env.SMARTDEPLOY_PHASE2_AUTOFIX_DEFAULT;
		} else {
			process.env.SMARTDEPLOY_PHASE2_AUTOFIX_DEFAULT = originalServerFlag;
		}
	});

	it("reads the global Phase 2 rollout flag", () => {
		process.env.NEXT_PUBLIC_SMARTDEPLOY_PHASE2_AUTOFIX_DEFAULT = "false";
		expect(defaultAutoFixEnabled()).toBe(false);

		process.env.NEXT_PUBLIC_SMARTDEPLOY_PHASE2_AUTOFIX_DEFAULT = "true";
		expect(defaultAutoFixEnabled()).toBe(true);
	});

	it("uses the rollout flag only when autoFixEnabled is not explicitly set", () => {
		process.env.NEXT_PUBLIC_SMARTDEPLOY_PHASE2_AUTOFIX_DEFAULT = "false";

		const defaulted = withDeployInfraDefaults({
			repoName: "smart-deploy",
			serviceName: "web",
			deploymentTarget: "ec2",
			awsRegion: "",
			ec2: null,
			scanResults: {},
		} as any);
		expect(defaulted.autoFixEnabled).toBe(false);

		const explicit = withDeployInfraDefaults({
			repoName: "smart-deploy",
			serviceName: "web",
			deploymentTarget: "ec2",
			awsRegion: "",
			ec2: null,
			scanResults: {},
			autoFixEnabled: true,
		} as any);
		expect(explicit.autoFixEnabled).toBe(true);
	});
});
