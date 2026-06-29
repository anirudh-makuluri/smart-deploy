import { getDeploymentAgentTool, type AgentToolName } from "@/lib/deploymentAgent/registry";
import type { ToolExecutionContext, ToolExecutionResult } from "@/lib/deploymentAgent/types";
import { normalizeToolArguments } from "@/lib/deploymentAgent/toolArgs";

type AgentToolCallInput = {
	name: AgentToolName;
	arguments: Record<string, unknown>;
};

export async function executeToolCall(
	ctx: ToolExecutionContext,
	toolCall: AgentToolCallInput
): Promise<ToolExecutionResult<AgentToolName>> {
	const tool = getDeploymentAgentTool(toolCall.name);
	if (!tool) {
		throw new Error(`Unsupported tool: ${toolCall.name}`);
	}

	const normalizedArguments = normalizeToolArguments(toolCall.arguments);
	const parsedArguments = tool.argsSchema.parse(normalizedArguments);

	return {
		name: toolCall.name,
		arguments: parsedArguments,
		result: await tool.execute(ctx, parsedArguments),
	};
}