import { z } from "zod";
import { dbHelper } from "@/db-helper";
import type { AgentToolDefinition, ToolExecutionContext } from "@/lib/deploymentAgent/types";
import { getDeploymentHostedUrl } from "@/lib/hostedUrl";

type ListDeploymentsResult = {
	deployments: Array<{
		repoName: string;
		serviceName: string;
		status: string;
		branch: string;
		deploymentTarget: string;
		lastDeployment: string | null;
		hostedUrl: string | null;
	}>;
};

async function executeListDeployments(ctx: ToolExecutionContext): Promise<ListDeploymentsResult> {
	const response = await dbHelper.getUserDeployments(ctx.userID);
	if (response.error) {
		throw new Error(typeof response.error === "string" ? response.error : "Failed to load deployments");
	}

	return {
		deployments: (response.deployments ?? [])
			.slice(0, 25)
			.map((deployment) => ({
				repoName: deployment.repoName,
				serviceName: deployment.serviceName,
				status: deployment.status,
				branch: deployment.branch,
				deploymentTarget: deployment.deploymentTarget,
				lastDeployment: deployment.lastDeployment,
				hostedUrl: getDeploymentHostedUrl(deployment),
			})),
	};
}

export const listDeploymentsTool = {
	name: "list_deployments",
	description: "List deployments for the authenticated user",
	whenToUse: "Use when the user asks for a list, overview, or when repo/service context is missing.",
	argumentDescription: "{}",
	argsSchema: z.object({}),
	execute: async (ctx) => executeListDeployments(ctx),
	startedMessage: "Checking your deployments.",
	completedMessage: "Finished checking your deployments.",
} satisfies AgentToolDefinition;