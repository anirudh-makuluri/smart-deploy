import config from "../../config";
import { EC2Client, GetConsoleOutputCommand } from "@aws-sdk/client-ec2";
import {
	SSMClient,
	SendCommandCommand,
	GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm";

type LogEntry = { timestamp?: string; message?: string };

type StreamParams = {
	instanceId: string;
	region: string;
	serviceName?: string;
	ws: any;
};

function getClientConfig(region: string) {
	const clientConfig: {
		region: string;
		credentials?: { accessKeyId: string; secretAccessKey: string };
	} = { region };

	if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
		clientConfig.credentials = {
			accessKeyId: config.AWS_ACCESS_KEY_ID,
			secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
		};
	}

	return clientConfig;
}

function sanitizeConsoleOutput(raw: string): string {
	return raw
		.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
		.replace(/\x1b\][^\x07]*\x07/g, "")
		.replace(/\x1b[()][AB012]/g, "")
		.replace(/\x1b[^[\]()a-zA-Z]?[a-zA-Z]/g, "")
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
		.replace(/[\u2190-\u21FF]/g, "")
		.replace(/[\u2600-\u26FF]/g, "")
		.replace(/[\u2700-\u27BF]/g, "")
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\n{3,}/g, "\n\n");
}

function parseLogLines(raw: string): LogEntry[] {
	const lines = sanitizeConsoleOutput(raw)
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	const parsed: LogEntry[] = [];
	for (const line of lines) {
		const withoutComposePrefix = line.includes("|") ? line.split("|").slice(1).join("|").trim() : line;
		const m = withoutComposePrefix.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+(.*)$/);
		if (m) {
			parsed.push({ timestamp: m[1], message: m[2] });
		} else {
			parsed.push({ timestamp: new Date().toISOString(), message: line });
		}
	}

	return parsed;
}

async function runSsmShell(instanceId: string, region: string, shellCommand: string): Promise<string> {
	const client = new SSMClient(getClientConfig(region));
	const sendRes = await client.send(
		new SendCommandCommand({
			InstanceIds: [instanceId],
			DocumentName: "AWS-RunShellScript",
			Parameters: { commands: [shellCommand] },
		})
	);

	const commandId = sendRes.Command?.CommandId;
	if (!commandId) throw new Error("SSM did not return command id");

	const deadline = Date.now() + 60_000;
	const terminalStates = new Set(["Success", "Failed", "Cancelled", "TimedOut"]);

	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 1500));
		const invocation = await client.send(
			new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: instanceId })
		);
		const status = invocation.Status;
		if (status && terminalStates.has(status)) {
			const stdout = invocation.StandardOutputContent ?? "";
			const stderr = invocation.StandardErrorContent ?? "";
			if (status !== "Success" && stderr) {
				throw new Error(stderr.trim());
			}
			return stdout + (stderr ? `\n${stderr}` : "");
		}
	}

	throw new Error("Timed out waiting for SSM command output");
}

async function getConsoleOutput(instanceId: string, region: string): Promise<string> {
	const client = new EC2Client(getClientConfig(region));
	const response = await client.send(new GetConsoleOutputCommand({ InstanceId: instanceId, Latest: true }));
	const output = response.Output;
	if (!output) return "";
	return Buffer.from(output, "base64").toString("utf8");
}

function buildDockerLogsCommand(serviceName?: string, sinceIso?: string, tail: number = 150): string {
	const serviceArg = serviceName?.trim() ? ` ${serviceName.trim()}` : "";
	const sinceArg = sinceIso?.trim() ? ` --since '${sinceIso.trim()}'` : "";

	return [
		"set -e",
		"cd /home/ec2-user/app",
		`docker compose logs --no-color --timestamps --tail ${tail}${sinceArg}${serviceArg} 2>/dev/null || true`,
		`docker-compose logs --no-color --timestamps --tail ${tail}${sinceArg}${serviceArg} 2>/dev/null || true`,
	].join("; ");
}

export async function getInitialEc2ServiceLogs(params: {
	instanceId: string;
	region: string;
	serviceName?: string;
	limit?: number;
}): Promise<LogEntry[]> {
	const { instanceId, region, serviceName, limit = 200 } = params;
	try {
		const raw = await runSsmShell(instanceId, region, buildDockerLogsCommand(serviceName, undefined, limit));
		const logs = parseLogLines(raw);
		if (logs.length > 0) return logs;
	} catch {
		// Fall back to console output if SSM/docker logs are unavailable
	}

	const consoleOut = await getConsoleOutput(instanceId, region);
	return parseLogLines(consoleOut).slice(-Math.max(1, limit));
}

export function streamEc2ServiceLogs(params: StreamParams): () => void {
	const { instanceId, region, serviceName, ws } = params;
	let stopped = false;
	let isPolling = false;
	let sinceIso = new Date(Date.now() - 60_000).toISOString();
	const sentKeys = new Set<string>();

	const sendStreamLog = (entry: LogEntry) => {
		if (!entry.message?.trim()) return;
		const key = `${entry.timestamp || ""}|${entry.message}`;
		if (sentKeys.has(key)) return;
		sentKeys.add(key);
		if (sentKeys.size > 5000) {
			const first = sentKeys.values().next().value;
			if (first) sentKeys.delete(first);
		}

		if (ws?.readyState === ws?.OPEN) {
			ws.send(
				JSON.stringify({
					type: "stream_logs",
					payload: {
						log: {
							timestamp: entry.timestamp || new Date().toISOString(),
							message: entry.message,
						},
					},
				})
			);
		}

		if (entry.timestamp && !Number.isNaN(new Date(entry.timestamp).getTime())) {
			sinceIso = entry.timestamp;
		}
	};

	const poll = async () => {
		if (stopped || isPolling) return;
		isPolling = true;
		try {
			const raw = await runSsmShell(instanceId, region, buildDockerLogsCommand(serviceName, sinceIso, 100));
			const entries = parseLogLines(raw);
			for (const e of entries) sendStreamLog(e);
		} catch {
			try {
				const fallback = await getConsoleOutput(instanceId, region);
				const entries = parseLogLines(fallback).slice(-20);
				for (const e of entries) sendStreamLog(e);
			} catch {
				// Ignore poll errors and retry on next interval
			}
		} finally {
			isPolling = false;
		}
	};

	const interval = setInterval(poll, 5000);
	poll().catch(() => undefined);

	const stop = () => {
		stopped = true;
		clearInterval(interval);
	};

	ws.on("close", stop);
	return stop;
}
