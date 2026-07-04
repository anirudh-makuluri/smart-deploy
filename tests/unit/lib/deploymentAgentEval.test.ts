import { describe, expect, it } from "vitest";
import {
	buildDeploymentAgentEvalRun,
	deriveEvalIntent,
	deriveExpectedToolPath,
	deriveSuggestedFailureMode,
} from "@/lib/deploymentAgentEval";

describe("deploymentAgentEval", () => {
	it("derives failure diagnosis intent from message and tool path", () => {
		expect(
			deriveEvalIntent({
				userMessage: "Why did my deployment fail?",
				toolNames: ["get_deployment_history"],
				repoName: "smart-deploy",
				serviceName: "web",
			})
		).toBe("failure_diagnosis");
	});

	it("derives runtime health intent from tool usage", () => {
		expect(
			deriveEvalIntent({
				userMessage: "Is it healthy right now?",
				toolNames: ["get_runtime_health"],
				repoName: "smart-deploy",
				serviceName: "web",
			})
		).toBe("runtime_health");
	});

	it("suggests too_shallow when failure diagnosis skipped docs lookup", () => {
		expect(
			deriveSuggestedFailureMode({
				intent: "failure_diagnosis",
				outcome: "complete",
				toolNames: ["get_deployment_history"],
				assistantMessage: "The deployment failed in the build step.",
				userMessage: "Why did it fail?",
			})
		).toBe("too_shallow");
	});

	it("suggests tool_limit directly from run outcome", () => {
		expect(
			deriveSuggestedFailureMode({
				intent: "overview",
				outcome: "tool_limit",
				toolNames: ["list_deployments"],
				assistantMessage: "I could not finish.",
				userMessage: "Show me my deployments",
			})
		).toBe("tool_limit");
	});

	it("maps expected tool paths by intent", () => {
		expect(deriveExpectedToolPath("current_status")).toBe("get_deployment_details");
		expect(deriveExpectedToolPath("ambiguous_lookup")).toBe("clarify_or_list_deployments");
	});

	it("builds eval runs from persisted assistant metadata", () => {
		const run = buildDeploymentAgentEvalRun({
			assistantMessage: {
				id: "assistant-1",
				user_id: "user-1",
				conversation_id: "conversation-1",
				run_id: "550e8400-e29b-41d4-a716-446655440000",
				content: "Your web deployment looks healthy.",
				metadata: {
					outcome: "complete",
					completed: true,
					durationMs: 1400,
					promptTurnCount: 2,
					toolCallsUsed: 1,
					model: "gemini-2.5-flash",
					provider: "gemini",
					token_usage: {
						total_tokens: 320,
					},
					toolResults: [
						{
							name: "get_runtime_health",
							arguments: {
								repoName: "smart-deploy",
								serviceName: "web",
							},
							result: {
								entries: [],
							},
						},
					],
				},
				created_at: "2026-07-03T00:00:00.000Z",
			},
			userMessage: "Is smart-deploy web healthy?",
		});

		expect(run.autoIntent).toBe("runtime_health");
		expect(run.expectedToolPath).toBe("get_runtime_health");
		expect(run.actualToolPath).toBe("get_runtime_health");
		expect(run.resolvedRepoName).toBe("smart-deploy");
		expect(run.resolvedServiceName).toBe("web");
		expect(run.tokenTotal).toBe(320);
	});
});
