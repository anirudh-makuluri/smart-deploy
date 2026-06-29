import { randomUUID } from "crypto";
import {
	appendDeploymentAgentConversationTurn,
	getDeploymentAgentConversationTurns,
	type DeploymentAgentConversationTurn,
} from "@/lib/deploymentAgentConversationStore";
import {
	buildAgentPrompt,
	buildToolCompletedMessage,
	buildToolStartedMessage,
} from "@/lib/deploymentAgent/agentPrompt";
import { AgentResponseSchema, type AgentLlmResponse } from "@/lib/deploymentAgent/agentSchemas";
import {
	JSON_FENCE_REGEX,
	MAX_PROMPT_TURNS,
	MAX_TOOL_CALLS,
} from "@/lib/deploymentAgent/constants";
import { executeToolCall } from "@/lib/deploymentAgent/executeToolCall";
import type { AgentToolName } from "@/lib/deploymentAgent/registry";
import type { AgentEmitter, ToolExecutionResult } from "@/lib/deploymentAgent/types";
import { callLLMWithFallback } from "@/lib/llmProviders";

function parseModelJson(raw: string): AgentLlmResponse | null {
	const fenced = JSON_FENCE_REGEX.exec(raw);
	const candidate = (fenced?.[1] ?? raw).trim();

	try {
		const parsed = JSON.parse(candidate) as unknown;
		return AgentResponseSchema.parse(parsed);
	} catch {
		return null;
	}
}

async function requestAgentDecision(args: {
	message: string;
	conversationHistory: DeploymentAgentConversationTurn[];
	toolCallsUsed: number;
	toolResults: ToolExecutionResult<AgentToolName>[];
}): Promise<AgentLlmResponse> {
	const prompt = buildAgentPrompt(args);
	const llm = await callLLMWithFallback(prompt, {
		contextLabel: "Deployment agent",
		maxTokens: 2048,
		temperature: 0.1,
		localModelDefault: "mistral",
	});
	const parsed = parseModelJson(llm.text);
	if (!parsed) {
		throw new Error("Deployment agent returned invalid JSON");
	}

	if (parsed.completed && parsed.tool_calls.length > 0) {
		throw new Error("Deployment agent returned tool calls for a completed response");
	}
	if (!parsed.completed && parsed.tool_calls.length !== 1) {
		throw new Error("Deployment agent must return exactly one tool call when work is incomplete");
	}

	return parsed;
}

function emitAgentEvent(
	emit: AgentEmitter,
	event: Parameters<AgentEmitter>[0],
	runId: string,
	message: string
) {
	emit(event, {
		runId,
		message,
	});
}

export async function runDeploymentAgent(args: {
	conversationId: string;
	userID: string;
	message: string;
	emit: AgentEmitter;
}): Promise<void> {
	const conversationId = args.conversationId.trim();
	const message = args.message.trim();
	if (!conversationId) {
		throw new Error("Agent conversationId is required");
	}
	if (!message) {
		throw new Error("Agent message is required");
	}

	const runId = randomUUID();
	const toolResults: ToolExecutionResult<AgentToolName>[] = [];
	const userTurn: DeploymentAgentConversationTurn = {
		role: "user",
		content: message,
		timestamp: new Date().toISOString(),
	};

	await appendDeploymentAgentConversationTurn({
		userID: args.userID,
		conversationId,
		turn: userTurn,
	});
	const conversationHistory = await getDeploymentAgentConversationTurns({
		userID: args.userID,
		conversationId,
		limit: MAX_PROMPT_TURNS,
	});

	emitAgentEvent(args.emit, "agent:accepted", runId, "I'm looking into that now.");
	emitAgentEvent(args.emit, "agent:status", runId, "Understanding your request.");

	try {
		for (let toolCallsUsed = 0; toolCallsUsed <= MAX_TOOL_CALLS; toolCallsUsed += 1) {
			const decision = await requestAgentDecision({
				message,
				conversationHistory,
				toolCallsUsed,
				toolResults,
			});

			if (toolCallsUsed === MAX_TOOL_CALLS || decision.completed || decision.tool_calls.length === 0) {
				await appendDeploymentAgentConversationTurn({
					userID: args.userID,
					conversationId,
					turn: {
						role: "assistant",
						content: decision.message,
						timestamp: new Date().toISOString(),
					},
				});
				emitAgentEvent(args.emit, "agent:message", runId, decision.message);
				emitAgentEvent(args.emit, "agent:complete", runId, decision.message);
				return;
			}

			emitAgentEvent(args.emit, "agent:status", runId, decision.message);
			const toolCall = decision.tool_calls[0];
			emitAgentEvent(args.emit, "agent:tool_started", runId, buildToolStartedMessage(toolCall.name));
			const toolResult = await executeToolCall(
				{
					userID: args.userID,
				},
				toolCall
			);
			toolResults.push(toolResult);
			emitAgentEvent(args.emit, "agent:tool_completed", runId, buildToolCompletedMessage(toolCall.name));
		}

		const limitMessage = "I couldn't finish the inspection within the current tool-call limit.";
		await appendDeploymentAgentConversationTurn({
			userID: args.userID,
			conversationId,
			turn: {
				role: "assistant",
				content: limitMessage,
				timestamp: new Date().toISOString(),
			},
		});
		emitAgentEvent(args.emit, "agent:error", runId, limitMessage);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Agent request failed";
		await appendDeploymentAgentConversationTurn({
			userID: args.userID,
			conversationId,
			turn: {
				role: "assistant",
				content: errorMessage,
				timestamp: new Date().toISOString(),
			},
		});
		emitAgentEvent(args.emit, "agent:error", runId, errorMessage);
	}
}