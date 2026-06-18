import config from "@/config";
import type { DeployStep } from "@/app/types";
import { getAwsClientConfig } from "@/lib/aws/sdkClients";

export type DeployLogLine = {
	ts: string;
	step_id: string;
	message: string;
};

export type DeployStepSummary = {
	id: string;
	label: string;
	status: DeployStep["status"];
	startedAt?: string;
	endedAt?: string;
	lineCount: number;
};

const LOG_TAIL_MAX_LINES = 20;

async function createS3Client(region: string) {
	const { S3Client } = await import("@aws-sdk/client-s3");
	return new S3Client(getAwsClientConfig(region));
}

export function deployRunLogsS3Key(userId: string, runId: string): string {
	return `deploy-runs/${userId}/${runId}/logs.jsonl`;
}

export function stepsToJsonl(steps: DeployStep[]): string {
	const lines: string[] = [];
	const ts = new Date().toISOString();
	for (const step of steps) {
		for (const message of step.logs ?? []) {
			const record: DeployLogLine = {
				ts: step.endedAt ?? step.startedAt ?? ts,
				step_id: step.id,
				message,
			};
			lines.push(JSON.stringify(record));
		}
	}
	return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function buildStepSummary(steps: DeployStep[]): DeployStepSummary[] {
	return steps.map((step) => ({
		id: step.id,
		label: step.label,
		status: step.status,
		...(step.startedAt ? { startedAt: step.startedAt } : {}),
		...(step.endedAt ? { endedAt: step.endedAt } : {}),
		lineCount: step.logs?.length ?? 0,
	}));
}

export function extractLogTail(steps: DeployStep[], maxLines = LOG_TAIL_MAX_LINES): DeployLogLine[] {
	const tail: DeployLogLine[] = [];
	const ts = new Date().toISOString();
	for (const step of steps) {
		for (const message of step.logs ?? []) {
			tail.push({
				ts: step.endedAt ?? step.startedAt ?? ts,
				step_id: step.id,
				message,
			});
		}
	}
	return tail.slice(-maxLines);
}

export async function uploadDeployRunLogs(args: {
	userId: string;
	runId: string;
	steps: DeployStep[];
	region?: string;
}): Promise<{ logRef: string; stepSummary: DeployStepSummary[]; logTail: DeployLogLine[] } | null> {
	const bucket = config.LOGS_BUCKET?.trim();
	if (!bucket) {
		console.warn("LOGS_BUCKET is not configured; skipping deploy run log upload");
		return null;
	}

	const body = stepsToJsonl(args.steps);
	const key = deployRunLogsS3Key(args.userId, args.runId);
	const region = args.region?.trim() || config.AWS_REGION;
	const client = await createS3Client(region);
	const { PutObjectCommand } = await import("@aws-sdk/client-s3");

	await client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: key,
			Body: body,
			ContentType: "application/x-ndjson",
		})
	);

	return {
		logRef: key,
		stepSummary: buildStepSummary(args.steps),
		logTail: extractLogTail(args.steps),
	};
}

export async function fetchDeployRunLogsFromS3(args: {
	logRef: string;
	region?: string;
}): Promise<DeployLogLine[]> {
	const bucket = config.LOGS_BUCKET?.trim();
	if (!bucket || !args.logRef?.trim()) return [];

	const region = args.region?.trim() || config.AWS_REGION;
	const client = await createS3Client(region);
	const { GetObjectCommand } = await import("@aws-sdk/client-s3");
	const out = await client.send(
		new GetObjectCommand({
			Bucket: bucket,
			Key: args.logRef,
		})
	);
	const text = await out.Body?.transformToString("utf-8");
	if (!text?.trim()) return [];

	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line) as DeployLogLine;
			} catch {
				return { ts: new Date().toISOString(), step_id: "unknown", message: line };
			}
		});
}

/** Rebuild DeployStep[] from JSONL for UI display. */
export function deployStepsFromLogLines(
	stepSummary: DeployStepSummary[],
	lines: DeployLogLine[]
): DeployStep[] {
	const byId = new Map<string, DeployStep>();
	for (const summary of stepSummary) {
		byId.set(summary.id, {
			id: summary.id,
			label: summary.label,
			status: summary.status,
			logs: [],
			...(summary.startedAt ? { startedAt: summary.startedAt } : {}),
			...(summary.endedAt ? { endedAt: summary.endedAt } : {}),
		});
	}
	for (const line of lines) {
		let step = byId.get(line.step_id);
		if (!step) {
			step = {
				id: line.step_id,
				label: line.step_id,
				status: "success",
				logs: [],
			};
			byId.set(line.step_id, step);
		}
		step.logs.push(line.message);
	}
	if (byId.size === 0 && lines.length > 0) {
		return [
			{
				id: "deploy",
				label: "Deploy",
				status: "success",
				logs: lines.map((l) => l.message),
			},
		];
	}
	return Array.from(byId.values());
}
