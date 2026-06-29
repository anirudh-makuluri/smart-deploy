export type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	citations?: string[];
	model?: string;
	responseTimeMs?: number;
	mossRetrievalMs?: number | null;
};

export type HelpAgentSheetState = {
	input: string;
	pending: boolean;
	copiedMessageId: string | null;
	feedbackByMessageId: Record<string, "helpful" | "unhelpful">;
	messages: ChatMessage[];
};

export type HelpAgentSheetAction =
	| { type: "set_input"; value: string }
	| { type: "set_pending"; value: boolean }
	| { type: "set_copied_message_id"; value: string | null }
	| { type: "set_feedback"; messageId: string; feedback: "helpful" | "unhelpful" }
	| { type: "append_messages"; messages: ChatMessage[] }
	| { type: "submit_question"; userMessage: ChatMessage };

const welcomeMessage: ChatMessage = {
	id: "welcome",
	role: "assistant",
	content:
		"I can help you troubleshoot Smart Deploy using the project docs. Ask what you're stuck on and include exact errors when possible.",
	citations: ["docs/DEBUGGING_DEPLOYMENTS.md", "docs/FAQ.md"],
};

export const initialHelpAgentSheetState: HelpAgentSheetState = {
	input: "",
	pending: false,
	copiedMessageId: null,
	feedbackByMessageId: {},
	messages: [welcomeMessage],
};

export function helpAgentSheetReducer(
	state: HelpAgentSheetState,
	action: HelpAgentSheetAction,
): HelpAgentSheetState {
	switch (action.type) {
		case "set_input":
			return { ...state, input: action.value };
		case "set_pending":
			return { ...state, pending: action.value };
		case "set_copied_message_id":
			return { ...state, copiedMessageId: action.value };
		case "set_feedback":
			return {
				...state,
				feedbackByMessageId: { ...state.feedbackByMessageId, [action.messageId]: action.feedback },
			};
		case "append_messages":
			return { ...state, messages: [...state.messages, ...action.messages] };
		case "submit_question":
			return {
				...state,
				messages: [...state.messages, action.userMessage],
				input: "",
				pending: true,
			};
		default:
			return state;
	}
}
