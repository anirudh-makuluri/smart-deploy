import { describe, expect, it } from "vitest";
import { __testing } from "@/lib/aws/deploymentQueue";

describe("deploymentQueue helpers", () => {
	it("detects FIFO queue urls", () => {
		expect(__testing.isFifoQueue("https://sqs.us-west-2.amazonaws.com/123/smart-deploy.fifo")).toBe(true);
		expect(__testing.isFifoQueue("https://sqs.us-west-2.amazonaws.com/123/smart-deploy")).toBe(false);
	});

	it("builds per-service message group ids", () => {
		expect(
			__testing.buildDeploymentQueueMessageGroupId({
				userId: "user-1",
				repoName: "shop",
				serviceName: "web",
			})
		).toBe("user-1:shop:web");
	});
});
