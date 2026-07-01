import type { AgentDocCitation } from "@/lib/agentDocCitations";
import { EMPTY_AGENT_STRUCTURED_DATA, type AgentStructuredData } from "@/lib/deploymentAgent/structuredData";

export type AgentActivityKind = "accepted" | "status" | "tool_started" | "tool_completed" | "message";

export type AgentActivityStepStatus = "active" | "done";

export type AgentActivityStep = {
	id: string;
	label: string;
	status: AgentActivityStepStatus;
};

export type DeploymentAgentMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	createdAt: number;
	runId?: string;
	pending?: boolean;
	activity: AgentActivityStep[];
	docCitations: AgentDocCitation[];
	structuredData: AgentStructuredData;
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
	| { type: "sync_agent_progress"; runId: string; kind: AgentActivityKind; content: string }
	| { type: "complete_agent_message"; runId: string; content?: string; docCitations?: AgentDocCitation[]; structuredData?: AgentStructuredData }
	| { type: "reset_conversation" };

function createWelcomeMessage(): DeploymentAgentMessage {
	return {
		id: "welcome",
		role: "assistant",
		content:
			"I can inspect your existing deployments, recent deployment history, and runtime health. Ask what you want me to check.",
		createdAt: Date.now(),
		activity: [],
		docCitations: [],
		structuredData: EMPTY_AGENT_STRUCTURED_DATA,
	};
}

export const initialDeploymentAgentSheetState: DeploymentAgentSheetState = {
	input: "",
	pending: false,
	copiedMessageId: null,
	messages: [createWelcomeMessage()],
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

let activityStepCounter = 0;

function createStepId(): string {
	activityStepCounter += 1;
	return `step-${activityStepCounter}`;
}

function markStepsDone(steps: AgentActivityStep[]): AgentActivityStep[] {
	return steps.map((step) => (step.status === "active" ? { ...step, status: "done" } : step));
}

function pushActiveStep(steps: AgentActivityStep[], label: string): AgentActivityStep[] {
	const trimmed = label.trim();
	if (!trimmed) return steps;

	const last = steps.at(-1);
	if (last && last.label === trimmed) {
		return steps;
	}

	return [...markStepsDone(steps), { id: createStepId(), label: trimmed, status: "active" }];
}

function applyActivityEvent(
	message: DeploymentAgentMessage,
	kind: AgentActivityKind,
	content: string
): DeploymentAgentMessage {
	switch (kind) {
		case "status":
		case "tool_started":
			return { ...message, activity: pushActiveStep(message.activity, content), pending: true };
		case "tool_completed":
			return { ...message, activity: markStepsDone(message.activity), pending: true };
		case "message":
			return { ...message, content, activity: markStepsDone(message.activity), pending: true };
		case "accepted":
		default:
			return { ...message, pending: true };
	}
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
		case "reset_conversation":
			return { ...initialDeploymentAgentSheetState, messages: [createWelcomeMessage()] };
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
				...applyActivityEvent(nextMessages[index], action.kind, action.content),
				runId: action.runId,
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
				structuredData: action.structuredData ?? nextMessages[index].structuredData,
				activity: markStepsDone(nextMessages[index].activity),
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
