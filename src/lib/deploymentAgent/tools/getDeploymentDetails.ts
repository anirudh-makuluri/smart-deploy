import { z } from "zod";
import { dbHelper } from "@/db-helper";
import { TOOL_HISTORY_RESULT_LIMIT } from "@/lib/deploymentAgent/constants";
import type { AgentToolDefinition, ToolExecutionContext } from "@/lib/deploymentAgent/types";
import { getDeploymentHostedUrl } from "@/lib/hostedUrl";

type DeploymentDetailsResult = {
	deployment: {
		repoName: string;
		serviceName: string;
		status: string;
		branch: string;
		commitSha: string | null;
		revision: number | null;
		deploymentTarget: string;
		region: string;
		hostedUrl: string | null;
		lastDeployment: string | null;
		cloudResources: unknown;
		scanResults: {
			responseId: string | null;
			deployShape: string | null;
			buildStatus: string | null;
			deployUnits: Array<{
				name: string;
				type: string;
				framework: string | null;
				provider: string;
				port: number;
			}>;
		};
	};
};

async function executeGetDeploymentDetails(
	ctx: ToolExecutionContext,
	args: Record<string, unknown>
): Promise<DeploymentDetailsResult> {
	const repoName = String(args.repoName ?? "").trim();
	const serviceName = String(args.serviceName ?? "").trim();
	const response = await dbHelper.getDeploymentForUser(repoName, serviceName, ctx.userID);
	if (response.error || !response.deployment) {
		throw new Error(response.error || "Deployment not found");
	}

	const deployment = response.deployment;
	const scanResults = deployment.scanResults as {
		response_id?: string;
		deploy_shape?: string;
		build_status?: string;
		deploy_units?: Array<{
			name?: string;
			type?: string;
			framework?: string | null;
			provider?: string;
			port?: number;
		}>;
	};

	return {
		deployment: {
			repoName: deployment.repoName,
			serviceName: deployment.serviceName,
			status: deployment.status,
			branch: deployment.branch,
			commitSha: deployment.commitSha,
			revision: deployment.revision,
			deploymentTarget: deployment.deploymentTarget,
			region: deployment.region,
			hostedUrl: getDeploymentHostedUrl(deployment),
			lastDeployment: deployment.lastDeployment,
			cloudResources: deployment.cloudResources,
			scanResults: {
				responseId: scanResults?.response_id ?? deployment.responseId ?? null,
				deployShape: scanResults?.deploy_shape ?? null,
				buildStatus: scanResults?.build_status ?? null,
				deployUnits: Array.isArray(scanResults?.deploy_units)
					? scanResults.deploy_units.slice(0, TOOL_HISTORY_RESULT_LIMIT).map((unit) => ({
							name: String(unit?.name ?? ""),
							type: String(unit?.type ?? ""),
							framework: typeof unit?.framework === "string" ? unit.framework : null,
							provider: String(unit?.provider ?? ""),
							port: typeof unit?.port === "number" ? unit.port : 0,
						}))
					: [],
			},
		},
	};
}

export const getDeploymentDetailsTool = {
	name: "get_deployment_details",
	description: "Get current details for a specific deployment",
	whenToUse: "Use when the user asks about the current state of a specific deployment.",
	argumentDescription: '{"repoName":"string","serviceName":"string"}',
	argsSchema: z.object({
		repoName: z.string().trim().min(1),
		serviceName: z.string().trim().min(1),
	}),
	execute: async (ctx, args) => executeGetDeploymentDetails(ctx, args),
	startedMessage: "Inspecting that deployment's current details.",
	completedMessage: "Finished loading deployment details.",
} satisfies AgentToolDefinition;