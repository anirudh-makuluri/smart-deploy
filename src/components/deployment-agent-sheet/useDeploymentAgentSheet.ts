"use client";

import * as React from "react";
import { useWorkerWebSocket } from "@/components/WorkerWebSocketProvider";
import {
	deploymentAgentSheetReducer,
	initialDeploymentAgentSheetState,
	type DeploymentAgentMessage,
} from "@/components/deployment-agent-sheet/types";
import { EMPTY_AGENT_STRUCTURED_DATA } from "@/lib/deploymentAgent/structuredData";

function createConversationId(): string {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}
	return `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useDeploymentAgentSheet() {
	const { latestAgentEvent, runAgent, socketStatus } = useWorkerWebSocket();
	const [state, dispatch] = React.useReducer(
		deploymentAgentSheetReducer,
		initialDeploymentAgentSheetState
	);
	const endRef = React.useRef<HTMLDivElement | null>(null);
	const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
	const [conversationId, setConversationId] = React.useState(createConversationId);

	React.useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [state.messages, state.pending]);

	React.useEffect(() => {
		if (!latestAgentEvent) return;

		const { kind, payload } = latestAgentEvent;
		if (kind === "complete") {
			dispatch({
				type: "complete_agent_message",
				runId: payload.runId,
				content: payload.message,
				docCitations: payload.docCitations,
				structuredData: payload.structuredData,
			});
			window.setTimeout(() => {
				inputRef.current?.focus();
			}, 0);
			return;
		}

		if (kind === "error") {
			dispatch({
				type: "complete_agent_message",
				runId: payload.runId,
				content: payload.message,
				docCitations: payload.docCitations,
				structuredData: payload.structuredData,
			});
			return;
		}

		if (
			kind === "accepted" ||
			kind === "status" ||
			kind === "tool_started" ||
			kind === "tool_completed" ||
			kind === "message"
		) {
			dispatch({
				type: "sync_agent_progress",
				runId: payload.runId,
				kind,
				content: payload.message,
			});
		}
	}, [latestAgentEvent]);

	const copyAssistantMessage = React.useCallback(async (messageId: string, content: string) => {
		try {
			await navigator.clipboard.writeText(content);
			dispatch({ type: "set_copied_message_id", value: messageId });
			window.setTimeout(() => {
				dispatch({ type: "set_copied_message_id", value: null });
			}, 1400);
		} catch {
			// Ignore clipboard errors on unsupported contexts.
		}
	}, []);

	const askDeploymentAgent = React.useCallback(
		(question: string) => {
			const cleaned = question.trim();
			if (!cleaned || state.pending) return;

			const now = Date.now();
			const userMessage: DeploymentAgentMessage = {
				id: `${now}-user`,
				role: "user",
				content: cleaned,
				createdAt: now,
				activity: [],
				docCitations: [],
				structuredData: EMPTY_AGENT_STRUCTURED_DATA,
			};
			const assistantMessage: DeploymentAgentMessage = {
				id: `${now}-assistant`,
				role: "assistant",
				content: "",
				createdAt: now,
				pending: true,
				activity: [],
				docCitations: [],
				structuredData: EMPTY_AGENT_STRUCTURED_DATA,
			};

			dispatch({ type: "submit_question", userMessage, assistantMessage });
			const result = runAgent(conversationId, cleaned);
			if (!result.ok) {
				dispatch({
					type: "complete_agent_message",
					runId: "",
					content: result.error,
				});
			}
		},
		[conversationId, runAgent, state.pending]
	);

	const submitInput = React.useCallback(() => {
		askDeploymentAgent(state.input);
	}, [askDeploymentAgent, state.input]);

	const resetConversation = React.useCallback(() => {
		if (state.pending) return;
		dispatch({ type: "reset_conversation" });
		setConversationId(createConversationId());
		window.setTimeout(() => {
			inputRef.current?.focus();
		}, 0);
	}, [state.pending]);

	const hasConversation = state.messages.some((message) => message.role === "user");

	return {
		state,
		dispatch,
		endRef,
		inputRef,
		socketStatus,
		hasConversation,
		copyAssistantMessage,
		askDeploymentAgent,
		submitInput,
		resetConversation,
	};
}
