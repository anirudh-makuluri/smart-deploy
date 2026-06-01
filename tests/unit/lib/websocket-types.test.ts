import { beforeEach, describe, expect, it, vi } from "vitest";

const handleDeployMock = vi.fn();
const handleManualRollbackMock = vi.fn();
const createEntryMock = vi.fn();
const updateStepsMock = vi.fn();
const broadcastLogMock = vi.fn();
const setStatusMock = vi.fn();

vi.mock("@/lib/handleDeploy", () => ({
	handleDeploy: (...args: unknown[]) => handleDeployMock(...args),
	handleManualRollback: (...args: unknown[]) => handleManualRollbackMock(...args),
}));

vi.mock("@/lib/deployLogsStore", () => ({
	createEntry: (...args: unknown[]) => createEntryMock(...args),
	updateSteps: (...args: unknown[]) => updateStepsMock(...args),
	broadcastLog: (...args: unknown[]) => broadcastLogMock(...args),
	setStatus: (...args: unknown[]) => setStatusMock(...args),
}));

describe("websocket-types deploy", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("marks store status as error when handleDeploy returns error", async () => {
		handleDeployMock.mockResolvedValue("error");
		const { deploy } = await import("@/websocket-types");

		await deploy(
			{
				deployConfig: {
					repoName: "smart-deploy",
					serviceName: "web",
				} as any,
				token: "gh-token",
				userID: "user-1",
			},
			{}
		);

		expect(setStatusMock).toHaveBeenCalledWith("user-1", "smart-deploy", "web", "error", "Deployment failed");
	}, 10000);

	it("marks store status as success when handleDeploy returns done", async () => {
		handleDeployMock.mockResolvedValue("done");
		const { deploy } = await import("@/websocket-types");

		await deploy(
			{
				deployConfig: {
					repoName: "smart-deploy",
					serviceName: "web",
				} as any,
				token: "gh-token",
				userID: "user-1",
			},
			{}
		);

		expect(setStatusMock).toHaveBeenCalledWith("user-1", "smart-deploy", "web", "success");
	}, 10000);

	it("marks store status as success when manual rollback returns done", async () => {
		handleManualRollbackMock.mockResolvedValue("done");
		const { rollback } = await import("@/websocket-types");

		await rollback(
			{
				repoName: "smart-deploy",
				serviceName: "web",
				historyEntryId: "hist-1",
				token: "gh-token",
				userID: "user-1",
			},
			{}
		);

		expect(setStatusMock).toHaveBeenCalledWith("user-1", "smart-deploy", "web", "success");
	}, 10000);

	it("marks store status as error when manual rollback throws", async () => {
		handleManualRollbackMock.mockRejectedValue(new Error("Rollback failed"));
		const { rollback } = await import("@/websocket-types");

		await expect(
			rollback(
				{
					repoName: "smart-deploy",
					serviceName: "web",
					historyEntryId: "hist-1",
					token: "gh-token",
					userID: "user-1",
				},
				{}
			)
		).rejects.toThrow("Rollback failed");

		expect(setStatusMock).toHaveBeenCalledWith("user-1", "smart-deploy", "web", "error", "Rollback failed");
	}, 10000);
});
