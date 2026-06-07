import { describe, expect, it } from "vitest";
import { __testing } from "@/db-helper";

describe("deployment run row mapping", () => {
	it("maps release_artifact into releaseArtifact", () => {
		const entry = __testing.rowToDeploymentHistoryEntryFromRun({
			id: "run-1",
			repo_name: "shop",
			service_name: "web",
			started_at: "2026-06-01T00:00:00.000Z",
			finished_at: "2026-06-01T00:10:00.000Z",
			success: true,
			step_summary: [{ id: "deploy", label: "Deploy", status: "success", lineCount: 1 }],
			log_tail: [{ ts: "2026-06-01T00:05:00.000Z", step_id: "deploy", message: "OK" }],
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
			log_ref: "deploy-runs/user-1/run-1/logs.jsonl",
		});

		expect(entry.releaseArtifact).toEqual({
			kind: "ecr_image",
			imageUri: "123.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/shop:abcdef",
		});
		expect(entry.configSnapshot).toEqual({});
		expect(entry.commitSha).toBe("abcdef123456");
		expect(entry.failureCode).toBe("DEPLOYMENT_VERIFICATION_FAILED");
		expect(entry.logRef).toBe("deploy-runs/user-1/run-1/logs.jsonl");
		expect(entry.steps[0]?.logs).toEqual(["OK"]);
		expect(entry.failureClassification).toMatchObject({
			stage: "verify",
			category: "health_check_failure",
		});
	});
});
