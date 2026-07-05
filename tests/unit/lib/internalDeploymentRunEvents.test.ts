import { beforeEach, describe, expect, it, vi } from "vitest";

const getDeploymentRunSystemMock = vi.fn();
const ensureEntryMock = vi.fn();
const broadcastLogMock = vi.fn();
const updateStepsMock = vi.fn();
const setStatusMock = vi.fn();
const broadcastCompletionMock = vi.fn();
const emitToWorkerDeploymentRoomMock = vi.fn();

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getDeploymentRunSystem: (...args: unknown[]) => getDeploymentRunSystemMock(...args),
	},
}));

vi.mock("@/lib/deployLogsStore", () => ({
	ensureEntry: (...args: unknown[]) => ensureEntryMock(...args),
	broadcastLog: (...args: unknown[]) => broadcastLogMock(...args),
	updateSteps: (...args: unknown[]) => updateStepsMock(...args),
	setStatus: (...args: unknown[]) => setStatusMock(...args),
	broadcastCompletion: (...args: unknown[]) => broadcastCompletionMock(...args),
}));

vi.mock("@/lib/workerSocketServer", () => ({
	emitToWorkerDeploymentRoom: (...args: unknown[]) => emitToWorkerDeploymentRoomMock(...args),
}));

describe("handleInternalDeploymentRunEvent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDeploymentRunSystemMock.mockResolvedValue({
			run: {
				id: "run-1",
				userId: "user-1",
				repoName: "repo",
				serviceName: "web",
				status: "deploying",
				releaseArtifact: {},
			},
		});
	});

	it("stores and broadcasts deploy logs for the deployment run owner", async () => {
		const { handleInternalDeploymentRunEvent } = await import("@/lib/internalDeploymentRunEvents");

		const result = await handleInternalDeploymentRunEvent("run-1", {
			event: "deploy:log",
			payload: { id: "build", msg: "Building image", time: "2026-07-05T08:00:00.000Z" },
		});

		expect(result).toEqual({ ok: true });
		expect(ensureEntryMock).toHaveBeenCalledWith("user-1", "repo", "web");
		expect(broadcastLogMock).toHaveBeenCalledWith(
			"user-1",
			"repo",
			"web",
			"build",
			"Building image",
			"2026-07-05T08:00:00.000Z"
		);
	});

	it("broadcasts completion payloads and updates in-memory status", async () => {
		const { handleInternalDeploymentRunEvent } = await import("@/lib/internalDeploymentRunEvents");
		const payload = { success: true, hosted_subdomain: "repo123", finalStatus: "running" };

		const result = await handleInternalDeploymentRunEvent("run-1", {
			event: "deploy:complete",
			payload,
		});

		expect(result).toEqual({ ok: true });
		expect(setStatusMock).toHaveBeenCalledWith("user-1", "repo", "web", "success", null);
		expect(broadcastCompletionMock).toHaveBeenCalledWith("user-1", "repo", "web", payload);
	});
});

