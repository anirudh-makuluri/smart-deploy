import type { z } from "zod";

export type AgentToolDefinition = {
	name: string;
	description: string;
	whenToUse: string;
	argumentDescription: string;
	argsSchema: z.ZodType<Record<string, unknown>>;
	execute: (ctx: ToolExecutionContext, args: Record<string, unknown>) => Promise<unknown>;
	startedMessage: string;
	completedMessage: string;
};

export type ToolExecutionContext = {
	userID: string;
};

export type ToolExecutionResult<TToolName extends string = string> = {
	name: TToolName;
	arguments: Record<string, unknown>;
	result: unknown;
};

export type AgentSocketDocCitation = {
	source: string;
	href: string;
	label: string;
};

export type AgentSocketMessage = {
	runId: string;
	message: string;
	docCitations: AgentSocketDocCitation[];
};

export type AgentEventName =
	| "agent:accepted"
	| "agent:status"
	| "agent:tool_started"
	| "agent:tool_completed"
	| "agent:message"
	| "agent:complete"
	| "agent:error";

export type AgentEmitter = (event: AgentEventName, payload: AgentSocketMessage) => void;