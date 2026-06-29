import { z } from "zod";
import { AGENT_TOOL_NAME_TUPLE } from "@/lib/deploymentAgent/registry";

const ToolCallSchema = z.object({
	name: z.enum(AGENT_TOOL_NAME_TUPLE),
	arguments: z.record(z.string(), z.unknown()),
});

export const AgentResponseSchema = z.object({
	message: z.string().trim().min(1),
	tool_calls: z.array(ToolCallSchema).max(1),
	completed: z.boolean(),
});

export type AgentToolCall = z.infer<typeof ToolCallSchema>;
export type AgentLlmResponse = z.infer<typeof AgentResponseSchema>;