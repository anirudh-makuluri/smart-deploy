import { beforeEach, describe, expect, it, vi } from "vitest";

const getDeploymentRemediationAttemptMock = vi.fn();
const updateDeploymentRemediationAttemptMock = vi.fn();
const updateDeploymentRuntimeStateMock = vi.fn();

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getDeploymentRemediationAttempt: (...args: unknown[]) => getDeploymentRemediationAttemptMock(...args),
		updateDeploymentRemediationAttempt: (...args: unknown[]) => updateDeploymentRemediationAttemptMock(...args),
		updateDeploymentRuntimeState: (...args: unknown[]) => updateDeploymentRuntimeStateMock(...args),
	},
}));

describe("GraphQL remediation resolvers", () => {
	const ctx = {
		userID: "user-1",
		session: { user: { id: "user-1" } },
	} as any;

	beforeEach(() => {
		vi.clearAllMocks();
		getDeploymentRemediationAttemptMock.mockResolvedValue({
			attempt: {
				id: "attempt-1",
				repo_name: "smart-deploy",
				service_name: "web",
				diff_preview: [{ target: "config:envVars", summary: "Update env", before: "PORT=3000", after: "PORT=8080" }],
				status: "proposed",
				created_at: new Date().toISOString(),
			},
		});
		updateDeploymentRemediationAttemptMock.mockResolvedValue({
			attempt: {
				id: "attempt-1",
				repo_name: "smart-deploy",
				service_name: "web",
				status: "approved",
				approved_by_user: true,
				created_at: new Date().toISOString(),
			},
		});
		updateDeploymentRuntimeStateMock.mockResolvedValue({ success: true });
	});

	it("returns a remediation diff for the authenticated user", async () => {
		const { deploymentRemediationDiff } = await import("@/lib/graphql/resolvers/query");
		const result = await deploymentRemediationDiff(null, { attemptId: "attempt-1" }, ctx);

		expect(getDeploymentRemediationAttemptMock).toHaveBeenCalledWith("attempt-1", "user-1");
		expect(result).toEqual([
			expect.objectContaining({
				target: "config:envVars",
			}),
		]);
	}, 20000);

	it("marks a remediation attempt approved and updates lifecycle state", async () => {
		const { approveDeploymentRemediation } = await import("@/lib/graphql/resolvers/mutation");
		const result = await approveDeploymentRemediation(null, { attemptId: "attempt-1" }, ctx);

		expect(updateDeploymentRemediationAttemptMock).toHaveBeenCalledWith("attempt-1", "user-1", {
			approvedByUser: true,
			status: "approved",
		});
		expect(updateDeploymentRuntimeStateMock).toHaveBeenCalledWith({
			repoName: "smart-deploy",
			serviceName: "web",
			userID: "user-1",
			lifecycleState: "applying_remediation",
		});
		expect(result).toEqual(expect.objectContaining({ status: "approved" }));
	}, 20000);

	it("marks a remediation attempt rejected and updates lifecycle state", async () => {
		updateDeploymentRemediationAttemptMock.mockResolvedValueOnce({
			attempt: {
				id: "attempt-1",
				repo_name: "smart-deploy",
				service_name: "web",
				status: "rejected",
				approved_by_user: false,
				created_at: new Date().toISOString(),
			},
		});
		const { rejectDeploymentRemediation } = await import("@/lib/graphql/resolvers/mutation");
		const result = await rejectDeploymentRemediation(null, { attemptId: "attempt-1" }, ctx);

		expect(updateDeploymentRemediationAttemptMock).toHaveBeenCalledWith("attempt-1", "user-1", {
			approvedByUser: false,
			status: "rejected",
		});
		expect(updateDeploymentRuntimeStateMock).toHaveBeenCalledWith({
			repoName: "smart-deploy",
			serviceName: "web",
			userID: "user-1",
			lifecycleState: "remediation_rejected",
		});
		expect(result).toEqual(expect.objectContaining({ status: "rejected" }));
	}, 20000);
});
