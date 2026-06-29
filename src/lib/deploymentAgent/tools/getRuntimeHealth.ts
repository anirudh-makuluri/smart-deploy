import { z } from "zod";
import { dbHelper } from "@/db-helper";
import { TOOL_HISTORY_RESULT_LIMIT } from "@/lib/deploymentAgent/constants";
import type { AgentToolDefinition, ToolExecutionContext } from "@/lib/deploymentAgent/types";
import { listRuntimeHealthSamples } from "@/lib/runtimeHealthStore";

type RuntimeHealthResult = {
	entries: Array<{
		checkedAt: string;
		appStatus: string;
		httpStatus: number | null;
		latencyMs: number | null;
		ecsStatus: string | null;
		rolloutState: string | null;
		healthyTargets: number | null;
		unhealthyTargets: number | null;
	}>;
};

async function executeGetRuntimeHealth(
	ctx: ToolExecutionContext,
	args: Record<string, unknown>
): Promise<RuntimeHealthResult> {
	const repoName = String(args.repoName ?? "").trim();
	const serviceName = String(args.serviceName ?? "").trim();
	const deploymentResponse = await dbHelper.getDeploymentForUser(repoName, serviceName, ctx.userID);
	if (deploymentResponse.error || !deploymentResponse.deployment) {
		throw new Error(deploymentResponse.error || "Deployment not found");
	}

	const entries = await listRuntimeHealthSamples({
		userID: ctx.userID,
		repoName,
		serviceName,
	});

	return {
		entries: entries.slice(-TOOL_HISTORY_RESULT_LIMIT).reverse().map((entry) => ({
			checkedAt: entry.checkedAt,
			appStatus: entry.app.overallStatus,
			httpStatus: entry.app.httpStatus,
			latencyMs: entry.app.latencyMs,
			ecsStatus: entry.ecs?.status ?? null,
			rolloutState: entry.ecs?.rolloutState ?? null,
			healthyTargets: entry.alb?.healthyTargetCount ?? null,
			unhealthyTargets: entry.alb?.unhealthyTargetCount ?? null,
		})),
	};
}

export const getRuntimeHealthTool = {
	name: "get_runtime_health",
	description: "Get current runtime health for a specific deployment",
	whenToUse: "Use when the user asks if a deployment is healthy right now.",
	argumentDescription: '{"repoName":"string","serviceName":"string"}',
	argsSchema: z.object({
		repoName: z.string().trim().min(1),
		serviceName: z.string().trim().min(1),
	}),
	execute: async (ctx, args) => executeGetRuntimeHealth(ctx, args),
	startedMessage: "Checking current runtime health.",
	completedMessage: "Finished checking runtime health.",
} satisfies AgentToolDefinition;