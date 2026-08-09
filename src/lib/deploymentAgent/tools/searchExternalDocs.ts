import ContextDev from "context.dev";
import { z } from "zod";
import { TOOL_DOCS_CONTENT_LIMIT } from "@/lib/deploymentAgent/constants";
import type { AgentToolDefinition, ToolExecutionContext } from "@/lib/deploymentAgent/types";

type ExternalDocsSearchResult = {
	query: string;
	sourceDomain: string | null;
	contextDevEnabled: boolean;
	results: Array<{
		title: string;
		url: string;
		description: string;
		content: string;
	}>;
	error: string | null;
};

function trimContent(content: string): string {
	if (content.length <= TOOL_DOCS_CONTENT_LIMIT) {
		return content;
	}
	return `${content.slice(0, TOOL_DOCS_CONTENT_LIMIT).trimEnd()}...`;
}

function normalizeSourceDomain(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const domain = value.trim().toLowerCase();
	if (!domain) {
		return null;
	}
	if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
		throw new Error("Tool argument `sourceDomain` must be a public hostname, such as docs.aws.amazon.com");
	}
	return domain;
}

function formatSearchQuery(query: string, sourceDomain: string | null): string {
	return sourceDomain ? `site:${sourceDomain} ${query}` : query;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message.trim().slice(0, 240);
	}
	return "Context.dev could not retrieve external documentation.";
}

async function executeSearchExternalDocs(
	_ctx: ToolExecutionContext,
	args: Record<string, unknown>
): Promise<ExternalDocsSearchResult> {
	const query = String(args.query ?? "").trim();
	if (!query) {
		throw new Error("Tool argument `query` is required");
	}

	const sourceDomain = normalizeSourceDomain(args.sourceDomain);
	const apiKey = process.env.CONTEXT_DEV_API_KEY?.trim();
	if (!apiKey) {
		return {
			query,
			sourceDomain,
			contextDevEnabled: false,
			results: [],
			error: "External documentation is unavailable because CONTEXT_DEV_API_KEY is not configured.",
		};
	}

	try {
		const client = new ContextDev({ apiKey });
		const search = await client.web.search({
			query: formatSearchQuery(query, sourceDomain),
			numResults: 10,
			tags: ["smart-deploy", "deployment-agent"],
		});
		const match = search.results.find((result) => {
			try {
				const url = new URL(result.url);
				return url.protocol === "https:" && (!sourceDomain || url.hostname === sourceDomain || url.hostname.endsWith(`.${sourceDomain}`));
			} catch {
				return false;
			}
		});

		if (!match) {
			return {
				query,
				sourceDomain,
				contextDevEnabled: true,
				results: [],
				error: "No matching public documentation was found.",
			};
		}

		const scrape = await client.web.webScrapeMd({
			url: match.url,
			includeLinks: true,
			maxAgeMs: 86_400_000,
			tags: ["smart-deploy", "deployment-agent"],
			useMainContentOnly: true,
		});

		return {
			query,
			sourceDomain,
			contextDevEnabled: true,
			results: [
				{
					title: match.title,
					url: match.url,
					description: match.description,
					content: trimContent(scrape.markdown),
				},
			],
			error: null,
		};
	} catch (error) {
		return {
			query,
			sourceDomain,
			contextDevEnabled: true,
			results: [],
			error: errorMessage(error),
		};
	}
}

export const searchExternalDocsTool = {
	name: "search_external_docs",
	description: "Search and read public external technical documentation through Context.dev",
	whenToUse:
		"Use for a technical question that Smart Deploy docs cannot answer, such as AWS, framework, runtime, or library behavior. Prefer a known official documentation hostname in sourceDomain. This tool only reads public documentation and never uses deployment credentials or browser context.",
	argumentDescription: '{"query":"string","sourceDomain":"optional public hostname"}',
	argsSchema: z.object({
		query: z.string().trim().min(1),
		sourceDomain: z.string().trim().optional(),
	}),
	execute: async (ctx, args) => executeSearchExternalDocs(ctx, args),
	startedMessage: "Searching public technical documentation.",
	completedMessage: "Finished searching external documentation.",
} satisfies AgentToolDefinition;
