import { z } from "zod";
import { TOOL_DOCS_CONTENT_LIMIT, TOOL_DOCS_RESULT_LIMIT } from "@/lib/deploymentAgent/constants";
import type { AgentToolDefinition, ToolExecutionContext } from "@/lib/deploymentAgent/types";
import { retrievePlatformDocChunks } from "@/lib/platformDocsRetrieval";

type SearchDocsResult = {
	query: string;
	mossEnabled: boolean;
	mossRetrievalMs: number | null;
	chunks: Array<{
		source: string;
		section: string;
		content: string;
		relevance: number | null;
	}>;
	citations: string[];
};

function trimChunkContent(content: string): string {
	if (content.length <= TOOL_DOCS_CONTENT_LIMIT) {
		return content;
	}
	return `${content.slice(0, TOOL_DOCS_CONTENT_LIMIT).trimEnd()}...`;
}

async function executeSearchDocs(
	_ctx: ToolExecutionContext,
	args: Record<string, unknown>
): Promise<SearchDocsResult> {
	const query = String(args.query ?? "").trim();
	if (!query) {
		throw new Error("Tool argument `query` is required");
	}

	const retrieval = await retrievePlatformDocChunks(query, TOOL_DOCS_RESULT_LIMIT);

	const chunks = retrieval.chunks.map((chunk) => ({
		source: chunk.source,
		section: chunk.section,
		content: trimChunkContent(chunk.content),
		relevance: typeof chunk.score === "number" ? chunk.score : null,
	}));
	const citations = Array.from(new Set(chunks.map((chunk) => chunk.source))).slice(0, TOOL_DOCS_RESULT_LIMIT);

	return {
		query,
		mossEnabled: retrieval.mossEnabled,
		mossRetrievalMs: retrieval.mossRetrievalMs,
		chunks,
		citations,
	};
}

export const searchDocsTool = {
	name: "search_docs",
	description: "Search Smart Deploy platform documentation for troubleshooting and how-to guidance",
	whenToUse:
		"Use after deployment or health tools surface a failure, error, or unhealthy signal and you need platform guidance on what it means or how to fix it. Also use when the user asks how Smart Deploy features work (Railpack, ECS, rollback, env vars, runtime health). Do not use for simple deployment listing or status-only questions.",
	argumentDescription: '{"query":"string"}',
	argsSchema: z.object({
		query: z.string().trim().min(1),
	}),
	execute: async (ctx, args) => executeSearchDocs(ctx, args),
	startedMessage: "Using Moss to search Smart Deploy docs for relevant guidance.",
	completedMessage: "Finished searching Smart Deploy docs.",
} satisfies AgentToolDefinition;