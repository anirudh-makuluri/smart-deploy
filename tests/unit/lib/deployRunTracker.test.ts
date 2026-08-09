import { describe, expect, it, vi } from "vitest";

const uploadDeployRunLogsMock = vi.fn();
const updateDeploymentRunProgressMock = vi.fn();

vi.mock("@/lib/aws/deployRunLogs", () => ({
	uploadDeployRunLogs: (...args: unknown[]) => uploadDeployRunLogsMock(...args),
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		updateDeploymentRunProgress: (...args: unknown[]) => updateDeploymentRunProgressMock(...args),
	},
}));

import { createDeployRunStepFlushHandler, type ActiveDeployRun } from "@/lib/deployRunTracker";

describe("createDeployRunStepFlushHandler", () => {
	it("flushes new log lines appended to an existing step", async () => {
		uploadDeployRunLogsMock.mockResolvedValue({ logRef: "logs/run-1.json", stepSummary: [], logTail: [] });
		updateDeploymentRunProgressMock.mockResolvedValue({});
		const run: ActiveDeployRun = {
			runId: "run-1",
			userId: "user-1",
			lastFlushedLogCount: 0,
		};
		const steps = [{ id: "verify", label: "Verify", status: "in_progress" as const, logs: ["Starting verification"] }];
		const flush = createDeployRunStepFlushHandler(run, () => steps);

		flush(steps);
		await vi.waitFor(() => expect(uploadDeployRunLogsMock).toHaveBeenCalledTimes(1));
		steps[0]?.logs.push("Verification round 1/10.");
		flush(steps);
		await vi.waitFor(() => expect(uploadDeployRunLogsMock).toHaveBeenCalledTimes(2));
	});
});
