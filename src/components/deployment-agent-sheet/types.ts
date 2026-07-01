import type { AgentDocCitation } from "@/lib/agentDocCitations";

export type DeploymentAgentMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	runId?: string;
	pending?: boolean;
	docCitations: AgentDocCitation[];
};

export type DeploymentAgentSheetState = {
	input: string;
	pending: boolean;
	copiedMessageId: string | null;
	messages: DeploymentAgentMessage[];
};

export type DeploymentAgentSheetAction =
	| { type: "set_input"; value: string }
	| { type: "set_copied_message_id"; value: string | null }
	| { type: "submit_question"; userMessage: DeploymentAgentMessage; assistantMessage: DeploymentAgentMessage }
	| { type: "sync_agent_progress"; runId: string; content: string }
	| { type: "complete_agent_message"; runId: string; content?: string; docCitations?: AgentDocCitation[] };

const welcomeMessage: DeploymentAgentMessage = {
	id: "welcome",
	role: "assistant",
	content:
		"I can inspect your existing deployments, recent deployment history, and runtime health. Ask what you want me to check.",
	docCitations: [],
};

export const initialDeploymentAgentSheetState: DeploymentAgentSheetState = {
	input: "",
	pending: false,
	copiedMessageId: null,
	messages: [welcomeMessage],
};

function findPendingAssistantIndex(messages: DeploymentAgentMessage[], runId: string) {
	const byRunId = messages.findIndex((message) => message.role === "assistant" && message.runId === runId);
	if (byRunId >= 0) return byRunId;

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === "assistant" && message.pending) {
			return index;
		}
	}

	return -1;
}

export function deploymentAgentSheetReducer(
	state: DeploymentAgentSheetState,
	action: DeploymentAgentSheetAction
): DeploymentAgentSheetState {
	switch (action.type) {
		case "set_input":
			return { ...state, input: action.value };
		case "set_copied_message_id":
			return { ...state, copiedMessageId: action.value };
		case "submit_question":
			return {
				...state,
				input: "",
				pending: true,
				messages: [...state.messages, action.userMessage, action.assistantMessage],
			};
		case "sync_agent_progress": {
			const index = findPendingAssistantIndex(state.messages, action.runId);
			if (index < 0) return state;

			const nextMessages = [...state.messages];
			nextMessages[index] = {
				...nextMessages[index],
				runId: action.runId,
				content: action.content,
				pending: true,
			};

			return {
				...state,
				messages: nextMessages,
				pending: true,
			};
		}
		case "complete_agent_message": {
			const index = findPendingAssistantIndex(state.messages, action.runId);
			if (index < 0) return { ...state, pending: false };

			const nextMessages = [...state.messages];
			nextMessages[index] = {
				...nextMessages[index],
				runId: action.runId,
				content: action.content ?? nextMessages[index].content,
				docCitations: action.docCitations ?? nextMessages[index].docCitations,
				pending: false,
			};

			return {
				...state,
				messages: nextMessages,
				pending: false,
			};
		}
		default:
			return state;
	}
}
