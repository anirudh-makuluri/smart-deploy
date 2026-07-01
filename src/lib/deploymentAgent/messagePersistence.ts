import { dbHelper } from "@/db-helper";
import type { AgentToolCall, AgentLlmResponse } from "@/lib/deploymentAgent/agentSchemas";
import type { AgentToolName } from "@/lib/deploymentAgent/registry";
import type { ToolExecutionResult } from "@/lib/deploymentAgent/types";
import type { LlmTokenUsage, LLMProvider } from "@/lib/llmProviders";

export type DeploymentAgentMessageRole = "user" | "assistant";

export type DeploymentAgentRunOutcome = "complete" | "error" | "tool_limit";

export type DeploymentAgentLlmTurn = {
	message: string;
	toolCalls: AgentToolCall[];
	completed: boolean;
	model: string;
	provider: LLMProvider;
	token_usage: LlmTokenUsage | null;
};

export type DeploymentAgentUserMessageMetadata = {
	kind: "user";
	promptTurnCount: number;
};

export type DeploymentAgentAssistantMessageMetadata = {
	kind: "assistant";
	outcome: DeploymentAgentRunOutcome;
	completed: boolean;
	model: string | null;
	provider: LLMProvider | null;
	toolCallsUsed: number;
	toolResults: ToolExecutionResult<AgentToolName>[];
	llmTurns: DeploymentAgentLlmTurn[];
	durationMs: number;
	promptTurnCount: number;
	errorMessage: string | null;
	token_usage: LlmTokenUsage | null;
};

export type DeploymentAgentMessageMetadata =
	| DeploymentAgentUserMessageMetadata
	| DeploymentAgentAssistantMessageMetadata;

export function buildDeploymentAgentUserMetadata(args: {
	promptTurnCount: number;
}): DeploymentAgentUserMessageMetadata {
	return {
		kind: "user",
		promptTurnCount: args.promptTurnCount,
	};
}

export function buildDeploymentAgentAssistantMetadata(args: {
	outcome: DeploymentAgentRunOutcome;
	completed: boolean;
	model: string | null;
	provider: LLMProvider | null;
	toolCallsUsed: number;
	toolResults: ToolExecutionResult<AgentToolName>[];
	llmTurns: DeploymentAgentLlmTurn[];
	durationMs: number;
	promptTurnCount: number;
	errorMessage: string | null;
}): DeploymentAgentAssistantMessageMetadata {
	return {
		kind: "assistant",
		outcome: args.outcome,
		completed: args.completed,
		model: args.model,
		provider: args.provider,
		toolCallsUsed: args.toolCallsUsed,
		toolResults: args.toolResults,
		llmTurns: args.llmTurns,
		durationMs: args.durationMs,
		promptTurnCount: args.promptTurnCount,
		errorMessage: args.errorMessage,
		token_usage: aggregateTokenUsage(args.llmTurns),
	};
}

export function buildDeploymentAgentLlmTurn(args: {
	decision: AgentLlmResponse;
	model: string;
	provider: LLMProvider;
	token_usage: LlmTokenUsage | null;
}): DeploymentAgentLlmTurn {
	return {
		message: args.decision.message,
		toolCalls: args.decision.tool_calls,
		completed: args.decision.completed,
		model: args.model,
		provider: args.provider,
		token_usage: args.token_usage,
	};
}

function aggregateTokenUsage(llmTurns: DeploymentAgentLlmTurn[]): LlmTokenUsage | null {
	let inputTokens = 0;
	let outputTokens = 0;
	let hasUsage = false;

	for (const turn of llmTurns) {
		if (!turn.token_usage) {
			continue;
		}
		hasUsage = true;
		inputTokens += turn.token_usage.input_tokens;
		outputTokens += turn.token_usage.output_tokens;
	}

	if (!hasUsage) {
		return null;
	}

	return {
		input_tokens: inputTokens,
		output_tokens: outputTokens,
		total_tokens: inputTokens + outputTokens,
	};
}

export function persistDeploymentAgentMessage(args: {
	userID: string;
	conversationId: string;
	runId: string;
	role: DeploymentAgentMessageRole;
	content: string;
	metadata: DeploymentAgentMessageMetadata;
}): void {
	void dbHelper
		.recordDeploymentAgentMessage({
			userID: args.userID,
			conversationId: args.conversationId,
			runId: args.runId,
			role: args.role,
			content: args.content,
			metadata: args.metadata,
		})
		.catch((error) => {
			console.warn("Failed to persist deployment agent message", error);
		});
}