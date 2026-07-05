import { beforeEach, describe, expect, it, vi } from "vitest";

const processDeploymentQueueMessageMock = vi.fn();

vi.mock("@/lib/deploymentQueueProcessor", () => ({
	processDeploymentQueueMessage: (...args: unknown[]) => processDeploymentQueueMessageMock(...args),
}));

describe("deployment queue lambda handler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns partial batch failures for records that throw", async () => {
		processDeploymentQueueMessageMock
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("launch failed"));

		const { handler } = await import("@/deployment-queue-handler");
		const result = await handler({
			Records: [
				{ messageId: "msg-1", body: "{\"runId\":\"1\",\"userId\":\"u\",\"repoName\":\"r\",\"serviceName\":\"s\"}" },
				{ messageId: "msg-2", body: "{\"runId\":\"2\",\"userId\":\"u\",\"repoName\":\"r\",\"serviceName\":\"s\"}" },
			],
		});

		expect(processDeploymentQueueMessageMock).toHaveBeenCalledTimes(2);
		expect(result).toEqual({
			batchItemFailures: [{ itemIdentifier: "msg-2" }],
		});
	});
});
