import { beforeEach, describe, expect, it, vi } from "vitest";

const ecsSendMock = vi.fn();
const elbSendMock = vi.fn();

vi.mock("@aws-sdk/client-ecs", () => ({
	ECSClient: vi.fn(function MockECSClient() {
		return {
			send: ecsSendMock,
		};
	}),
	DescribeServicesCommand: vi.fn(function MockDescribeServicesCommand(input: unknown) {
		return input;
	}),
}));

vi.mock("@aws-sdk/client-elastic-load-balancing-v2", () => ({
	ElasticLoadBalancingV2Client: vi.fn(function MockElasticLoadBalancingV2Client() {
		return {
			send: elbSendMock,
		};
	}),
	DescribeTargetHealthCommand: vi.fn(function MockDescribeTargetHealthCommand(input: unknown) {
		return input;
	}),
}));

vi.mock("@/lib/aws/sdkClients", () => ({
	getAwsClientConfig: vi.fn((region?: string) => ({
		region,
	})),
}));

describe("runtimeHealthSignals", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when the ECS service has already been deleted", async () => {
		ecsSendMock.mockRejectedValueOnce({
			name: "ServiceNotFoundException",
			message: "Service not found",
		});

		const { getRuntimeEcsHealth } = await import("@/lib/aws/runtimeHealthSignals");

		await expect(
			getRuntimeEcsHealth({
				target: "ecs",
				region: "us-west-2",
				cluster: "cluster-a",
				service: "service-a",
				baseUrl: "https://example.com",
			})
		).resolves.toBeNull();
	});

	it("returns null when the ALB target group has already been deleted", async () => {
		elbSendMock.mockRejectedValueOnce({
			$metadata: { httpStatusCode: 400 },
			Code: "TargetGroupNotFound",
			Error: {
				Code: "TargetGroupNotFound",
				Message: "Target groups 'arn:aws:elasticloadbalancing:us-west-2:123:targetgroup/demo/abc' not found",
			},
			message: "Target groups 'arn:aws:elasticloadbalancing:us-west-2:123:targetgroup/demo/abc' not found",
		});

		const { getRuntimeAlbHealth } = await import("@/lib/aws/runtimeHealthSignals");

		await expect(
			getRuntimeAlbHealth({
				target: "ecs",
				region: "us-west-2",
				cluster: "cluster-a",
				service: "service-a",
				baseUrl: "https://example.com",
				targetGroupArn: "arn:aws:elasticloadbalancing:us-west-2:123:targetgroup/demo/abc",
			})
		).resolves.toBeNull();
	});
});
