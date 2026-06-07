import { describe, expect, it } from "vitest";
import type { DeployStep } from "@/app/types";
import { classifyDeploymentFailure } from "@/lib/deploymentFailureClassification";
import { makeDeployment } from "../helpers/deployConfigFixture";

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
			deployConfig: makeDeployment({
				repoUrl: "https://github.com/example/shop",
				status: "deploying",
				commitSha: "abcdef123456",
				revision: 1,
			}),
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
			deployConfig: makeDeployment({
				repoUrl: "https://github.com/example/shop",
				status: "deploying",
				commitSha: "abcdef123456",
				revision: 1,
			}),
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
			deployConfig: makeDeployment({
				repoUrl: "https://github.com/example/shop",
				status: "deploying",
				commitSha: "abcdef123456",
				revision: 1,
			}),
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
