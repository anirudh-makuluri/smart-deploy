import { dbHelper } from "@/db-helper";
import type { AgentToolCall, AgentLlmResponse } from "@/lib/deploymentAgent/agentSchemas";
import type { AgentToolName } from "@/lib/deploymentAgent/registry";
import type { ToolExecutionResult } from "@/lib/deploymentAgent/types";
import type { LLMProvider } from "@/lib/llmProviders";

export type DeploymentAgentMessageRole = "user" | "assistant";

export type DeploymentAgentRunOutcome = "complete" | "error" | "tool_limit";

export type DeploymentAgentLlmTurn = {
	message: string;
	toolCalls: AgentToolCall[];
	completed: boolean;
	model: string;
	provider: LLMProvider;
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
	};
}

export function buildDeploymentAgentLlmTurn(args: {
	decision: AgentLlmResponse;
	model: string;
	provider: LLMProvider;
}): DeploymentAgentLlmTurn {
	return {
		message: args.decision.message,
		toolCalls: args.decision.tool_calls,
		completed: args.decision.completed,
		model: args.model,
		provider: args.provider,
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