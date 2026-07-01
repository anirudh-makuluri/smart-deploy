import type { AgentToolName } from "@/lib/deploymentAgent/registry";
import type {
	AgentDeploymentDetails,
	AgentDeploymentSummary,
	AgentHistoryEntry,
	AgentRuntimeHealthEntry,
	AgentStructuredData,
	AgentStructuredDataBlock,
} from "@/lib/deploymentAgent/structuredData";
import type { ToolExecutionResult } from "@/lib/deploymentAgent/types";

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : String(value ?? "");
}

function asNullableString(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed.length > 0 ? trimmed : null;
}

function asNullableNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapDeploymentSummary(value: unknown): AgentDeploymentSummary | null {
	const record = asRecord(value);
	if (!record) return null;

	return {
		repoName: asString(record.repoName),
		serviceName: asString(record.serviceName),
		status: asString(record.status),
		branch: asString(record.branch),
		deploymentTarget: asString(record.deploymentTarget),
		lastDeployment: asNullableString(record.lastDeployment),
		hostedUrl: asNullableString(record.hostedUrl),
	};
}

function mapDeployUnit(value: unknown) {
	const record = asRecord(value);
	if (!record) return null;

	return {
		name: asString(record.name),
		type: asString(record.type),
		framework: asNullableString(record.framework),
		provider: asString(record.provider),
		port: asNullableNumber(record.port) ?? 0,
	};
}

function mapDeploymentDetails(value: unknown): AgentDeploymentDetails | null {
	const record = asRecord(value);
	if (!record) return null;

	const scanResultsRecord = asRecord(record.scanResults);
	const deployUnits = Array.isArray(scanResultsRecord?.deployUnits)
		? scanResultsRecord.deployUnits
				.map(mapDeployUnit)
				.filter((unit): unit is NonNullable<typeof unit> => unit !== null)
		: [];

	return {
		repoName: asString(record.repoName),
		serviceName: asString(record.serviceName),
		status: asString(record.status),
		branch: asString(record.branch),
		commitSha: asNullableString(record.commitSha),
		revision: asNullableNumber(record.revision),
		deploymentTarget: asString(record.deploymentTarget),
		region: asString(record.region),
		hostedUrl: asNullableString(record.hostedUrl),
		lastDeployment: asNullableString(record.lastDeployment),
		scanResults: {
			deployShape: asNullableString(scanResultsRecord?.deployShape),
			buildStatus: asNullableString(scanResultsRecord?.buildStatus),
			deployUnits,
		},
	};
}

function mapRuntimeHealthEntry(value: unknown): AgentRuntimeHealthEntry | null {
	const record = asRecord(value);
	if (!record) return null;

	return {
		checkedAt: asString(record.checkedAt),
		appStatus: asString(record.appStatus),
		httpStatus: asNullableNumber(record.httpStatus),
		latencyMs: asNullableNumber(record.latencyMs),
		ecsStatus: asNullableString(record.ecsStatus),
		rolloutState: asNullableString(record.rolloutState),
		healthyTargets: asNullableNumber(record.healthyTargets),
		unhealthyTargets: asNullableNumber(record.unhealthyTargets),
	};
}

function mapHistoryEntry(value: unknown): AgentHistoryEntry | null {
	const record = asRecord(value);
	if (!record) return null;

	const recentLogs = Array.isArray(record.recentLogs)
		? record.recentLogs.map((line) => asString(line)).filter((line) => line.length > 0)
		: [];

	return {
		id: asString(record.id),
		timestamp: asString(record.timestamp),
		success: Boolean(record.success),
		branch: asNullableString(record.branch),
		commitSha: asNullableString(record.commitSha),
		failedStep: asNullableString(record.failedStep),
		failureSummary: asNullableString(record.failureSummary),
		recentLogs,
	};
}

function mapToolResultToBlock(toolResult: ToolExecutionResult<AgentToolName>): AgentStructuredDataBlock | null {
	const result = asRecord(toolResult.result);
	if (!result) return null;

	if (toolResult.name === "list_deployments") {
		const deployments = Array.isArray(result.deployments)
			? result.deployments
					.map(mapDeploymentSummary)
					.filter((entry): entry is AgentDeploymentSummary => entry !== null)
			: [];
		if (deployments.length === 0) return null;
		return { kind: "deployment_list", deployments };
	}

	if (toolResult.name === "get_deployment_details") {
		const deployment = mapDeploymentDetails(result.deployment);
		if (!deployment) return null;
		return { kind: "deployment_details", deployment };
	}

	if (toolResult.name === "get_runtime_health") {
		const entries = Array.isArray(result.entries)
			? result.entries
					.map(mapRuntimeHealthEntry)
					.filter((entry): entry is AgentRuntimeHealthEntry => entry !== null)
			: [];
		if (entries.length === 0) return null;

		const args = toolResult.arguments;
		return {
			kind: "runtime_health",
			repoName: asString(args.repoName),
			serviceName: asString(args.serviceName),
			entries,
		};
	}

	if (toolResult.name === "get_deployment_history") {
		const history = Array.isArray(result.history)
			? result.history
					.map(mapHistoryEntry)
					.filter((entry): entry is AgentHistoryEntry => entry !== null)
			: [];
		if (history.length === 0) return null;

		const args = toolResult.arguments;
		return {
			kind: "deployment_history",
			repoName: asString(args.repoName),
			serviceName: asString(args.serviceName),
			history,
		};
	}

	return null;
}

export function buildStructuredDataFromToolResults(
	toolResults: ToolExecutionResult<AgentToolName>[]
): AgentStructuredData {
	const blocks: AgentStructuredDataBlock[] = [];

	for (const toolResult of toolResults) {
		const block = mapToolResultToBlock(toolResult);
		if (block) {
			blocks.push(block);
		}
	}

	return { blocks };
}
