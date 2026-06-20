import {
	CloudWatchLogsClient,
	FilterLogEventsCommand,
	DescribeLogStreamsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { ECSClient, DescribeServicesCommand } from "@aws-sdk/client-ecs";
import config from "@/config";
import { getAwsClientConfig } from "@/lib/aws/sdkClients";
import type { EcsCloudResources } from "@/app/types";

export type ServiceLogEntry = { timestamp?: string; message?: string };
export type EcsServiceEventEntry = { createdAt?: string; message?: string };

type EcsFailureDiagnostics = {
	serviceEvents: EcsServiceEventEntry[];
	recentLogs: ServiceLogEntry[];
	relevantLogs: ServiceLogEntry[];
	serviceEventsError?: string;
	serviceLogsError?: string;
};

const ECS_HIGH_SIGNAL_RE =
	/\b(error|failed|exception|cannot|can't|missing|not found|denied|refused|timeout|timed out|killed|crash|panic|exit code|exited)\b|ERR_[A-Z0-9_]+|glibc_\d+\.\d+|dlopen/i;
const ECS_NOISE_RE =
	/^(?:\^|throw new Error\(|\.\.\. \d+ lines matching cause stack trace \.\.\.)$/i;
const ECS_STACK_RE = /^\s*at\s+/i;

export async function getEcsServiceLogs(args: {
	ecs: EcsCloudResources;
	limit?: number;
	startTimeMs?: number;
}): Promise<ServiceLogEntry[]> {
	const limit = Math.min(Math.max(args.limit ?? 50, 1), 5000);
	const logGroup = args.ecs.logGroup?.trim() || config.ECS_LOG_GROUP?.trim();
	if (!logGroup) return [];

	const region = args.ecs.region?.trim() || config.AWS_REGION;
	const client = new CloudWatchLogsClient(getAwsClientConfig(region));
	const streamPrefix = args.ecs.service?.trim();

	let logStreamNames: string[] | undefined;
	if (streamPrefix) {
		try {
			const streams = await client.send(
				new DescribeLogStreamsCommand({
					logGroupName: logGroup,
					logStreamNamePrefix: streamPrefix,
					limit: 50,
				})
			);
			logStreamNames = (streams.logStreams ?? [])
				.slice()
				.sort((a, b) => (b.lastEventTimestamp ?? 0) - (a.lastEventTimestamp ?? 0))
				.map((s) => s.logStreamName)
				.filter((name): name is string => Boolean(name))
				.slice(0, 10);
		} catch {
			// Avoid falling back to the whole shared log group, which can surface unrelated apps.
			return [];
		}
	}

	if (streamPrefix && (!logStreamNames || logStreamNames.length === 0)) {
		return [];
	}

	const filter = await client.send(
		new FilterLogEventsCommand({
			logGroupName: logGroup,
			...(logStreamNames && logStreamNames.length > 0 ? { logStreamNames } : {}),
			...(typeof args.startTimeMs === "number" ? { startTime: args.startTimeMs } : {}),
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

export async function getEcsServiceEvents(args: {
	ecs: EcsCloudResources;
	limit?: number;
}): Promise<EcsServiceEventEntry[]> {
	const limit = Math.min(Math.max(args.limit ?? 5, 1), 25);
	const region = args.ecs.region?.trim() || config.AWS_REGION;
	const cluster = args.ecs.cluster?.trim();
	const service = args.ecs.service?.trim();
	if (!cluster || !service) return [];

	const client = new ECSClient(getAwsClientConfig(region));
	const response = await client.send(
		new DescribeServicesCommand({
			cluster,
			services: [service],
		})
	);
	const events = (response.services?.[0]?.events ?? []).slice(0, limit).reverse();
	return events.map((event) => ({
		createdAt: event.createdAt ? new Date(event.createdAt).toISOString() : undefined,
		message: event.message?.trim() ?? "",
	}));
}

export function selectRelevantEcsLogEntries(
	entries: ServiceLogEntry[],
	limit = 12
): ServiceLogEntry[] {
	const cappedLimit = Math.min(Math.max(limit, 1), 50);
	const deduped: ServiceLogEntry[] = [];
	let previousKey = "";

	for (const entry of entries) {
		const message = entry.message?.trim() ?? "";
		if (!message) continue;
		const key = `${entry.timestamp ?? ""}|${message}`;
		if (key === previousKey) continue;
		previousKey = key;
		deduped.push({
			timestamp: entry.timestamp,
			message,
		});
	}

	const signalEntries = deduped.filter((entry) => {
		const message = entry.message?.trim() ?? "";
		if (!message) return false;
		if (ECS_NOISE_RE.test(message)) return false;
		if (ECS_STACK_RE.test(message)) return false;
		return ECS_HIGH_SIGNAL_RE.test(message);
	});

	if (signalEntries.length > 0) {
		return signalEntries.slice(-cappedLimit);
	}

	const fallbackEntries = deduped.filter((entry) => {
		const message = entry.message?.trim() ?? "";
		if (!message) return false;
		if (ECS_NOISE_RE.test(message)) return false;
		return !ECS_STACK_RE.test(message);
	});

	return fallbackEntries.slice(-cappedLimit);
}

export async function collectEcsFailureDiagnostics(args: {
	ecs: EcsCloudResources;
	logLimit?: number;
	relevantLogLimit?: number;
	eventLimit?: number;
}): Promise<EcsFailureDiagnostics> {
	const diagnostics: EcsFailureDiagnostics = {
		serviceEvents: [],
		recentLogs: [],
		relevantLogs: [],
	};

	try {
		diagnostics.serviceEvents = await getEcsServiceEvents({
			ecs: args.ecs,
			limit: args.eventLimit,
		});
	} catch (error) {
		diagnostics.serviceEventsError = error instanceof Error ? error.message : String(error);
	}

	try {
		diagnostics.recentLogs = await getEcsServiceLogs({
			ecs: args.ecs,
			limit: args.logLimit,
		});
		diagnostics.relevantLogs = selectRelevantEcsLogEntries(
			diagnostics.recentLogs,
			args.relevantLogLimit
		);
	} catch (error) {
		diagnostics.serviceLogsError = error instanceof Error ? error.message : String(error);
	}

	return diagnostics;
}
