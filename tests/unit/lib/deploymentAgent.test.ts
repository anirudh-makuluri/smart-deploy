import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeHealthSample } from "@/app/types";

const appendConversationTurnMock = vi.fn();
const getUserDeploymentsMock = vi.fn();
const getConversationTurnsMock = vi.fn();
const getDeploymentForUserMock = vi.fn();
const getDeploymentHistoryMock = vi.fn();
const callLLMWithFallbackMock = vi.fn();
const listRuntimeHealthSamplesMock = vi.fn();

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getUserDeployments: getUserDeploymentsMock,
		getDeploymentForUser: getDeploymentForUserMock,
		getDeploymentHistory: getDeploymentHistoryMock,
	},
}));

vi.mock("@/lib/llmProviders", () => ({
	callLLMWithFallback: callLLMWithFallbackMock,
}));

vi.mock("@/lib/deploymentAgentConversationStore", () => ({
	appendDeploymentAgentConversationTurn: appendConversationTurnMock,
	getDeploymentAgentConversationTurns: getConversationTurnsMock,
}));

vi.mock("@/lib/runtimeHealthStore", () => ({
	listRuntimeHealthSamples: listRuntimeHealthSamplesMock,
}));

function llmJsonResponse(payload: Record<string, unknown>) {
	return {
		text: JSON.stringify(payload),
		model: "test-model",
		provider: "local" as const,
	};
}

function createMockDeployment() {
	return {
		id: "dep-1",
		repoName: "smart-deploy",
		repoUrl: "https://github.com/acme/smart-deploy",
		branch: "main",
		responseId: "resp-1",
		commitSha: "abc123",
		hostedSubdomain: "smart-deploy",
		screenshotUrl: null,
		serviceName: "web",
		status: "running",
		firstDeployment: "2026-06-01T00:00:00.000Z",
		lastDeployment: "2026-06-20T00:00:00.000Z",
		revision: 7,
		cloudProvider: "aws",
		deploymentTarget: "ecs",
		region: "us-west-2",
		secretsArn: null,
		cloudResources: {
			target: "ecs",
			region: "us-west-2",
			cluster: "cluster-1",
			service: "svc-1",
			baseUrl: "https://example.com",
		},
		scanResults: {
			response_id: "resp-1",
			deploy_shape: "server",
			build_status: "passed",
			deploy_units: [
				{
					name: "web",
					type: "service",
					framework: "nextjs",
					provider: "railpack",
					port: 3000,
				},
			],
		},
	};
}

describe("deploymentAgent.runDeploymentAgent", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		getConversationTurnsMock.mockResolvedValue([]);
	});

	it("inspects deployments with list_deployments", async () => {
		getConversationTurnsMock.mockResolvedValue([
			{
				role: "assistant",
				content: "Earlier context from the conversation.",
				timestamp: "2026-06-20T00:00:00.000Z",
			},
			{
				role: "user",
				content: "Show me the latest status again.",
				timestamp: "2026-06-20T00:01:00.000Z",
			},
		]);
		getUserDeploymentsMock.mockResolvedValue({
			deployments: [createMockDeployment()],
		});
		callLLMWithFallbackMock
			.mockResolvedValueOnce(
				llmJsonResponse({
					message: "Checking your deployments.",
					tool_calls: [{ name: "list_deployments", arguments: {} }],
					completed: false,
				})
			)
			.mockResolvedValueOnce(
				llmJsonResponse({
					message: "You have 1 deployment: smart-deploy / web is running.",
					tool_calls: [],
					completed: true,
				})
			);

		const { runDeploymentAgent } = await import("@/lib/deploymentAgent");
		const events: Array<{ event: string; payload: { runId: string; message: string } }> = [];

		await runDeploymentAgent({
			conversationId: "conversation-1",
			userID: "user-1",
			message: "Show me my deployments",
			emit: (event, payload) => {
				events.push({ event, payload });
			},
		});

		expect(getUserDeploymentsMock).toHaveBeenCalledWith("user-1");
		expect(getConversationTurnsMock).toHaveBeenCalledWith({
			userID: "user-1",
			conversationId: "conversation-1",
			limit: 6,
		});
		expect(appendConversationTurnMock).toHaveBeenNthCalledWith(1, {
			userID: "user-1",
			conversationId: "conversation-1",
			turn: expect.objectContaining({
				role: "user",
				content: "Show me my deployments",
			}),
		});
		expect(appendConversationTurnMock).toHaveBeenNthCalledWith(2, {
			userID: "user-1",
			conversationId: "conversation-1",
			turn: expect.objectContaining({
				role: "assistant",
				content: "You have 1 deployment: smart-deploy / web is running.",
			}),
		});
		expect(callLLMWithFallbackMock).toHaveBeenCalledTimes(2);
		expect(events.map((event) => event.event)).toEqual([
			"agent:accepted",
			"agent:status",
			"agent:status",
			"agent:tool_started",
			"agent:tool_completed",
			"agent:message",
			"agent:complete",
		]);
		expect(events[0]?.payload.runId).toBeTruthy();
		expect(events[5]?.payload.message).toContain("1 deployment");
		expect(events[6]?.payload.message).toContain("1 deployment");
		expect(callLLMWithFallbackMock.mock.calls[0]?.[0]).toContain(
			'repoName is the deployment repo name only, such as "smart-deploy" or "shop". It is the "repo" in the full GitHub path "owner/repo".'
		);
		expect(callLLMWithFallbackMock.mock.calls[0]?.[0]).toContain(
			'If the user mentions a full GitHub repo like "acme/smart-deploy", convert that to repoName="smart-deploy" before calling tools.'
		);
		expect(callLLMWithFallbackMock.mock.calls[0]?.[0]).toContain(
			'serviceName is the exact deployed service name inside that repo, such as "web", "api", "worker", or another detected service name.'
		);
		expect(callLLMWithFallbackMock.mock.calls[0]?.[0]).toContain(
			"[TURN 1] ASSISTANT: Earlier context from the conversation."
		);
		expect(callLLMWithFallbackMock.mock.calls[0]?.[0]).toContain(
			"[TURN 2] USER: Show me the latest status again."
		);
	});

	it("inspects deployment details with get_deployment_details", async () => {
		getDeploymentForUserMock.mockResolvedValue({
			deployment: createMockDeployment(),
		});
		callLLMWithFallbackMock
			.mockResolvedValueOnce(
				llmJsonResponse({
					message: "Checking the current deployment details.",
					tool_calls: [
						{
							name: "get_deployment_details",
							arguments: { repoName: "smart-deploy", serviceName: "web" },
						},
					],
					completed: false,
				})
			)
			.mockResolvedValueOnce(
				llmJsonResponse({
					message: "The web deployment is running in us-west-2 on ECS.",
					tool_calls: [],
					completed: true,
				})
			);

		const { runDeploymentAgent } = await import("@/lib/deploymentAgent");

		await runDeploymentAgent({
			conversationId: "conversation-1",
			userID: "user-1",
			message: "Show me the current deployment details for web",
			emit: vi.fn(),
		});

		expect(getDeploymentForUserMock).toHaveBeenCalledWith("smart-deploy", "web", "user-1");
	});

	it("inspects deployment history with get_deployment_history", async () => {
		getDeploymentHistoryMock.mockResolvedValue({
			history: [
				{
					id: "run-1",
					timestamp: "2026-06-20T00:00:00.000Z",
					success: false,
					branch: "main",
					commitSha: "abc123",
					steps: [
						{
							id: "build",
							label: "Build",
							status: "error",
							logs: ["npm install", "Build failed"],
						},
					],
					failureClassification: {
						summary: "Build failed",
					},
				},
			],
		});
		callLLMWithFallbackMock
			.mockResolvedValueOnce(
				llmJsonResponse({
					message: "Reviewing recent deployment history.",
					tool_calls: [
						{
							name: "get_deployment_history",
							arguments: { repoName: "smart-deploy", serviceName: "web", limit: 3 },
						},
					],
					completed: false,
				})
			)
			.mockResolvedValueOnce(
				llmJsonResponse({
					message: "The most recent deployment failed during the Build step.",
					tool_calls: [],
					completed: true,
				})
			);

		const { runDeploymentAgent } = await import("@/lib/deploymentAgent");

		await runDeploymentAgent({
			conversationId: "conversation-1",
			userID: "user-1",
			message: "Why did the last deployment fail?",
			emit: vi.fn(),
		});

		expect(getDeploymentHistoryMock).toHaveBeenCalledWith("smart-deploy", "web", "user-1", 1, 3);
	});

	it("inspects runtime health with get_runtime_health", async () => {
		const healthEntries: RuntimeHealthSample[] = [
			{
				checkedAt: "2026-06-20T00:00:00.000Z",
				app: {
					checkedUrl: "https://example.com",
					httpStatus: 200,
					latencyMs: 120,
					probeResults: [true],
					overallStatus: "healthy",
				},
				ecs: {
					status: "ACTIVE",
					rolloutState: "COMPLETED",
					desiredCount: 1,
					runningCount: 1,
					pendingCount: 0,
				},
				alb: {
					healthyTargetCount: 1,
					unhealthyTargetCount: 0,
					initialTargetCount: 0,
					drainingTargetCount: 0,
					unusedTargetCount: 0,
					unavailableTargetCount: 0,
				},
			},
		];
		getDeploymentForUserMock.mockResolvedValue({
			deployment: createMockDeployment(),
		});
		listRuntimeHealthSamplesMock.mockResolvedValue(healthEntries);
		callLLMWithFallbackMock
			.mockResolvedValueOnce(
				llmJsonResponse({
					message: "Checking runtime health.",
					tool_calls: [
						{
							name: "get_runtime_health",
							arguments: { repoName: "smart-deploy", serviceName: "web" },
						},
					],
					completed: false,
				})
			)
			.mockResolvedValueOnce(
				llmJsonResponse({
					message: "The web deployment is currently healthy.",
					tool_calls: [],
					completed: true,
				})
			);

		const { runDeploymentAgent } = await import("@/lib/deploymentAgent");

		await runDeploymentAgent({
			conversationId: "conversation-1",
			userID: "user-1",
			message: "Is the web service healthy?",
			emit: vi.fn(),
		});

		expect(listRuntimeHealthSamplesMock).toHaveBeenCalledWith({
			userID: "user-1",
			repoName: "smart-deploy",
			serviceName: "web",
		});
	});

	it("emits a run-scoped agent error when a later model step fails", async () => {
		getUserDeploymentsMock.mockResolvedValue({
			deployments: [createMockDeployment()],
		});
		callLLMWithFallbackMock
			.mockResolvedValueOnce(
				llmJsonResponse({
					message: "Checking your deployments.",
					tool_calls: [{ name: "list_deployments", arguments: {} }],
					completed: false,
				})
			)
			.mockRejectedValueOnce(new Error("Model unavailable"));

		const { runDeploymentAgent } = await import("@/lib/deploymentAgent");
		const events: Array<{ event: string; payload: { runId: string; message: string } }> = [];

		await runDeploymentAgent({
			conversationId: "conversation-1",
			userID: "user-1",
			message: "Show me my deployments",
			emit: (event, payload) => {
				events.push({ event, payload });
			},
		});

		expect(events.at(-1)?.event).toBe("agent:error");
		expect(events.at(-1)?.payload.runId).toBe(events[0]?.payload.runId);
		expect(events.at(-1)?.payload.message).toBe("Model unavailable");
		expect(appendConversationTurnMock).toHaveBeenLastCalledWith({
			userID: "user-1",
			conversationId: "conversation-1",
			turn: expect.objectContaining({
				role: "assistant",
				content: "Model unavailable",
			}),
		});
	});
});
