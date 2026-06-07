import { describe, expect, it } from "vitest";
import type { DeployConfig, EcrImageReleaseArtifact } from "@/app/types";
import {
	buildEcrImageReleaseArtifact,
	deployConfigFromReleaseArtifact,
	ecrImageRefFromArtifact,
	sanitizeDeployConfigForHistory,
	serviceImageRefsFromArtifact,
} from "@/lib/deploymentReleaseArtifacts";
import { configSnapshotFromDeployConfig } from "@/lib/utils";

function makeDeployConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
	return {
		id: "dep-1",
		repoName: "shop",
		repoUrl: "https://github.com/acme/shop",
		branch: "main",
		serviceName: "web",
		status: "running",
		commitSha: "abcdef123456",
		envVars: "SECRET=old\nPUBLIC=value",
		hostedSubdomain: "web",
		screenshotUrl: null,
		firstDeployment: null,
		lastDeployment: null,
		revision: 3,
		cloudProvider: "aws",
		deploymentTarget: "ecs",
		region: "us-west-2",
		cloudResources: null,
		scanResults: {
			response_id: "resp-1",
			commit_sha: "abcdef123456",
			package_path: ".",
			deploy_shape: "server",
			build_status: "passed",
			railpack_version: "0.1.0",
			workflow_version: "1",
			deploy_briefing: "Node server",
			deploy_units: [
				{
					name: "web",
					root: ".",
					type: "server",
					provider: "node",
					framework: null,
					port: 3000,
					artifacts: {
						railpack_plan: { deploy: { startCommand: "npm start" } },
						railpack_json: null,
					},
				},
			],
			build_verification: {},
			repair_history: [],
			pipeline_trace: [],
			errors: [],
			llm_outputs: {},
			inputs_snapshot: {},
			token_usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
		},
		...overrides,
	};
}

describe("deployment release artifacts", () => {
	it("omits envVars from history snapshots", () => {
		const snapshot = sanitizeDeployConfigForHistory(makeDeployConfig());
		expect(snapshot).not.toHaveProperty("envVars");
		expect(configSnapshotFromDeployConfig(makeDeployConfig())).not.toHaveProperty("envVars");
	});

	it("stores deploy config artifacts without envVars", () => {
		const artifact = buildEcrImageReleaseArtifact({
			deployConfig: makeDeployConfig(),
			region: "us-west-2",
			ecrRegistry: "123.dkr.ecr.us-west-2.amazonaws.com",
			ecrRepoName: "smartdeploy/shop",
			imageTag: "abc123",
			imageUri: "123.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/shop:abc123",
		});
		expect(artifact.kind).toBe("ecr_image");
		expect(artifact.deployConfig).not.toHaveProperty("envVars");
	});

	it("reconstructs rollback configs with current envVars only", () => {
		const artifact = buildEcrImageReleaseArtifact({
			deployConfig: makeDeployConfig({ envVars: "SECRET=old" }),
			region: "us-west-2",
			ecrRegistry: "123.dkr.ecr.us-west-2.amazonaws.com",
			ecrRepoName: "smartdeploy/shop",
			imageTag: "abc123",
			imageUri: "123.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/shop:abc123",
		});
		artifact.deployConfig.envVars = "SECRET=stale";

		const rollbackConfig = deployConfigFromReleaseArtifact(
			artifact,
			makeDeployConfig({ envVars: "SECRET=current", commitSha: "badbadbad" })
		);

		expect(rollbackConfig?.commitSha).toBe("abcdef123456");
		expect(rollbackConfig?.envVars).toBe("SECRET=current");
	});

	it("prefers digest image refs for ECR artifacts", () => {
		const artifact = buildEcrImageReleaseArtifact({
			deployConfig: makeDeployConfig(),
			region: "us-west-2",
			ecrRegistry: "123.dkr.ecr.us-west-2.amazonaws.com",
			ecrRepoName: "smartdeploy/shop",
			imageTag: "abcdef",
			imageUri: "123.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/shop:abcdef",
			imageDigest: "sha256:111",
			serviceImages: [{
				serviceName: "api",
				ecrRepoName: "smartdeploy/shop-api",
				imageUri: "123.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/shop-api:abcdef",
				imageDigest: "sha256:222",
			}],
		}) satisfies EcrImageReleaseArtifact;

		expect(ecrImageRefFromArtifact(artifact)).toBe("123.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/shop@sha256:111");
		expect(serviceImageRefsFromArtifact(artifact)[0].imageUri).toBe("123.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/shop-api@sha256:222");
		expect(artifact.deployConfig).not.toHaveProperty("envVars");
	});
});
