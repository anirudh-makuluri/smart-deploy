import { describe, expect, it } from "vitest";
import type { DeployConfig, EcrImageReleaseArtifact } from "@/app/types";
import {
	buildEc2ConfigReleaseArtifact,
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
		url: "https://github.com/acme/shop",
		branch: "main",
		serviceName: "web",
		status: "running",
		commitSha: "abcdef123456",
		envVars: "SECRET=old\nPUBLIC=value",
		liveUrl: "https://web.example.com",
		screenshotUrl: null,
		firstDeployment: null,
		lastDeployment: null,
		revision: 3,
		cloudProvider: "aws",
		deploymentTarget: "ec2",
		awsRegion: "us-west-2",
		ec2: null,
		cloudRun: null,
		scanResults: {
			commit_sha: "abcdef123456",
			stack_tokens: ["node"],
			files: [],
			risks: [],
			confidence: 0.9,
			token_usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
			dockerfiles: { Dockerfile: "FROM node:20" },
			nginx_conf: "events {}",
			services: [{ name: "web", build_context: ".", port: 3000, dockerfile_path: "Dockerfile" }],
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
		const artifact = buildEc2ConfigReleaseArtifact(makeDeployConfig());
		expect(artifact.kind).toBe("ec2_config");
		expect(artifact.deployConfig).not.toHaveProperty("envVars");
	});

	it("reconstructs rollback configs with current envVars only", () => {
		const artifact = buildEc2ConfigReleaseArtifact(makeDeployConfig({ envVars: "SECRET=old" }));
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
