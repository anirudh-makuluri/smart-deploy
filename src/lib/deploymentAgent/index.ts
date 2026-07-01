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
import type { AgentLlmResponse } from "@/lib/deploymentAgent/agentSchemas";
import { MAX_PROMPT_TURNS, MAX_TOOL_CALLS } from "@/lib/deploymentAgent/constants";
import { parseAgentResponseJson } from "@/lib/deploymentAgent/parseAgentResponse";
import { executeToolCall } from "@/lib/deploymentAgent/executeToolCall";
import {
	buildDeploymentAgentAssistantMetadata,
	buildDeploymentAgentLlmTurn,
	buildDeploymentAgentUserMetadata,
	persistDeploymentAgentMessage,
	type DeploymentAgentLlmTurn,
	type DeploymentAgentRunOutcome,
} from "@/lib/deploymentAgent/messagePersistence";
import type { AgentToolName } from "@/lib/deploymentAgent/registry";
import type { AgentEmitter, AgentSocketDocCitation, ToolExecutionResult } from "@/lib/deploymentAgent/types";
import { buildStructuredDataFromToolResults } from "@/lib/deploymentAgent/buildStructuredData";
import { EMPTY_AGENT_STRUCTURED_DATA, type AgentStructuredData } from "@/lib/deploymentAgent/structuredData";
import { collectDocCitationsFromSearchDocsToolResults } from "@/lib/agentDocCitations";
import { callLLMWithFallback, type LLMFallbackResult } from "@/lib/llmProviders";

type AgentDecisionResult = {
	decision: AgentLlmResponse;
	llm: LLMFallbackResult;
};

async function requestAgentDecision(args: {
	message: string;
	conversationHistory: DeploymentAgentConversationTurn[];
	toolCallsUsed: number;
	toolResults: ToolExecutionResult<AgentToolName>[];
}): Promise<AgentDecisionResult> {
	const prompt = buildAgentPrompt(args);
	const llm = await callLLMWithFallback(prompt, {
		contextLabel: "Deployment agent",
		maxTokens: 2048,
		temperature: 0.1,
		localModelDefault: "mistral",
		responseMimeType: "application/json",
	});
	const parsed = parseAgentResponseJson(llm.text);
	if (!parsed) {
		const preview = llm.text.trim().slice(0, 400);
		console.warn("Deployment agent returned invalid JSON", {
			provider: llm.provider,
			model: llm.model,
			preview,
		});
		throw new Error("Deployment agent returned invalid JSON");
	}

	if (parsed.completed && parsed.tool_calls.length > 0) {
		throw new Error("Deployment agent returned tool calls for a completed response");
	}
	if (!parsed.completed && parsed.tool_calls.length !== 1) {
		throw new Error("Deployment agent must return exactly one tool call when work is incomplete");
	}

	return { decision: parsed, llm };
}

function persistAssistantMessage(args: {
	userID: string;
	conversationId: string;
	runId: string;
	content: string;
	outcome: DeploymentAgentRunOutcome;
	completed: boolean;
	toolCallsUsed: number;
	toolResults: ToolExecutionResult<AgentToolName>[];
	llmTurns: DeploymentAgentLlmTurn[];
	durationMs: number;
	promptTurnCount: number;
	errorMessage: string | null;
}) {
	const finalLlmTurn = args.llmTurns.at(-1) ?? null;
	persistDeploymentAgentMessage({
		userID: args.userID,
		conversationId: args.conversationId,
		runId: args.runId,
		role: "assistant",
		content: args.content,
		metadata: buildDeploymentAgentAssistantMetadata({
			outcome: args.outcome,
			completed: args.completed,
			model: finalLlmTurn?.model ?? null,
			provider: finalLlmTurn?.provider ?? null,
			toolCallsUsed: args.toolCallsUsed,
			toolResults: args.toolResults,
			llmTurns: args.llmTurns,
			durationMs: args.durationMs,
			promptTurnCount: args.promptTurnCount,
			errorMessage: args.errorMessage,
		}),
	});
}

function emitAgentEvent(
	emit: AgentEmitter,
	event: Parameters<AgentEmitter>[0],
	runId: string,
	message: string,
	docCitations: AgentSocketDocCitation[] = [],
	structuredData: AgentStructuredData = EMPTY_AGENT_STRUCTURED_DATA
) {
	emit(event, {
		runId,
		message,
		docCitations,
		structuredData,
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
	const runStartedAt = Date.now();
	const toolResults: ToolExecutionResult<AgentToolName>[] = [];
	const llmTurns: DeploymentAgentLlmTurn[] = [];
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
	const promptTurnCount = conversationHistory.length;

	persistDeploymentAgentMessage({
		userID: args.userID,
		conversationId,
		runId,
		role: "user",
		content: message,
		metadata: buildDeploymentAgentUserMetadata({ promptTurnCount }),
	});

	emitAgentEvent(args.emit, "agent:accepted", runId, "I'm looking into that now.");
	emitAgentEvent(args.emit, "agent:status", runId, "Understanding your request.");

	try {
		const runAgentToolLoop = async (toolCallsUsed: number): Promise<boolean> => {
			const { decision, llm } = await requestAgentDecision({
				message,
				conversationHistory,
				toolCallsUsed,
				toolResults,
			});
			llmTurns.push(buildDeploymentAgentLlmTurn({ decision, model: llm.model, provider: llm.provider }));

			if (toolCallsUsed === MAX_TOOL_CALLS || decision.completed || decision.tool_calls.length === 0) {
				const docCitations = collectDocCitationsFromSearchDocsToolResults(toolResults);
				const structuredData = buildStructuredDataFromToolResults(toolResults);
				await appendDeploymentAgentConversationTurn({
					userID: args.userID,
					conversationId,
					turn: {
						role: "assistant",
						content: decision.message,
						timestamp: new Date().toISOString(),
					},
				});
				persistAssistantMessage({
					userID: args.userID,
					conversationId,
					runId,
					content: decision.message,
					outcome: "complete",
					completed: decision.completed,
					toolCallsUsed,
					toolResults,
					llmTurns,
					durationMs: Date.now() - runStartedAt,
					promptTurnCount,
					errorMessage: null,
				});
				emitAgentEvent(args.emit, "agent:message", runId, decision.message, docCitations, structuredData);
				emitAgentEvent(args.emit, "agent:complete", runId, decision.message, docCitations, structuredData);
				return true;
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
			return runAgentToolLoop(toolCallsUsed + 1);
		};

		const completed = await runAgentToolLoop(0);
		if (completed) {
			return;
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
		persistAssistantMessage({
			userID: args.userID,
			conversationId,
			runId,
			content: limitMessage,
			outcome: "tool_limit",
			completed: false,
			toolCallsUsed: MAX_TOOL_CALLS,
			toolResults,
			llmTurns,
			durationMs: Date.now() - runStartedAt,
			promptTurnCount,
			errorMessage: limitMessage,
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
		persistAssistantMessage({
			userID: args.userID,
			conversationId,
			runId,
			content: errorMessage,
			outcome: "error",
			completed: false,
			toolCallsUsed: toolResults.length,
			toolResults,
			llmTurns,
			durationMs: Date.now() - runStartedAt,
			promptTurnCount,
			errorMessage,
		});
		emitAgentEvent(args.emit, "agent:error", runId, errorMessage);
	}
}