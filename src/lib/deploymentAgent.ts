import { randomUUID } from "crypto";
import { z } from "zod";
import { dbHelper } from "@/db-helper";
import {
	appendDeploymentAgentConversationTurn,
	getDeploymentAgentConversationTurns,
	type DeploymentAgentConversationTurn,
} from "@/lib/deploymentAgentConversationStore";
import { getDeploymentHostedUrl } from "@/lib/hostedUrl";
import { callLLMWithFallback } from "@/lib/llmProviders";
import { listRuntimeHealthSamples } from "@/lib/runtimeHealthStore";

const MAX_TOOL_CALLS = 2;
const MAX_PROMPT_TURNS = 6;
const TOOL_HISTORY_LOG_LIMIT = 3;
const TOOL_HISTORY_RESULT_LIMIT = 5;
const JSON_FENCE_REGEX = /```(?:json)?\s*([\s\S]*?)```/i;

const ToolCallSchema = z.object({
	name: z.enum([
		"list_deployments",
		"get_deployment_details",
		"get_deployment_history",
		"get_runtime_health",
	]),
	arguments: z.record(z.string(), z.unknown()),
});

const AgentResponseSchema = z.object({
	message: z.string().trim().min(1),
	tool_calls: z.array(ToolCallSchema).max(1),
	completed: z.boolean(),
});

type AgentToolCall = z.infer<typeof ToolCallSchema>;
type AgentLlmResponse = z.infer<typeof AgentResponseSchema>;

type AgentSocketMessage = {
	runId: string;
	message: string;
};

type AgentEventName =
	| "agent:accepted"
	| "agent:status"
	| "agent:tool_started"
	| "agent:tool_completed"
	| "agent:message"
	| "agent:complete"
	| "agent:error";

type AgentEmitter = (event: AgentEventName, payload: AgentSocketMessage) => void;

type ToolExecutionContext = {
	userID: string;
};

type ToolExecutionResult = {
	name: AgentToolCall["name"];
	arguments: Record<string, unknown>;
	result: unknown;
};

type ListDeploymentsResult = {
	deployments: Array<{
		repoName: string;
		serviceName: string;
		status: string;
		branch: string;
		deploymentTarget: string;
		lastDeployment: string | null;
		hostedUrl: string | null;
	}>;
};

type DeploymentDetailsResult = {
	deployment: {
		repoName: string;
		serviceName: string;
		status: string;
		branch: string;
		commitSha: string | null;
		revision: number | null;
		deploymentTarget: string;
		region: string;
		hostedUrl: string | null;
		lastDeployment: string | null;
		cloudResources: unknown;
		scanResults: {
			responseId: string | null;
			deployShape: string | null;
			buildStatus: string | null;
			deployUnits: Array<{
				name: string;
				type: string;
				framework: string | null;
				provider: string;
				port: number;
			}>;
		};
	};
};

type DeploymentHistoryResult = {
	history: Array<{
		id: string;
		timestamp: string;
		success: boolean;
		branch: string | null;
		commitSha: string | null;
		failedStep: string | null;
		failureSummary: string | null;
		recentLogs: string[];
	}>;
};

type RuntimeHealthResult = {
	entries: Array<{
		checkedAt: string;
		appStatus: string;
		httpStatus: number | null;
		latencyMs: number | null;
		ecsStatus: string | null;
		rolloutState: string | null;
		healthyTargets: number | null;
		unhealthyTargets: number | null;
	}>;
};

function parseModelJson(raw: string): AgentLlmResponse | null {
	const fenced = JSON_FENCE_REGEX.exec(raw);
	const candidate = (fenced?.[1] ?? raw).trim();

	try {
		const parsed = JSON.parse(candidate) as unknown;
		return AgentResponseSchema.parse(parsed);
	} catch {
		return null;
	}
}

function summarizeLogs(logs: string[]): string[] {
	return logs
		.map((line) => String(line || "").trim())
		.filter((line) => line.length > 0)
		.slice(-TOOL_HISTORY_LOG_LIMIT);
}

function normalizeToolArguments(args: Record<string, unknown>) {
	return Object.fromEntries(
		Object.entries(args).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
	);
}

function parseRequiredStringArg(
	args: Record<string, unknown>,
	key: "repoName" | "serviceName"
): string {
	const value = args[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Tool argument \`${key}\` is required`);
	}
	return value.trim();
}

function parseLimitArg(args: Record<string, unknown>, key: "limit", fallback: number): number {
	const rawValue = args[key];
	if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
		return Math.min(Math.max(Math.trunc(rawValue), 1), 10);
	}
	if (typeof rawValue === "string" && rawValue.trim().length > 0) {
		const parsed = Number(rawValue.trim());
		if (Number.isFinite(parsed)) {
			return Math.min(Math.max(Math.trunc(parsed), 1), 10);
		}
	}
	return fallback;
}

async function listDeploymentsTool(ctx: ToolExecutionContext): Promise<ListDeploymentsResult> {
	const response = await dbHelper.getUserDeployments(ctx.userID);
	if (response.error) {
		throw new Error(typeof response.error === "string" ? response.error : "Failed to load deployments");
	}

	return {
		deployments: (response.deployments ?? [])
			.slice(0, 25)
			.map((deployment) => ({
				repoName: deployment.repoName,
				serviceName: deployment.serviceName,
				status: deployment.status,
				branch: deployment.branch,
				deploymentTarget: deployment.deploymentTarget,
				lastDeployment: deployment.lastDeployment,
				hostedUrl: getDeploymentHostedUrl(deployment),
			})),
	};
}

async function getDeploymentDetailsTool(
	ctx: ToolExecutionContext,
	args: Record<string, unknown>
): Promise<DeploymentDetailsResult> {
	const repoName = parseRequiredStringArg(args, "repoName");
	const serviceName = parseRequiredStringArg(args, "serviceName");
	const response = await dbHelper.getDeploymentForUser(repoName, serviceName, ctx.userID);
	if (response.error || !response.deployment) {
		throw new Error(response.error || "Deployment not found");
	}

	const deployment = response.deployment;
	const scanResults = deployment.scanResults as {
		response_id?: string;
		deploy_shape?: string;
		build_status?: string;
		deploy_units?: Array<{
			name?: string;
			type?: string;
			framework?: string | null;
			provider?: string;
			port?: number;
		}>;
	};

	return {
		deployment: {
			repoName: deployment.repoName,
			serviceName: deployment.serviceName,
			status: deployment.status,
			branch: deployment.branch,
			commitSha: deployment.commitSha,
			revision: deployment.revision,
			deploymentTarget: deployment.deploymentTarget,
			region: deployment.region,
			hostedUrl: getDeploymentHostedUrl(deployment),
			lastDeployment: deployment.lastDeployment,
			cloudResources: deployment.cloudResources,
			scanResults: {
				responseId: scanResults?.response_id ?? deployment.responseId ?? null,
				deployShape: scanResults?.deploy_shape ?? null,
				buildStatus: scanResults?.build_status ?? null,
				deployUnits: Array.isArray(scanResults?.deploy_units)
					? scanResults.deploy_units.slice(0, TOOL_HISTORY_RESULT_LIMIT).map((unit) => ({
							name: String(unit?.name ?? ""),
							type: String(unit?.type ?? ""),
							framework: typeof unit?.framework === "string" ? unit.framework : null,
							provider: String(unit?.provider ?? ""),
							port: typeof unit?.port === "number" ? unit.port : 0,
						}))
					: [],
			},
		},
	};
}

async function getDeploymentHistoryTool(
	ctx: ToolExecutionContext,
	args: Record<string, unknown>
): Promise<DeploymentHistoryResult> {
	const repoName = parseRequiredStringArg(args, "repoName");
	const serviceName = parseRequiredStringArg(args, "serviceName");
	const limit = parseLimitArg(args, "limit", TOOL_HISTORY_RESULT_LIMIT);
	const response = await dbHelper.getDeploymentHistory(repoName, serviceName, ctx.userID, 1, limit);
	if (response.error) {
		throw new Error(typeof response.error === "string" ? response.error : "Failed to load deployment history");
	}

	return {
		history: (response.history ?? []).slice(0, limit).map((entry) => {
			const failedStep = (entry.steps || []).find((step) => step.status === "error") || null;
			const recentLogs = failedStep?.logs?.length
				? summarizeLogs(failedStep.logs)
				: summarizeLogs((entry.steps || []).flatMap((step) => step.logs || []));

			return {
				id: entry.id,
				timestamp: entry.timestamp,
				success: entry.success,
				branch: entry.branch ?? null,
				commitSha: entry.commitSha ?? null,
				failedStep: failedStep?.label ?? failedStep?.id ?? null,
				failureSummary: entry.failureClassification?.summary ?? null,
				recentLogs,
			};
		}),
	};
}

async function getRuntimeHealthTool(
	ctx: ToolExecutionContext,
	args: Record<string, unknown>
): Promise<RuntimeHealthResult> {
	const repoName = parseRequiredStringArg(args, "repoName");
	const serviceName = parseRequiredStringArg(args, "serviceName");
	const deploymentResponse = await dbHelper.getDeploymentForUser(repoName, serviceName, ctx.userID);
	if (deploymentResponse.error || !deploymentResponse.deployment) {
		throw new Error(deploymentResponse.error || "Deployment not found");
	}

	const entries = await listRuntimeHealthSamples({
		userID: ctx.userID,
		repoName,
		serviceName,
	});

	return {
		entries: entries.slice(-TOOL_HISTORY_RESULT_LIMIT).reverse().map((entry) => ({
			checkedAt: entry.checkedAt,
			appStatus: entry.app.overallStatus,
			httpStatus: entry.app.httpStatus,
			latencyMs: entry.app.latencyMs,
			ecsStatus: entry.ecs?.status ?? null,
			rolloutState: entry.ecs?.rolloutState ?? null,
			healthyTargets: entry.alb?.healthyTargetCount ?? null,
			unhealthyTargets: entry.alb?.unhealthyTargetCount ?? null,
		})),
	};
}

async function executeToolCall(
	ctx: ToolExecutionContext,
	toolCall: AgentToolCall
): Promise<ToolExecutionResult> {
	const normalizedArguments = normalizeToolArguments(toolCall.arguments);

	switch (toolCall.name) {
		case "list_deployments":
			return {
				name: toolCall.name,
				arguments: normalizedArguments,
				result: await listDeploymentsTool(ctx),
			};
		case "get_deployment_details":
			return {
				name: toolCall.name,
				arguments: normalizedArguments,
				result: await getDeploymentDetailsTool(ctx, normalizedArguments),
			};
		case "get_deployment_history":
			return {
				name: toolCall.name,
				arguments: normalizedArguments,
				result: await getDeploymentHistoryTool(ctx, normalizedArguments),
			};
		case "get_runtime_health":
			return {
				name: toolCall.name,
				arguments: normalizedArguments,
				result: await getRuntimeHealthTool(ctx, normalizedArguments),
			};
		default:
			throw new Error(`Unsupported tool: ${toolCall.name satisfies never}`);
	}
}

function buildToolInstructions() {
	return [
		"Available tools:",
		"",
		"1. list_deployments",
		"Use when the user asks for a list, overview, or when repo/service context is missing.",
		"Arguments: {}",
		"",
		"2. get_deployment_details",
		"Use when the user asks about the current state of a specific deployment.",
		'Arguments: {"repoName":"string","serviceName":"string"}',
		"",
		"3. get_deployment_history",
		"Use when the user asks about recent deploy attempts, failures, or last deployment status.",
		'Arguments: {"repoName":"string","serviceName":"string","limit":"number optional"}',
		"",
		"4. get_runtime_health",
		"Use when the user asks if a deployment is healthy right now.",
		'Arguments: {"repoName":"string","serviceName":"string"}',
	].join("\n");
}

function buildEntityInstructions() {
	return [
		"Field meaning:",
		'- repoName is the deployment repo name only, such as "smart-deploy" or "shop". It is the "repo" in the full GitHub path "owner/repo".',
		'- serviceName is the exact deployed service name inside that repo, such as "web", "api", "worker", or another detected service name.',
		'- A repo can have multiple services, so repoName alone may not be enough for service-specific tools.',
		"",
		"How to choose arguments:",
		"- If the user asks for a broad overview, or you do not know the exact repoName/serviceName yet, call list_deployments first.",
		'- If the user mentions only a service like "api" or "web" but not the repo, do not guess the repoName. Ask a clarifying question or call list_deployments first.',
		'- If the user mentions a full GitHub repo like "acme/smart-deploy", convert that to repoName="smart-deploy" before calling tools.',
		'- If the user mentions only a repo but not a service, do not guess the serviceName unless the tool result already shows there is only one relevant deployment.',
		'- For service-specific tools, pass the exact repoName and serviceName values taken from tool results whenever possible.',
		"",
		"Examples:",
		'- If the deployment list shows repoName="smart-deploy" and serviceName="web", then a valid tool call is {"name":"get_runtime_health","arguments":{"repoName":"smart-deploy","serviceName":"web"}}.',
		'- If the user says "check acme/smart-deploy web", then use repoName="smart-deploy" and serviceName="web".',
		'- If the user says "show me my deployments", use list_deployments.',
		'- If the user says "why did my api deployment fail?" and you do not yet know which repo has serviceName="api", use list_deployments first.',
	].join("\n");
}

function buildConversationHistoryBlock(turns: DeploymentAgentConversationTurn[]): string {
	if (turns.length === 0) return "(no prior conversation)";

	return turns
		.map((turn, index) => `[TURN ${index + 1}] ${turn.role.toUpperCase()}: ${turn.content}`)
		.join("\n");
}

function buildAgentPrompt(args: {
	message: string;
	conversationHistory: DeploymentAgentConversationTurn[];
	toolCallsUsed: number;
	toolResults: ToolExecutionResult[];
}): string {
	const remainingToolCalls = MAX_TOOL_CALLS - args.toolCallsUsed;
	const conversationHistoryBlock = buildConversationHistoryBlock(args.conversationHistory);
	const toolResultsBlock =
		args.toolResults.length > 0
			? args.toolResults
					.map((toolResult, index) =>
						[
							`[TOOL RESULT ${index + 1}]`,
							`name=${toolResult.name}`,
							`arguments=${JSON.stringify(toolResult.arguments)}`,
							JSON.stringify(toolResult.result, null, 2),
						].join("\n")
					)
					.join("\n\n")
			: "(none)";

	return `You are Smart Deploy's deployment agent.
You answer questions about the authenticated user's existing deployments.
Use only the available tools. Never invent repos, services, statuses, or health states.
If the request is ambiguous, ask a clarifying question instead of guessing.
If no tool call is needed, answer directly.

${buildEntityInstructions()}

${buildToolInstructions()}

Return ONLY valid JSON with this shape:
{
  "message": "string",
  "tool_calls": [
    {
      "name": "list_deployments" | "get_deployment_details" | "get_deployment_history" | "get_runtime_health",
      "arguments": {}
    }
  ],
  "completed": true | false
}

Rules:
- message must be user-facing and concise.
- tool_calls must always be present.
- Return at most one tool call in each response.
- If completed is true, tool_calls must be [].
- If completed is false, tool_calls must contain exactly one tool call.
- Remaining tool calls in this run: ${remainingToolCalls}.
- When remaining tool calls is 0, you must set completed=true and tool_calls=[].
- If repoName or serviceName is unknown, ask for clarification with completed=true and tool_calls=[].

RECENT CONVERSATION HISTORY:
${conversationHistoryBlock}

USER MESSAGE:
${args.message}

TOOL RESULTS:
${toolResultsBlock}`;
}

function buildToolStartedMessage(toolName: AgentToolCall["name"]): string {
	switch (toolName) {
		case "list_deployments":
			return "Checking your deployments.";
		case "get_deployment_details":
			return "Inspecting that deployment's current details.";
		case "get_deployment_history":
			return "Reviewing recent deployment history.";
		case "get_runtime_health":
			return "Checking current runtime health.";
	}
}

function buildToolCompletedMessage(toolName: AgentToolCall["name"]): string {
	switch (toolName) {
		case "list_deployments":
			return "Finished checking your deployments.";
		case "get_deployment_details":
			return "Finished loading deployment details.";
		case "get_deployment_history":
			return "Finished reviewing deployment history.";
		case "get_runtime_health":
			return "Finished checking runtime health.";
	}
}

async function requestAgentDecision(args: {
	message: string;
	conversationHistory: DeploymentAgentConversationTurn[];
	toolCallsUsed: number;
	toolResults: ToolExecutionResult[];
}): Promise<AgentLlmResponse> {
	const prompt = buildAgentPrompt(args);
	const llm = await callLLMWithFallback(prompt, {
		contextLabel: "Deployment agent",
		maxTokens: 2048,
		temperature: 0.1,
		localModelDefault: "mistral",
	});
	const parsed = parseModelJson(llm.text);
	if (!parsed) {
		throw new Error("Deployment agent returned invalid JSON");
	}

	if (parsed.completed && parsed.tool_calls.length > 0) {
		throw new Error("Deployment agent returned tool calls for a completed response");
	}
	if (!parsed.completed && parsed.tool_calls.length !== 1) {
		throw new Error("Deployment agent must return exactly one tool call when work is incomplete");
	}

	return parsed;
}

function emitAgentEvent(
	emit: AgentEmitter,
	event: AgentEventName,
	runId: string,
	message: string
) {
	emit(event, {
		runId,
		message,
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
	const toolResults: ToolExecutionResult[] = [];
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

	emitAgentEvent(args.emit, "agent:accepted", runId, "I'm looking into that now.");
	emitAgentEvent(args.emit, "agent:status", runId, "Understanding your request.");

	try {
		for (let toolCallsUsed = 0; toolCallsUsed <= MAX_TOOL_CALLS; toolCallsUsed += 1) {
			const decision = await requestAgentDecision({
				message,
				conversationHistory,
				toolCallsUsed,
				toolResults,
			});

			if (toolCallsUsed === MAX_TOOL_CALLS || decision.completed || decision.tool_calls.length === 0) {
				await appendDeploymentAgentConversationTurn({
					userID: args.userID,
					conversationId,
					turn: {
						role: "assistant",
						content: decision.message,
						timestamp: new Date().toISOString(),
					},
				});
				emitAgentEvent(args.emit, "agent:message", runId, decision.message);
				emitAgentEvent(args.emit, "agent:complete", runId, decision.message);
				return;
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
		emitAgentEvent(args.emit, "agent:error", runId, errorMessage);
	}
}
