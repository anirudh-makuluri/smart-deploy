export const DEPLOYMENT_AGENT_EVAL_INTENTS = [
	"overview",
	"current_status",
	"runtime_health",
	"failure_diagnosis",
	"docs_howto",
	"ambiguous_lookup",
] as const;

export const DEPLOYMENT_AGENT_EVAL_HELPFULNESS = [
	"helpful",
	"partially_helpful",
	"not_helpful",
] as const;

export const DEPLOYMENT_AGENT_EVAL_FAILURE_MODES = [
	"wrong_answer",
	"too_shallow",
	"missing_tool",
	"tool_limit",
	"clarification_needed",
	"out_of_scope",
] as const;

export type DeploymentAgentEvalIntent = (typeof DEPLOYMENT_AGENT_EVAL_INTENTS)[number];
export type DeploymentAgentEvalHelpfulness = (typeof DEPLOYMENT_AGENT_EVAL_HELPFULNESS)[number];
export type DeploymentAgentEvalFailureMode = (typeof DEPLOYMENT_AGENT_EVAL_FAILURE_MODES)[number];

export type DeploymentAgentEvalReview = {
	runId: string;
	assistantMessageId: string;
	userId: string;
	conversationId: string;
	judgeIntent: DeploymentAgentEvalIntent | null;
	judgeHelpfulness: DeploymentAgentEvalHelpfulness | null;
	judgePrimaryFailureMode: DeploymentAgentEvalFailureMode | null;
	judgeExpectedToolPath: string | null;
	judgeNotes: string | null;
	judgeScores: Record<string, number>;
	judgeModel: string | null;
	judgeProvider: string | null;
	judgedAt: string | null;
	intent: DeploymentAgentEvalIntent | null;
	helpfulness: DeploymentAgentEvalHelpfulness | null;
	primaryFailureMode: DeploymentAgentEvalFailureMode | null;
	expectedToolPath: string | null;
	notes: string | null;
	reviewedAt: string | null;
	reviewedByEmail: string | null;
};

export type DeploymentAgentEvalToolResult = {
	name: string;
	arguments: Record<string, unknown>;
	result: unknown;
};

export type DeploymentAgentEvalRun = {
	runId: string;
	assistantMessageId: string;
	userId: string;
	conversationId: string;
	createdAt: string;
	userMessage: string;
	assistantMessage: string;
	outcome: string | null;
	completed: boolean;
	durationMs: number | null;
	promptTurnCount: number | null;
	toolCallsUsed: number;
	tokenTotal: number | null;
	model: string | null;
	provider: string | null;
	actualToolPath: string;
	toolNames: string[];
	resolvedRepoName: string | null;
	resolvedServiceName: string | null;
	autoIntent: DeploymentAgentEvalIntent;
	expectedToolPath: string;
	suggestedFailureMode: DeploymentAgentEvalFailureMode | null;
	toolResults: DeploymentAgentEvalToolResult[];
};

export type DeploymentAgentEvalJudgeResult = {
	intent: DeploymentAgentEvalIntent;
	helpfulness: DeploymentAgentEvalHelpfulness;
	primaryFailureMode: DeploymentAgentEvalFailureMode | null;
	expectedToolPath: string;
	notes: string;
	scores: {
		correctness: number;
		completeness: number;
		actionability: number;
		toolChoice: number;
		grounding: number;
	};
};

type AssistantMetadataSnapshot = {
	outcome: string | null;
	completed: boolean;
	durationMs: number | null;
	promptTurnCount: number | null;
	toolCallsUsed: number;
	tokenTotal: number | null;
	model: string | null;
	provider: string | null;
	toolResults: DeploymentAgentEvalToolResult[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function asBoolean(value: unknown): boolean {
	return value === true;
}

function asNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractAssistantMetadata(metadata: unknown): AssistantMetadataSnapshot {
	const record = asRecord(metadata);
	const toolResults = Array.isArray(record?.toolResults)
		? record.toolResults.flatMap((value) => {
				const item = asRecord(value);
				const name = asString(item?.name);
				const args = asRecord(item?.arguments);
				if (!name || !args) return [];
				return [{
					name,
					arguments: args,
					result: item?.result,
				}];
			})
		: [];
	const tokenUsage = asRecord(record?.token_usage);

	return {
		outcome: asString(record?.outcome),
		completed: asBoolean(record?.completed),
		durationMs: asNumber(record?.durationMs),
		promptTurnCount: asNumber(record?.promptTurnCount),
		toolCallsUsed: asNumber(record?.toolCallsUsed) ?? toolResults.length,
		tokenTotal: asNumber(tokenUsage?.total_tokens),
		model: asString(record?.model),
		provider: asString(record?.provider),
		toolResults,
	};
}

function deriveActualToolPath(toolResults: DeploymentAgentEvalToolResult[]): string[] {
	return toolResults.map((toolResult) => toolResult.name);
}

function deriveResolvedRepoService(toolResults: DeploymentAgentEvalToolResult[]): {
	repoName: string | null;
	serviceName: string | null;
} {
	for (const toolResult of toolResults) {
		const repoName = asString(toolResult.arguments.repoName);
		const serviceName = asString(toolResult.arguments.serviceName);
		if (repoName || serviceName) {
			return {
				repoName,
				serviceName,
			};
		}
	}

	return {
		repoName: null,
		serviceName: null,
	};
}

function inferAmbiguousLookup(userMessage: string, repoName: string | null, serviceName: string | null): boolean {
	const normalized = userMessage.toLowerCase();
	const mentionsRepo = normalized.includes("/") || /\brepo\b/.test(normalized);
	const mentionsServiceWord = /\bservice\b|\bapi\b|\bweb\b|\bworker\b/.test(normalized);
	return !repoName && !serviceName && !mentionsRepo && mentionsServiceWord;
}

export function deriveEvalIntent(args: {
	userMessage: string;
	toolNames: string[];
	repoName: string | null;
	serviceName: string | null;
}): DeploymentAgentEvalIntent {
	const normalized = args.userMessage.toLowerCase();
	const toolSet = new Set(args.toolNames);

	if (inferAmbiguousLookup(args.userMessage, args.repoName, args.serviceName)) {
		return "ambiguous_lookup";
	}
	if (
		/\bfailed\b|\bfail\b|\berror\b|\bwhy did\b|\broot cause\b|\brollback\b/.test(normalized) ||
		toolSet.has("get_deployment_history")
	) {
		return "failure_diagnosis";
	}
	if (
		/\bhealthy\b|\bhealth\b|\bstatus code\b|\b502\b|\b503\b|\bunreachable\b/.test(normalized) ||
		toolSet.has("get_runtime_health")
	) {
		return "runtime_health";
	}
	if (
		/\bhow\b|\bwhat is\b|\bhow does\b|\bdocs\b|\brailpack\b|\benv vars\b|\benvironment variables\b/.test(normalized) ||
		(toolSet.has("search_docs") && !toolSet.has("get_deployment_details") && !toolSet.has("get_runtime_health") && !toolSet.has("get_deployment_history"))
	) {
		return "docs_howto";
	}
	if (
		/\bshow\b|\blist\b|\boverview\b|\bmy deployments\b|\bwhat deployments\b/.test(normalized) ||
		toolSet.has("list_deployments")
	) {
		return "overview";
	}
	return "current_status";
}

export function deriveExpectedToolPath(intent: DeploymentAgentEvalIntent): string {
	switch (intent) {
		case "overview":
			return "list_deployments";
		case "current_status":
			return "get_deployment_details";
		case "runtime_health":
			return "get_runtime_health";
		case "failure_diagnosis":
			return "get_deployment_history -> search_docs";
		case "docs_howto":
			return "search_docs";
		case "ambiguous_lookup":
			return "clarify_or_list_deployments";
	}
}

export function deriveSuggestedFailureMode(args: {
	intent: DeploymentAgentEvalIntent;
	outcome: string | null;
	toolNames: string[];
	assistantMessage: string;
	userMessage: string;
}): DeploymentAgentEvalFailureMode | null {
	if (args.outcome === "tool_limit") {
		return "tool_limit";
	}

	if (/\bfix it\b|\bredeploy it\b|\brollback it\b|\bchange\b.*\bconfig\b/.test(args.userMessage.toLowerCase())) {
		return "out_of_scope";
	}

	const normalizedAnswer = args.assistantMessage.toLowerCase();
	const toolSet = new Set(args.toolNames);

	if (args.intent === "ambiguous_lookup" && /\bwhich repo\b|\bwhich service\b|\bcan you clarify\b/.test(normalizedAnswer)) {
		return "clarification_needed";
	}

	if (args.intent === "docs_howto" && !toolSet.has("search_docs")) {
		return "missing_tool";
	}

	if (args.intent === "failure_diagnosis") {
		if (!toolSet.has("get_deployment_history")) {
			return "wrong_answer";
		}
		if (!toolSet.has("search_docs")) {
			return "too_shallow";
		}
	}

	return null;
}

export function buildDeploymentAgentEvalRun(args: {
	assistantMessage: {
		id: string;
		user_id: string;
		conversation_id: string;
		run_id: string;
		content: string;
		metadata: unknown;
		created_at: string;
	};
	userMessage: string;
}): DeploymentAgentEvalRun {
	const metadata = extractAssistantMetadata(args.assistantMessage.metadata);
	const toolNames = deriveActualToolPath(metadata.toolResults);
	const resolved = deriveResolvedRepoService(metadata.toolResults);
	const autoIntent = deriveEvalIntent({
		userMessage: args.userMessage,
		toolNames,
		repoName: resolved.repoName,
		serviceName: resolved.serviceName,
	});

	return {
		runId: args.assistantMessage.run_id,
		assistantMessageId: args.assistantMessage.id,
		userId: args.assistantMessage.user_id,
		conversationId: args.assistantMessage.conversation_id,
		createdAt: args.assistantMessage.created_at,
		userMessage: args.userMessage,
		assistantMessage: args.assistantMessage.content,
		outcome: metadata.outcome,
		completed: metadata.completed,
		durationMs: metadata.durationMs,
		promptTurnCount: metadata.promptTurnCount,
		toolCallsUsed: metadata.toolCallsUsed,
		tokenTotal: metadata.tokenTotal,
		model: metadata.model,
		provider: metadata.provider,
		actualToolPath: toolNames.join(" -> "),
		toolNames,
		resolvedRepoName: resolved.repoName,
		resolvedServiceName: resolved.serviceName,
		autoIntent,
		expectedToolPath: deriveExpectedToolPath(autoIntent),
		suggestedFailureMode: deriveSuggestedFailureMode({
			intent: autoIntent,
			outcome: metadata.outcome,
			toolNames,
			assistantMessage: args.assistantMessage.content,
			userMessage: args.userMessage,
		}),
		toolResults: metadata.toolResults,
	};
}

export function isEvalIntent(value: string | null): value is DeploymentAgentEvalIntent {
	return value !== null && DEPLOYMENT_AGENT_EVAL_INTENTS.includes(value as DeploymentAgentEvalIntent);
}

export function isEvalHelpfulness(value: string | null): value is DeploymentAgentEvalHelpfulness {
	return value !== null && DEPLOYMENT_AGENT_EVAL_HELPFULNESS.includes(value as DeploymentAgentEvalHelpfulness);
}

export function isEvalFailureMode(value: string | null): value is DeploymentAgentEvalFailureMode {
	return value !== null && DEPLOYMENT_AGENT_EVAL_FAILURE_MODES.includes(value as DeploymentAgentEvalFailureMode);
}
