import { describe, expect, it } from "vitest";
import {
	deploymentAgentSheetReducer,
	initialDeploymentAgentSheetState,
	type DeploymentAgentMessage,
	type DeploymentAgentSheetState,
} from "@/components/deployment-agent-sheet/types";
import { EMPTY_AGENT_STRUCTURED_DATA } from "@/lib/deploymentAgent/structuredData";

const RUN_ID = "run-1";

function buildPendingState(): DeploymentAgentSheetState {
	const userMessage: DeploymentAgentMessage = {
		id: "u1",
		role: "user",
		content: "Show me my deployments",
		createdAt: 1,
		activity: [],
		docCitations: [],
		structuredData: EMPTY_AGENT_STRUCTURED_DATA,
	};
	const assistantMessage: DeploymentAgentMessage = {
		id: "a1",
		role: "assistant",
		content: "",
		createdAt: 2,
		pending: true,
		activity: [],
		docCitations: [],
		structuredData: EMPTY_AGENT_STRUCTURED_DATA,
	};
	return deploymentAgentSheetReducer(initialDeploymentAgentSheetState, {
		type: "submit_question",
		userMessage,
		assistantMessage,
	});
}

function lastAssistant(state: DeploymentAgentSheetState): DeploymentAgentMessage {
	const message = [...state.messages].reverse().find((entry) => entry.role === "assistant");
	if (!message) throw new Error("assistant message missing");
	return message;
}

describe("deploymentAgentSheetReducer", () => {
	it("starts with a single welcome assistant message", () => {
		expect(initialDeploymentAgentSheetState.messages).toHaveLength(1);
		expect(initialDeploymentAgentSheetState.messages[0].role).toBe("assistant");
		expect(initialDeploymentAgentSheetState.pending).toBe(false);
	});

	it("appends user + assistant messages and sets pending on submit", () => {
		const state = buildPendingState();
		expect(state.pending).toBe(true);
		expect(state.messages).toHaveLength(3);
		expect(state.input).toBe("");
		expect(lastAssistant(state).pending).toBe(true);
	});

	it("builds a sequential activity timeline from streamed events", () => {
		let state = buildPendingState();
		state = deploymentAgentSheetReducer(state, {
			type: "sync_agent_progress",
			runId: RUN_ID,
			kind: "status",
			content: "Understanding your request.",
		});
		state = deploymentAgentSheetReducer(state, {
			type: "sync_agent_progress",
			runId: RUN_ID,
			kind: "tool_started",
			content: "Checking your deployments.",
		});

		let activity = lastAssistant(state).activity;
		expect(activity).toHaveLength(2);
		expect(activity[0].status).toBe("done");
		expect(activity[1].status).toBe("active");

		state = deploymentAgentSheetReducer(state, {
			type: "sync_agent_progress",
			runId: RUN_ID,
			kind: "tool_completed",
			content: "Finished checking your deployments.",
		});
		activity = lastAssistant(state).activity;
		expect(activity).toHaveLength(2);
		expect(activity.every((step) => step.status === "done")).toBe(true);
	});

	it("sets content on message events while keeping the run pending", () => {
		let state = buildPendingState();
		state = deploymentAgentSheetReducer(state, {
			type: "sync_agent_progress",
			runId: RUN_ID,
			kind: "message",
			content: "You have 2 active deployments.",
		});
		const assistant = lastAssistant(state);
		expect(assistant.content).toBe("You have 2 active deployments.");
		expect(assistant.pending).toBe(true);
		expect(state.pending).toBe(true);
	});

	it("dedupes consecutive identical step labels and ignores empty ones", () => {
		let state = buildPendingState();
		const emit = (content: string) => {
			state = deploymentAgentSheetReducer(state, {
				type: "sync_agent_progress",
				runId: RUN_ID,
				kind: "status",
				content,
			});
		};
		emit("Understanding your request.");
		emit("Understanding your request.");
		emit("   ");
		expect(lastAssistant(state).activity).toHaveLength(1);
	});

	it("finalizes the message and clears pending on completion", () => {
		let state = buildPendingState();
		state = deploymentAgentSheetReducer(state, {
			type: "sync_agent_progress",
			runId: RUN_ID,
			kind: "tool_started",
			content: "Checking your deployments.",
		});
		state = deploymentAgentSheetReducer(state, {
			type: "complete_agent_message",
			runId: RUN_ID,
			content: "Here is your deployment summary.",
			docCitations: [{ source: "docs", href: "https://example.com", label: "Guide" }],
			structuredData: {
				blocks: [
					{
						kind: "deployment_list",
						deployments: [
							{
								repoName: "smart-deploy",
								serviceName: "web",
								status: "running",
								branch: "main",
								deploymentTarget: "ecs",
								lastDeployment: null,
								hostedUrl: null,
							},
						],
					},
				],
			},
		});

		const assistant = lastAssistant(state);
		expect(state.pending).toBe(false);
		expect(assistant.pending).toBe(false);
		expect(assistant.content).toBe("Here is your deployment summary.");
		expect(assistant.docCitations).toHaveLength(1);
		expect(assistant.structuredData.blocks).toHaveLength(1);
		expect(assistant.activity.every((step) => step.status === "done")).toBe(true);
	});

	it("resets back to the welcome-only state", () => {
		let state = buildPendingState();
		state = deploymentAgentSheetReducer(state, {
			type: "complete_agent_message",
			runId: RUN_ID,
			content: "done",
		});
		state = deploymentAgentSheetReducer(state, { type: "reset_conversation" });
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0].role).toBe("assistant");
		expect(state.pending).toBe(false);
		expect(state.input).toBe("");
	});
});
