import type { DeploymentAgentConversationTurn } from "@/lib/deploymentAgentConversationStore";
import { MAX_PROMPT_TURNS, MAX_TOOL_CALLS } from "@/lib/deploymentAgent/constants";
import { deploymentAgentTools, type AgentToolName } from "@/lib/deploymentAgent/registry";
import type { ToolExecutionResult } from "@/lib/deploymentAgent/types";

function buildToolInstructions() {
	const lines = ["Available tools:", ""];

	const tools = Object.values(deploymentAgentTools);
	for (let index = 0; index < tools.length; index += 1) {
		const tool = tools[index];
		lines.push(`${index + 1}. ${tool.name}`);
		lines.push(tool.whenToUse);
		lines.push(`Arguments: ${tool.argumentDescription}`);
		lines.push("");
	}

	return lines.join("\n");
}

function buildToolNameUnionForPrompt() {
	return Object.keys(deploymentAgentTools).join(" | ");
}

function buildEntityInstructions() {
	return [
		"Field meaning:",
		'- repoName is the deployment repo name only, such as "smart-deploy" or "shop". It is the "repo" in the full GitHub path "owner/repo".',
		'- serviceName is the exact deployed service name inside that repo, such as "web", "api", "worker", or another detected service name.',
		'- A repo can have multiple services, so repoName alone may not be enough for service-specific tools.',
		"",
		"How to choose arguments:",
		"- If the user asks for a broad overview, or you do not know the exact repoName/serviceName yet, call list_deployments first.",
		'- If the user mentions only a service like "api" or "web" but not the repo, do not guess the repoName. Ask a clarifying question or call list_deployments first.',
		'- If the user mentions a full GitHub repo like "acme/smart-deploy", convert that to repoName="smart-deploy" before calling tools.',
		'- If the user mentions only a repo but not a service, do not guess the serviceName unless the tool result already shows there is only one relevant deployment.',
		'- For service-specific tools, pass the exact repoName and serviceName values taken from tool results whenever possible.',
		"",
		"Examples:",
		'- If the deployment list shows repoName="smart-deploy" and serviceName="web", then a valid tool call is {"name":"get_runtime_health","arguments":{"repoName":"smart-deploy","serviceName":"web"}}.',
		'- If the user says "check acme/smart-deploy web", then use repoName="smart-deploy" and serviceName="web".',
		'- If the user says "show me my deployments", use list_deployments.',
		'- If the user says "why did my api deployment fail?" and you do not yet know which repo has serviceName="api", use list_deployments first.',
	].join("\n");
}

function buildConversationHistoryBlock(turns: DeploymentAgentConversationTurn[]): string {
	if (turns.length === 0) return "(no prior conversation)";

	return turns
		.map((turn, index) => `[TURN ${index + 1}] ${turn.role.toUpperCase()}: ${turn.content}`)
		.join("\n");
}

export function buildAgentPrompt(args: {
	message: string;
	conversationHistory: DeploymentAgentConversationTurn[];
	toolCallsUsed: number;
	toolResults: ToolExecutionResult<AgentToolName>[];
}): string {
	const remainingToolCalls = MAX_TOOL_CALLS - args.toolCallsUsed;
	const conversationHistoryBlock = buildConversationHistoryBlock(args.conversationHistory);
	const toolResultsBlock =
		args.toolResults.length > 0
			? args.toolResults
					.map((toolResult, index) =>
						[
							`[TOOL RESULT ${index + 1}]`,
							`name=${toolResult.name}`,
							`arguments=${JSON.stringify(toolResult.arguments)}`,
							JSON.stringify(toolResult.result, null, 2),
						].join("\n")
					)
					.join("\n\n")
			: "(none)";

	return `You are Smart Deploy's deployment agent.
You answer questions about the authenticated user's existing deployments.
Use only the available tools. Never invent repos, services, statuses, or health states.
If the request is ambiguous, ask a clarifying question instead of guessing.
If no tool call is needed, answer directly.

${buildEntityInstructions()}

${buildToolInstructions()}

Return ONLY valid JSON with this shape:
{
  "message": "string",
  "tool_calls": [
    {
      "name": "${buildToolNameUnionForPrompt()}",
      "arguments": {}
    }
  ],
  "completed": true | false
}

Rules:
- message must be user-facing and concise.
- tool_calls must always be present.
- Return at most one tool call in each response.
- If completed is true, tool_calls must be [].
- If completed is false, tool_calls must contain exactly one tool call.
- Remaining tool calls in this run: ${remainingToolCalls}.
- When remaining tool calls is 0, you must set completed=true and tool_calls=[].
- If repoName or serviceName is unknown, ask for clarification with completed=true and tool_calls=[].

RECENT CONVERSATION HISTORY:
${conversationHistoryBlock}

USER MESSAGE:
${args.message}

TOOL RESULTS:
${toolResultsBlock}`;
}

export function buildToolStartedMessage(toolName: AgentToolName): string {
	return deploymentAgentTools[toolName].startedMessage;
}

export function buildToolCompletedMessage(toolName: AgentToolName): string {
	return deploymentAgentTools[toolName].completedMessage;
}