import { describe, expect, it } from "vitest";
import { __testing } from "@/db-helper";

describe("deployment history row mapping", () => {
	it("maps release_artifact into releaseArtifact", () => {
		const entry = __testing.rowToDeploymentHistoryEntry({
			id: "hist-1",
			repo_name: "shop",
			service_name: "web",
			timestamp: "2026-06-01T00:00:00.000Z",
			success: true,
			steps: [],
			config_snapshot: { repoName: "shop" },
			release_artifact: {
				kind: "ecr_image",
				imageUri: "123.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/shop:abcdef",
			},
			commit_sha: "abcdef123456",
			commit_message: null,
			branch: "main",
			duration_ms: 1234,
			failure_code: "DEPLOYMENT_VERIFICATION_FAILED",
			failure_classification: {
				stage: "verify",
				category: "health_check_failure",
				retryable: false,
				summary: "Deployment verification failed after the app was released.",
				likelyCause: "The app did not become healthy at the expected URL or health endpoint within the verification window.",
				evidence: ["Verification failed after all retry attempts."],
			},
		});

		expect(entry.releaseArtifact).toEqual({
			kind: "ecr_image",
			imageUri: "123.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/shop:abcdef",
		});
		expect(entry.configSnapshot).toEqual({ repoName: "shop" });
		expect(entry.commitSha).toBe("abcdef123456");
		expect(entry.failureCode).toBe("DEPLOYMENT_VERIFICATION_FAILED");
		expect(entry.failureClassification).toMatchObject({
			stage: "verify",
			category: "health_check_failure",
		});
	});
});
