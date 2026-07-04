import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDeployment } from "./helpers/deployConfigFixture";

const createDeploymentRunMock = vi.fn();
const updateDeploymentsMock = vi.fn();
const finalizeDeploymentRunMock = vi.fn();
const enqueueDeploymentRunMock = vi.fn();

vi.mock("@/db-helper", () => ({
	dbHelper: {
		createDeploymentRun: (...args: unknown[]) => createDeploymentRunMock(...args),
		updateDeployments: (...args: unknown[]) => updateDeploymentsMock(...args),
		finalizeDeploymentRun: (...args: unknown[]) => finalizeDeploymentRunMock(...args),
		getDeployment: vi.fn(),
	},
}));

vi.mock("@/lib/aws/deploymentQueue", () => ({
	enqueueDeploymentRun: (...args: unknown[]) => enqueueDeploymentRunMock(...args),
}));

describe("websocket deploy queue handoff", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createDeploymentRunMock.mockResolvedValue({ runId: "run-1" });
		updateDeploymentsMock.mockResolvedValue({});
		finalizeDeploymentRunMock.mockResolvedValue({});
		enqueueDeploymentRunMock.mockResolvedValue(undefined);
	});

	it("creates a queued run, updates the deployment, and enqueues the run id", async () => {
		const { deploy } = await import("@/websocket-types");
		const deployConfig = makeDeployment({
			status: "deploying",
			commitSha: "abcdef123456",
			scanResults: { response_id: "resp-1" } as never,
		});

		await deploy(
			{
				deployConfig,
				token: "github-token",
				userID: "user-1",
			},
			null
		);

		expect(createDeploymentRunMock).toHaveBeenCalledWith({
			userId: "user-1",
			repoName: "shop",
			serviceName: "web",
			branch: "main",
			commitSha: "abcdef123456",
			responseId: null,
			releaseArtifact: {
				deployConfig: expect.objectContaining({
					repoName: "shop",
					serviceName: "web",
					status: "deploying",
				}),
			},
		});
		expect(updateDeploymentsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				repoName: "shop",
				serviceName: "web",
				activeRunId: "run-1",
			}),
			"user-1"
		);
		expect(enqueueDeploymentRunMock).toHaveBeenCalledWith({
			runId: "run-1",
			userId: "user-1",
			repoName: "shop",
			serviceName: "web",
		});
		expect(finalizeDeploymentRunMock).not.toHaveBeenCalled();
	});

	it("marks the run failed and clears active_run_id if enqueueing fails", async () => {
		const { deploy } = await import("@/websocket-types");
		const deployConfig = makeDeployment({
			status: "deploying",
		});
		enqueueDeploymentRunMock.mockRejectedValue(new Error("queue offline"));

		await expect(
			deploy(
				{
					deployConfig,
					token: "github-token",
					userID: "user-1",
				},
				null
			)
		).rejects.toThrow("queue offline");

		expect(finalizeDeploymentRunMock).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "run-1",
				userId: "user-1",
				success: false,
			})
		);
		expect(updateDeploymentsMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				repoName: "shop",
				serviceName: "web",
				activeRunId: null,
				status: "failed",
			}),
			"user-1"
		);
	});
});
