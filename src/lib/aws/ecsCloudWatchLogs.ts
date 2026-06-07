import {
	CloudWatchLogsClient,
	FilterLogEventsCommand,
	DescribeLogStreamsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import config from "@/config";
import { getAwsClientConfig } from "@/lib/aws/sdkClients";
import type { EcsCloudResources } from "@/app/types";

export type ServiceLogEntry = { timestamp?: string; message?: string };

export async function getEcsServiceLogs(args: {
	ecs: EcsCloudResources;
	limit?: number;
}): Promise<ServiceLogEntry[]> {
	const limit = Math.min(Math.max(args.limit ?? 50, 1), 5000);
	const logGroup = args.ecs.logGroup?.trim() || config.ECS_LOG_GROUP?.trim();
	if (!logGroup) return [];

	const region = args.ecs.region?.trim() || config.AWS_REGION;
	const client = new CloudWatchLogsClient(getAwsClientConfig(region));
	const streamPrefix = args.ecs.service;

	let logStreamNames: string[] | undefined;
	try {
		const streams = await client.send(
			new DescribeLogStreamsCommand({
				logGroupName: logGroup,
				logStreamNamePrefix: streamPrefix,
				orderBy: "LastEventTime",
				descending: true,
				limit: 5,
			})
		);
		logStreamNames = (streams.logStreams ?? [])
			.map((s) => s.logStreamName)
			.filter((name): name is string => Boolean(name));
	} catch {
		logStreamNames = undefined;
	}

	const filter = await client.send(
		new FilterLogEventsCommand({
			logGroupName: logGroup,
			...(logStreamNames && logStreamNames.length > 0 ? { logStreamNames } : {}),
			limit,
			interleaved: true,
		})
	);

	const events = (filter.events ?? []).slice(-limit);
	return events.map((event) => ({
		timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : undefined,
		message: event.message?.trim() ?? "",
	}));
}
