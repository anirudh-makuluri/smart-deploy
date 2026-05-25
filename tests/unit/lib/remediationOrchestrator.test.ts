import { beforeEach, describe, expect, it, vi } from "vitest";

const updateDeploymentRuntimeStateMock = vi.fn();
const addDeploymentRemediationAttemptMock = vi.fn();

vi.mock("@/db-helper", () => ({
	dbHelper: {
		updateDeploymentRuntimeState: (...args: unknown[]) => updateDeploymentRuntimeStateMock(...args),
		addDeploymentRemediationAttempt: (...args: unknown[]) => addDeploymentRemediationAttemptMock(...args),
	},
}));

describe("queueRemediationAttempt", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		updateDeploymentRuntimeStateMock.mockResolvedValue({ success: true });
		addDeploymentRemediationAttemptMock.mockResolvedValue({
			attempt: {
				id: "attempt-1",
				repo_name: "smart-deploy",
				service_name: "web",
				attempt_number: 1,
				trigger_type: "deploy_failure",
				summary: "Deployment failed and needs remediation.",
				status: "proposed",
				created_at: new Date().toISOString(),
			},
		});
	});

	it("queues a remediation attempt within the retry limit", async () => {
		const { queueRemediationAttempt } = await import("@/lib/remediationOrchestrator");
		const result = await queueRemediationAttempt({
			deployConfig: {
				repoName: "smart-deploy",
				serviceName: "web",
				envVars: "PORT=3000",
				autoFixEnabled: true,
				maxAutoFixRetries: 2,
				activeRemediationAttemptCount: 0,
				scanResults: {
					services: [{ port: 8080 }],
				},
			} as any,
			userID: "user-1",
			triggerType: "deploy_failure",
			errorMessage: "Upstream connection refused",
			steps: [{ id: "deploy", label: "Deploy", status: "error", logs: ["upstream connection refused"], startedAt: "", endedAt: "" }],
		});

		expect(result.status).toBe("queued");
		expect(addDeploymentRemediationAttemptMock).toHaveBeenCalledTimes(1);
		expect(addDeploymentRemediationAttemptMock).toHaveBeenCalledWith(
			expect.objectContaining({
				riskLevel: "safe",
				confidence: null,
				filesToModify: ["generated-artifacts"],
				changes: expect.arrayContaining([
					expect.objectContaining({
						title: "Analyze failure and generate revised artifacts",
					}),
				]),
				diffPreview: [],
				canAutoApply: false,
			})
		);
		expect(updateDeploymentRuntimeStateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				repoName: "smart-deploy",
				serviceName: "web",
				userID: "user-1",
				lifecycleState: "awaiting_remediation_approval",
				activeRemediationAttemptCount: 1,
			})
		);
	});

	it("marks remediation as exhausted once the retry limit is reached", async () => {
		const { queueRemediationAttempt } = await import("@/lib/remediationOrchestrator");
		const result = await queueRemediationAttempt({
			deployConfig: {
				repoName: "smart-deploy",
				serviceName: "web",
				autoFixEnabled: true,
				maxAutoFixRetries: 2,
				activeRemediationAttemptCount: 2,
			} as any,
			userID: "user-1",
			triggerType: "deploy_failure",
		});

		expect(result).toEqual({ status: "exhausted", maxRetries: 2 });
		expect(addDeploymentRemediationAttemptMock).not.toHaveBeenCalled();
		expect(updateDeploymentRuntimeStateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				lifecycleState: "remediation_exhausted",
				activeRemediationAttemptCount: 2,
			})
		);
	});
});
