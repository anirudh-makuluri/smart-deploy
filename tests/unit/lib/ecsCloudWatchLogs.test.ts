import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-cloudwatch-logs", () => {
	class CloudWatchLogsClient {
		send = sendMock;
	}

	class FilterLogEventsCommand {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}

	class DescribeLogStreamsCommand {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}

	return {
		CloudWatchLogsClient,
		FilterLogEventsCommand,
		DescribeLogStreamsCommand,
	};
});

vi.mock("@/lib/aws/sdkClients", () => ({
	getAwsClientConfig: vi.fn(() => ({})),
}));

vi.mock("@/config", () => ({
	default: {
		AWS_REGION: "us-west-2",
		ECS_LOG_GROUP: "/ecs/smartdeploy-railpack",
	},
}));

import {
	getEcsServiceLogs,
	selectRelevantEcsLogEntries,
	type ServiceLogEntry,
} from "@/lib/aws/ecsCloudWatchLogs";

describe("selectRelevantEcsLogEntries", () => {
	beforeEach(() => {
		sendMock.mockReset();
	});

	it("keeps high-signal ECS crash lines and drops stack-frame noise", () => {
		const logs: ServiceLogEntry[] = [
			{ message: "throw new Error(" },
			{ message: "^" },
			{ message: "Error: Cannot find native binding. npm has a bug related to optional dependencies." },
			{ message: "at Object.<anonymous> (/app/node_modules/@moss-dev/moss-core/index.js:563:11)" },
			{ message: "... 2 lines matching cause stack trace ..." },
			{
				message:
					"[cause]: Error: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found (required by /app/node_modules/@moss-dev/moss-core-linux-x64-gnu/js-binding.linux-x64-gnu.node)",
			},
			{ message: "code: 'ERR_DLOPEN_FAILED'," },
			{
				message:
					"cause: Error: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found (required by /app/node_modules/@moss-dev/moss-core/js-binding.linux-x64-gnu.node)",
			},
			{ message: "at Module._compile (node:internal/modules/cjs/loader:1521:14)" },
		];

		expect(selectRelevantEcsLogEntries(logs)).toEqual([
			{
				message: "Error: Cannot find native binding. npm has a bug related to optional dependencies.",
			},
			{
				message:
					"[cause]: Error: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found (required by /app/node_modules/@moss-dev/moss-core-linux-x64-gnu/js-binding.linux-x64-gnu.node)",
			},
			{ message: "code: 'ERR_DLOPEN_FAILED'," },
			{
				message:
					"cause: Error: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found (required by /app/node_modules/@moss-dev/moss-core/js-binding.linux-x64-gnu.node)",
			},
		]);
	});

	it("falls back to recent non-noisy lines when no error keywords are present", () => {
		const logs: ServiceLogEntry[] = [
			{ message: "Booting application..." },
			{ message: "Listening on port 3000" },
			{ message: "Ready for requests" },
			{ message: "at internal/frame.js:1:1" },
		];

		expect(selectRelevantEcsLogEntries(logs, 2)).toEqual([
			{ message: "Listening on port 3000" },
			{ message: "Ready for requests" },
		]);
	});

	it("scopes CloudWatch reads to matching ECS log streams and rollout start time", async () => {
		sendMock
			.mockResolvedValueOnce({
				logStreams: [
					{ logStreamName: "sd-moss-javascript/app/older", lastEventTimestamp: 10 },
					{ logStreamName: "sd-moss-javascript/app/newer", lastEventTimestamp: 20 },
				],
			})
			.mockResolvedValueOnce({
				events: [{ timestamp: 1_718_879_999_000, message: "boot ok" }],
			});

		const logs = await getEcsServiceLogs({
			ecs: {
				target: "ecs",
				region: "us-west-2",
				cluster: "smart-deploy-cluster",
				service: "sd-moss-javascript",
				baseUrl: "https://example.com",
				logGroup: "/ecs/smartdeploy-railpack",
			},
			limit: 25,
			startTimeMs: 1_718_879_000_000,
		});

		expect((sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input).toEqual({
			logGroupName: "/ecs/smartdeploy-railpack",
			logStreamNamePrefix: "sd-moss-javascript",
			limit: 50,
		});
		expect((sendMock.mock.calls[1]?.[0] as { input: Record<string, unknown> }).input).toEqual({
			logGroupName: "/ecs/smartdeploy-railpack",
			logStreamNames: [
				"sd-moss-javascript/app/newer",
				"sd-moss-javascript/app/older",
			],
			startTime: 1_718_879_000_000,
			limit: 25,
			interleaved: true,
		});
		expect(logs).toEqual([
			{
				timestamp: "2024-06-20T10:39:59.000Z",
				message: "boot ok",
			},
		]);
	});

	it("returns no ECS app logs when stream lookup fails instead of reading the shared group", async () => {
		sendMock.mockRejectedValueOnce(new Error("DescribeLogStreams failed"));

		const logs = await getEcsServiceLogs({
			ecs: {
				target: "ecs",
				region: "us-west-2",
				cluster: "smart-deploy-cluster",
				service: "sd-moss-javascript",
				baseUrl: "https://example.com",
				logGroup: "/ecs/smartdeploy-railpack",
			},
			limit: 25,
		});

		expect(logs).toEqual([]);
		expect(sendMock).toHaveBeenCalledTimes(1);
	});
});
