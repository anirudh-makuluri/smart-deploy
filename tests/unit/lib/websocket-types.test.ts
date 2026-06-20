import { beforeEach, describe, expect, it, vi } from "vitest";

const handleDeployMock = vi.fn();
const handleManualRollbackMock = vi.fn();
const createEntryMock = vi.fn();
const updateStepsMock = vi.fn();
const broadcastLogMock = vi.fn();
const setStatusMock = vi.fn();
const getDeploymentMock = vi.fn();
const getEcsServiceLogsMock = vi.fn();
const getInitialLogsMock = vi.fn();

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

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getDeployment: (...args: unknown[]) => getDeploymentMock(...args),
	},
}));

vi.mock("@/lib/aws/ecsCloudWatchLogs", () => ({
	getEcsServiceLogs: (...args: unknown[]) => getEcsServiceLogsMock(...args),
}));

vi.mock("@/gcloud-logs/getInitialLogs", () => ({
	getInitialLogs: (...args: unknown[]) => getInitialLogsMock(...args),
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

	it("returns ECS logs even when the stored deployment status is failed", async () => {
		getDeploymentMock.mockResolvedValue({
			deployment: {
				status: "failed",
				cloudResources: {
					target: "ecs",
					region: "us-west-2",
					cluster: "cluster-1",
					service: "svc-1",
					baseUrl: "https://svc.example.com",
					logGroup: "/ecs/smartdeploy-railpack",
				},
			},
		});
		getEcsServiceLogsMock.mockResolvedValue([{ message: "GLIBC_2.38 not found" }]);

		const { serviceLogs } = await import("@/websocket-types");
		const ws = {
			OPEN: 1,
			readyState: 1,
			send: vi.fn(),
		};

		await serviceLogs({ repoName: "smart-deploy", serviceName: "web" }, ws);

		expect(getEcsServiceLogsMock).toHaveBeenCalledWith({
			ecs: expect.objectContaining({
				target: "ecs",
				service: "svc-1",
			}),
			limit: 50,
		});
		expect(ws.send).toHaveBeenCalledWith(
			JSON.stringify({
				type: "initial_logs",
				payload: { logs: [{ message: "GLIBC_2.38 not found" }] },
			})
		);
	});

	it("does not fetch legacy service logs for non-running deployments", async () => {
		getDeploymentMock.mockResolvedValue({
			deployment: {
				status: "failed",
				cloudResources: null,
			},
		});

		const { serviceLogs } = await import("@/websocket-types");
		const ws = {
			OPEN: 1,
			readyState: 1,
			send: vi.fn(),
		};

		await serviceLogs({ repoName: "smart-deploy", serviceName: "web" }, ws);

		expect(getInitialLogsMock).not.toHaveBeenCalled();
		expect(ws.send).not.toHaveBeenCalled();
	});
});
