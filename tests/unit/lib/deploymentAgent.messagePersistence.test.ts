import { describe, expect, it, vi } from "vitest";

const { recordDeploymentAgentMessageMock } = vi.hoisted(() => ({
	recordDeploymentAgentMessageMock: vi.fn(),
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		recordDeploymentAgentMessage: recordDeploymentAgentMessageMock,
	},
}));

import {
	buildDeploymentAgentAssistantMetadata,
	buildDeploymentAgentLlmTurn,
	buildDeploymentAgentUserMetadata,
	persistDeploymentAgentMessage,
} from "@/lib/deploymentAgent/messagePersistence";

describe("deploymentAgent messagePersistence", () => {
	it("builds user metadata with prompt turn count", () => {
		expect(buildDeploymentAgentUserMetadata({ promptTurnCount: 4 })).toEqual({
			kind: "user",
			promptTurnCount: 4,
		});
	});

	it("builds assistant metadata with llm turns and tool results", () => {
		const metadata = buildDeploymentAgentAssistantMetadata({
			outcome: "complete",
			completed: true,
			model: "mistral",
			provider: "local",
			toolCallsUsed: 1,
			toolResults: [
				{
					name: "list_deployments",
					arguments: {},
					result: { deployments: [] },
				},
			],
			llmTurns: [
				{
					message: "Checking deployments.",
					toolCalls: [{ name: "list_deployments", arguments: {} }],
					completed: false,
					model: "mistral",
					provider: "local",
					token_usage: null,
				},
				{
					message: "You have no deployments yet.",
					toolCalls: [],
					completed: true,
					model: "mistral",
					provider: "local",
					token_usage: null,
				},
			],
			durationMs: 1200,
			promptTurnCount: 2,
			errorMessage: null,
		});

		expect(metadata.kind).toBe("assistant");
		expect(metadata.llmTurns).toHaveLength(2);
		expect(metadata.toolResults).toHaveLength(1);
		expect(metadata.token_usage).toBeNull();
	});

	it("aggregates token usage across llm turns on assistant metadata", () => {
		const metadata = buildDeploymentAgentAssistantMetadata({
			outcome: "complete",
			completed: true,
			model: "gemini-2.5-flash",
			provider: "gemini",
			toolCallsUsed: 1,
			toolResults: [],
			llmTurns: [
				{
					message: "Checking deployments.",
					toolCalls: [{ name: "list_deployments", arguments: {} }],
					completed: false,
					model: "gemini-2.5-flash",
					provider: "gemini",
					token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
				},
				{
					message: "You have no deployments yet.",
					toolCalls: [],
					completed: true,
					model: "gemini-2.5-flash",
					provider: "gemini",
					token_usage: { input_tokens: 150, output_tokens: 30, total_tokens: 180 },
				},
			],
			durationMs: 1200,
			promptTurnCount: 2,
			errorMessage: null,
		});

		expect(metadata.token_usage).toEqual({
			input_tokens: 250,
			output_tokens: 50,
			total_tokens: 300,
		});
	});

	it("builds llm turn snapshots from model decisions", () => {
		expect(
			buildDeploymentAgentLlmTurn({
				decision: {
					message: "Checking runtime health.",
					tool_calls: [{ name: "get_runtime_health", arguments: { repoName: "smart-deploy", serviceName: "web" } }],
					completed: false,
				},
				model: "claude-haiku",
				provider: "bedrock",
				token_usage: { input_tokens: 90, output_tokens: 10, total_tokens: 100 },
			})
		).toEqual({
			message: "Checking runtime health.",
			toolCalls: [{ name: "get_runtime_health", arguments: { repoName: "smart-deploy", serviceName: "web" } }],
			completed: false,
			model: "claude-haiku",
			provider: "bedrock",
			token_usage: { input_tokens: 90, output_tokens: 10, total_tokens: 100 },
		});
	});

	it("persists messages without blocking the caller", async () => {
		recordDeploymentAgentMessageMock.mockResolvedValue({ success: true, id: "msg-1" });

		persistDeploymentAgentMessage({
			userID: "user-1",
			conversationId: "conversation-1",
			runId: "550e8400-e29b-41d4-a716-446655440000",
			role: "user",
			content: "Show me my deployments",
			metadata: buildDeploymentAgentUserMetadata({ promptTurnCount: 0 }),
		});

		await Promise.resolve();

		expect(recordDeploymentAgentMessageMock).toHaveBeenCalledWith({
			userID: "user-1",
			conversationId: "conversation-1",
			runId: "550e8400-e29b-41d4-a716-446655440000",
			role: "user",
			content: "Show me my deployments",
			metadata: {
				kind: "user",
				promptTurnCount: 0,
			},
		});
	});
});