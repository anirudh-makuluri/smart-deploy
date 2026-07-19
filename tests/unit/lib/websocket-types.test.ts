import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDeployment } from "../helpers/deployConfigFixture";

const createDeploymentRunMock = vi.fn();
const updateDeploymentsMock = vi.fn();
const finalizeDeploymentRunMock = vi.fn();
const enqueueDeploymentRunMock = vi.fn();
const getDeploymentMock = vi.fn();
const getEcsServiceLogsMock = vi.fn();
const createEntryMock = vi.fn();
const getSocketSnapshotMock = vi.fn();

vi.mock("@/db-helper", () => ({
	dbHelper: {
		createDeploymentRun: (...args: unknown[]) => createDeploymentRunMock(...args),
		updateDeployments: (...args: unknown[]) => updateDeploymentsMock(...args),
		finalizeDeploymentRun: (...args: unknown[]) => finalizeDeploymentRunMock(...args),
		getDeployment: (...args: unknown[]) => getDeploymentMock(...args),
	},
}));

vi.mock("@/lib/aws/deploymentQueue", () => ({
	enqueueDeploymentRun: (...args: unknown[]) => enqueueDeploymentRunMock(...args),
}));

vi.mock("@/lib/aws/ecsCloudWatchLogs", () => ({
	getEcsServiceLogs: (...args: unknown[]) => getEcsServiceLogsMock(...args),
}));

vi.mock("@/lib/deployLogsStore", () => ({
	createEntry: (...args: unknown[]) => createEntryMock(...args),
	getSocketSnapshot: (...args: unknown[]) => getSocketSnapshotMock(...args),
}));

describe("websocket-types deploy", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createDeploymentRunMock.mockResolvedValue({ runId: "run-1" });
		updateDeploymentsMock.mockResolvedValue({});
		finalizeDeploymentRunMock.mockResolvedValue({});
		enqueueDeploymentRunMock.mockResolvedValue(undefined);
		getSocketSnapshotMock.mockReturnValue({
			repoName: "smart-deploy",
			serviceName: "web",
			logEntries: [],
			status: "queued",
			error: null,
		});
	});

	it("marks the deployment failed when queue handoff throws", async () => {
		enqueueDeploymentRunMock.mockRejectedValue(new Error("Deployment failed"));
		const { deploy } = await import("@/websocket-types");
		const deployConfig = makeDeployment({
			repoName: "smart-deploy",
			serviceName: "web",
			status: "deploying",
		});

		await expect(
			deploy(
				{
					deployConfig,
					token: "gh-token",
					userID: "user-1",
				},
				{}
			)
		).rejects.toThrow("Deployment failed");

		expect(finalizeDeploymentRunMock).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "run-1",
				userId: "user-1",
				success: false,
			})
		);
		expect(updateDeploymentsMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				repoName: "smart-deploy",
				serviceName: "web",
				activeRunId: null,
				status: "failed",
			}),
			"user-1"
		);
	}, 10000);

	it("queues the deployment run and skips failure cleanup on success", async () => {
		const { deploy } = await import("@/websocket-types");
		const deployConfig = makeDeployment({
			repoName: "smart-deploy",
			serviceName: "web",
			status: "deploying",
		});

		const ws = { emit: vi.fn() };
		await deploy(
			{
				deployConfig,
				token: "gh-token",
				userID: "user-1",
			},
			ws
		);

		expect(createDeploymentRunMock).toHaveBeenCalledWith({
			userId: "user-1",
			repoName: "smart-deploy",
			serviceName: "web",
			branch: "main",
			commitSha: undefined,
			responseId: null,
			releaseArtifact: {
				deployConfig: expect.objectContaining({
					repoName: "smart-deploy",
					serviceName: "web",
					status: "deploying",
				}),
			},
		});
		expect(updateDeploymentsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				repoName: "smart-deploy",
				serviceName: "web",
				activeRunId: "run-1",
			}),
			"user-1"
		);
		expect(enqueueDeploymentRunMock).toHaveBeenCalledWith({
			runId: "run-1",
			userId: "user-1",
			repoName: "smart-deploy",
			serviceName: "web",
		});
		expect(createEntryMock).toHaveBeenCalledWith("user-1", "smart-deploy", "web");
		expect(ws.emit).toHaveBeenCalledWith("deploy:snapshot", {
			repoName: "smart-deploy",
			serviceName: "web",
			logEntries: [],
			status: "queued",
			error: null,
		});
		expect(finalizeDeploymentRunMock).not.toHaveBeenCalled();
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
			emit: vi.fn(),
		};

		await serviceLogs({ repoName: "smart-deploy", serviceName: "web" }, ws);

		expect(getEcsServiceLogsMock).toHaveBeenCalledWith({
			ecs: expect.objectContaining({
				target: "ecs",
				service: "svc-1",
			}),
			limit: 50,
		});
		expect(ws.emit).toHaveBeenCalledWith("service_logs:initial", {
			logs: [{ message: "GLIBC_2.38 not found" }],
		});
	});

	it("returns empty logs when the deployment is not ECS-backed", async () => {
		getDeploymentMock.mockResolvedValue({
			deployment: {
				status: "failed",
				cloudResources: null,
			},
		});

		const { serviceLogs } = await import("@/websocket-types");
		const ws = {
			emit: vi.fn(),
		};

		await serviceLogs({ repoName: "smart-deploy", serviceName: "web" }, ws);

		expect(getEcsServiceLogsMock).not.toHaveBeenCalled();
		expect(ws.emit).toHaveBeenCalledWith("service_logs:initial", { logs: [] });
	});
});
