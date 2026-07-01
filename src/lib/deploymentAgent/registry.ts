import { getDeploymentDetailsTool } from "@/lib/deploymentAgent/tools/getDeploymentDetails";
import { getDeploymentHistoryTool } from "@/lib/deploymentAgent/tools/getDeploymentHistory";
import { getRuntimeHealthTool } from "@/lib/deploymentAgent/tools/getRuntimeHealth";
import { listDeploymentsTool } from "@/lib/deploymentAgent/tools/listDeployments";
import { searchDocsTool } from "@/lib/deploymentAgent/tools/searchDocs";
import type { AgentToolDefinition } from "@/lib/deploymentAgent/types";

export const deploymentAgentTools = {
	list_deployments: listDeploymentsTool,
	get_deployment_details: getDeploymentDetailsTool,
	get_deployment_history: getDeploymentHistoryTool,
	get_runtime_health: getRuntimeHealthTool,
	search_docs: searchDocsTool,
} as const satisfies Record<string, AgentToolDefinition>;

export type AgentToolName = keyof typeof deploymentAgentTools;

const registeredToolNames = Object.keys(deploymentAgentTools) as AgentToolName[];

if (registeredToolNames.length === 0) {
	throw new Error("Deployment agent tool registry must contain at least one tool");
}

export const AGENT_TOOL_NAME_TUPLE = registeredToolNames as [AgentToolName, ...AgentToolName[]];

export function getDeploymentAgentTool(toolName: string): AgentToolDefinition | null {
	if (!(toolName in deploymentAgentTools)) {
		return null;
	}
	return deploymentAgentTools[toolName as AgentToolName];
}

export function listDeploymentAgentTools(): AgentToolDefinition[] {
	return Object.values(deploymentAgentTools);
}