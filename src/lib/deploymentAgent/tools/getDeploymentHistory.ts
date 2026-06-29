import { z } from "zod";
import { dbHelper } from "@/db-helper";
import { TOOL_HISTORY_RESULT_LIMIT } from "@/lib/deploymentAgent/constants";
import type { AgentToolDefinition, ToolExecutionContext } from "@/lib/deploymentAgent/types";
import { parseLimitArg, summarizeLogs } from "@/lib/deploymentAgent/toolArgs";

type DeploymentHistoryResult = {
	history: Array<{
		id: string;
		timestamp: string;
		success: boolean;
		branch: string | null;
		commitSha: string | null;
		failedStep: string | null;
		failureSummary: string | null;
		recentLogs: string[];
	}>;
};

async function executeGetDeploymentHistory(
	ctx: ToolExecutionContext,
	args: Record<string, unknown>
): Promise<DeploymentHistoryResult> {
	const repoName = String(args.repoName ?? "").trim();
	const serviceName = String(args.serviceName ?? "").trim();
	const limit = parseLimitArg(args, "limit", TOOL_HISTORY_RESULT_LIMIT);
	const response = await dbHelper.getDeploymentHistory(repoName, serviceName, ctx.userID, 1, limit);
	if (response.error) {
		throw new Error(typeof response.error === "string" ? response.error : "Failed to load deployment history");
	}

	return {
		history: (response.history ?? []).slice(0, limit).map((entry) => {
			const failedStep = (entry.steps || []).find((step) => step.status === "error") || null;
			const recentLogs = failedStep?.logs?.length
				? summarizeLogs(failedStep.logs)
				: summarizeLogs((entry.steps || []).flatMap((step) => step.logs || []));

			return {
				id: entry.id,
				timestamp: entry.timestamp,
				success: entry.success,
				branch: entry.branch ?? null,
				commitSha: entry.commitSha ?? null,
				failedStep: failedStep?.label ?? failedStep?.id ?? null,
				failureSummary: entry.failureClassification?.summary ?? null,
				recentLogs,
			};
		}),
	};
}

export const getDeploymentHistoryTool = {
	name: "get_deployment_history",
	description: "Get recent deployment history for a specific deployment",
	whenToUse: "Use when the user asks about recent deploy attempts, failures, or last deployment status.",
	argumentDescription: '{"repoName":"string","serviceName":"string","limit":"number optional"}',
	argsSchema: z.object({
		repoName: z.string().trim().min(1),
		serviceName: z.string().trim().min(1),
		limit: z.union([z.number(), z.string()]).optional(),
	}),
	execute: async (ctx, args) => executeGetDeploymentHistory(ctx, args),
	startedMessage: "Reviewing recent deployment history.",
	completedMessage: "Finished reviewing deployment history.",
} satisfies AgentToolDefinition;