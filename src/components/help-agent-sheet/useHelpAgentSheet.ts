"use client";

import * as React from "react";
import {
	helpAgentSheetReducer,
	initialHelpAgentSheetState,
	type ChatMessage,
} from "@/components/help-agent-sheet/types";

export function useHelpAgentSheet() {
	const [state, dispatch] = React.useReducer(helpAgentSheetReducer, initialHelpAgentSheetState);
	const endRef = React.useRef<HTMLDivElement | null>(null);

	React.useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [state.messages, state.pending]);

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

	const setFeedback = React.useCallback((messageId: string, feedback: "helpful" | "unhelpful") => {
		dispatch({ type: "set_feedback", messageId, feedback });
	}, []);

	const askHelpAgent = React.useCallback(
		async (question: string) => {
			const cleaned = question.trim();
			if (!cleaned || state.pending) return;

			const nextUserMessage: ChatMessage = {
				id: `${Date.now()}-user`,
				role: "user",
				content: cleaned,
			};

			dispatch({ type: "submit_question", userMessage: nextUserMessage });

			try {
				const history = [...state.messages, nextUserMessage].slice(-8).map((message) => ({
					role: message.role,
					content: message.content,
				}));

				const response = await fetch("/api/help-agent", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						question: cleaned,
						history,
					}),
				});

				const data = (await response.json()) as {
					answer?: string;
					citations?: string[];
					model?: string;
					responseTimeMs?: number;
					mossRetrievalMs?: number | null;
					error?: string;
				};

				if (!response.ok) {
					throw new Error(data.error || "Help agent request failed");
				}

				dispatch({
					type: "append_messages",
					messages: [
						{
							id: `${Date.now()}-assistant`,
							role: "assistant",
							content: data.answer || "I couldn't generate a response right now.",
							citations: Array.isArray(data.citations) ? data.citations : [],
							model: typeof data.model === "string" ? data.model : undefined,
							responseTimeMs: typeof data.responseTimeMs === "number" ? data.responseTimeMs : undefined,
							mossRetrievalMs:
								typeof data.mossRetrievalMs === "number" || data.mossRetrievalMs === null
									? data.mossRetrievalMs
									: undefined,
						},
					],
				});
			} catch (error) {
				dispatch({
					type: "append_messages",
					messages: [
						{
							id: `${Date.now()}-error`,
							role: "assistant",
							content:
								error instanceof Error
									? `I hit an issue while responding: ${error.message}`
									: "I hit an issue while responding. Please retry.",
						},
					],
				});
			} finally {
				dispatch({ type: "set_pending", value: false });
			}
		},
		[state.messages, state.pending],
	);

	const submitInput = React.useCallback(() => {
		void askHelpAgent(state.input);
	}, [askHelpAgent, state.input]);

	return {
		state,
		endRef,
		dispatch,
		copyAssistantMessage,
		setFeedback,
		askHelpAgent,
		submitInput,
	};
}
