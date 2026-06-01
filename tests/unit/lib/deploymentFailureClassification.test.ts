import { describe, expect, it } from "vitest";
import type { DeployConfig, DeployStep } from "@/app/types";
import { classifyDeploymentFailure } from "@/lib/deploymentFailureClassification";

function makeDeployConfig(): DeployConfig {
	return {
		id: "dep-1",
		repoName: "shop",
		url: "https://github.com/example/shop",
		branch: "main",
		commitSha: "abcdef123456",
		envVars: null,
		liveUrl: null,
		screenshotUrl: null,
		serviceName: "web",
		status: "deploying",
		firstDeployment: null,
		lastDeployment: null,
		revision: 1,
		cloudProvider: "aws",
		deploymentTarget: "ec2",
		awsRegion: "us-west-2",
		ec2: null,
		cloudRun: null,
		scanResults: {},
	};
}

function makeStep(id: string, logs: string[], status: DeployStep["status"] = "pending"): DeployStep {
	return {
		id,
		label: id,
		logs,
		status,
	};
}

describe("classifyDeploymentFailure", () => {
	it("classifies CodeBuild build failures deterministically", () => {
		const failure = classifyDeploymentFailure({
			deployConfig: makeDeployConfig(),
			steps: [
				makeStep("auth", ["Assumed AWS role"], "success"),
				makeStep(
					"build",
					[
						"Building image...",
						"CodeBuild failed: Docker image build did not succeed",
						"Docker image build failed. Check build logs above.",
					],
					"error"
				),
			],
			errorMessage: "CodeBuild failed: Docker image build did not succeed",
			finalStatus: "failed",
		});

		expect(failure).toMatchObject({
			code: "CODEBUILD_DOCKER_IMAGE_BUILD_FAILED",
			classification: {
				stage: "build",
				category: "build_failure",
				retryable: false,
			},
		});
		expect(failure?.classification.evidence).toContain("CodeBuild failed: Docker image build did not succeed");
	});

	it("classifies verification failures and records rollback state", () => {
		const failure = classifyDeploymentFailure({
			deployConfig: makeDeployConfig(),
			steps: [
				makeStep("deploy", ["Instance ready"], "success"),
				makeStep(
					"verify",
					[
						"Verification round 6/6: probing 4 URL(s).",
						"Verification deadline reached before a healthy response was observed.",
						"ERROR: Deployment verification failed after all retry attempts.",
					],
					"error"
				),
			],
			errorMessage: "Deployment verification failed. Rolled back automatically to abcdef1.",
			rolledBack: true,
			finalStatus: "running",
		});

		expect(failure).toMatchObject({
			code: "DEPLOYMENT_VERIFICATION_FAILED",
			classification: {
				stage: "verify",
				category: "health_check_failure",
				autoRollbackTriggered: true,
			},
		});
		expect(failure?.classification.evidence[0]).toBe("Deployment verification failed. Rolled back automatically to abcdef1.");
	});

	it("classifies rollback failures when no previous release can be restored", () => {
		const failure = classifyDeploymentFailure({
			deployConfig: makeDeployConfig(),
			steps: [
				makeStep("verify", ["ERROR: Deployment verification failed after all retry attempts."], "error"),
				makeStep(
					"rollback",
					["ERROR: Verification failed and no successful deployment history entry is available for rollback."],
					"error"
				),
			],
			errorMessage: "Deployment verification failed and no previous successful deployment history entry was available for rollback.",
			finalStatus: "failed",
		});

		expect(failure).toMatchObject({
			code: "AUTOMATIC_ROLLBACK_NO_CANDIDATE",
			classification: {
				stage: "rollback",
				category: "rollback_failure",
			},
		});
	});
});
