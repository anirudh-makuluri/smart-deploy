import { slugFromMarkdownFilename, titleFromMarkdownFilename } from "@/lib/markdownDocSlugs";

const PUBLIC_DOC_FILENAMES = [
	"AI_ASSISTANCE.md",
	"BLUEPRINT_AND_PREVIEW.md",
	"BUILD_FAILURES.md",
	"CUSTOM_DOMAINS.md",
	"DEBUGGING_DEPLOYMENTS.md",
	"DEPLOYMENT_AGENT.md",
	"DEPLOYMENT_HISTORY_AND_ROLLBACK.md",
	"DEPLOYMENT_LOGS.md",
	"DEPLOYMENT_PIPELINE.md",
	"DEPLOYMENT_STATUS_REFERENCE.md",
	"DOMAIN_AND_TLS_ISSUES.md",
	"ENVIRONMENT_VARIABLES.md",
	"ERROR_CATALOG.md",
	"FAQ.md",
	"GETTING_STARTED.md",
	"GLOSSARY.md",
	"HEALTH_CHECKS.md",
	"HOW_IT_WORKS.md",
	"MONOREPOS_AND_MULTI_SERVICE.md",
	"RAILPACK.md",
	"README.md",
	"RUNTIME_HEALTH.md",
	"SMART_ANALYSIS.md",
	"STARTUP_AND_RUNTIME_FAILURES.md",
	"WHAT_IS_SMART_DEPLOY.md",
] as const;

const PUBLIC_DOC_FILENAME_LOOKUP = new Map(
	PUBLIC_DOC_FILENAMES.map((filename) => [filename.toLowerCase(), filename])
);

const DOC_MENTION_REGEX = /(?:docs\/|\.\/)?([A-Za-z][A-Za-z0-9_]*\.md)\b/g;
const SOURCES_SUFFIX_REGEX = /\s*(?:\(Sources:\s*[^)]+\)|Sources:\s*(?:docs\/[A-Za-z0-9_]+\.md(?:\s*,\s*)?)+)\s*$/i;

export type AgentDocCitation = {
	source: string;
	href: string;
	label: string;
};

function normalizeDocFilename(rawFilename: string): string | null {
	const trimmed = rawFilename.trim();
	if (!trimmed.toLowerCase().endsWith(".md")) {
		return null;
	}
	return PUBLIC_DOC_FILENAME_LOOKUP.get(trimmed.toLowerCase()) ?? null;
}

function toDocCitation(filename: string): AgentDocCitation {
	const source = `docs/${filename}`;
	return {
		source,
		href: `/docs/${slugFromMarkdownFilename(filename)}`,
		label: titleFromMarkdownFilename(filename),
	};
}

function mergeAgentDocCitations(groups: AgentDocCitation[][]): AgentDocCitation[] {
	const merged: AgentDocCitation[] = [];
	const seen = new Set<string>();

	for (const group of groups) {
		for (const citation of group) {
			if (seen.has(citation.source)) {
				continue;
			}
			seen.add(citation.source);
			merged.push(citation);
		}
	}

	return merged;
}

export function docCitationsFromSources(sources: string[]): AgentDocCitation[] {
	const citations: AgentDocCitation[] = [];
	const seen = new Set<string>();

	for (const source of sources) {
		const match = /^docs\/(.+\.md)$/i.exec(source.trim());
		if (!match) {
			continue;
		}
		const filename = normalizeDocFilename(match[1] ?? "");
		if (!filename || seen.has(filename)) {
			continue;
		}
		seen.add(filename);
		citations.push(toDocCitation(filename));
	}

	return citations;
}

type SearchDocsToolResult = {
	citations?: string[];
	chunks?: Array<{ source: string }>;
};

type SearchExternalDocsToolResult = {
	results?: Array<{ title: string; url: string }>;
};

function externalDocCitationsFromResult(result: SearchExternalDocsToolResult): AgentDocCitation[] {
	if (!Array.isArray(result.results)) {
		return [];
	}

	const citations: AgentDocCitation[] = [];
	const seen = new Set<string>();
	for (const entry of result.results) {
		try {
			const url = new URL(entry.url);
			if (url.protocol !== "https:" || seen.has(url.href)) {
				continue;
			}
			seen.add(url.href);
			citations.push({
				source: url.href,
				href: url.href,
				label: entry.title.trim() || url.hostname,
			});
		} catch {
			continue;
		}
	}

	return citations;
}

export function collectDocCitationsFromToolResults(
	toolResults: Array<{ name: string; result: unknown }>
): AgentDocCitation[] {
	const citationGroups: AgentDocCitation[][] = [];

	for (const toolResult of toolResults) {
		if (toolResult.name === "search_docs") {
			const result = toolResult.result as SearchDocsToolResult;
			const sources = Array.isArray(result.citations)
				? result.citations
				: Array.isArray(result.chunks)
					? result.chunks.map((chunk) => chunk.source)
					: [];
			citationGroups.push(docCitationsFromSources(sources));
			continue;
		}

		if (toolResult.name === "search_external_docs") {
			citationGroups.push(externalDocCitationsFromResult(toolResult.result as SearchExternalDocsToolResult));
		}
	}

	return mergeAgentDocCitations(citationGroups);
}

export const collectDocCitationsFromSearchDocsToolResults = collectDocCitationsFromToolResults;

export function extractAgentDocCitations(content: string): AgentDocCitation[] {
	const citations: AgentDocCitation[] = [];
	const seen = new Set<string>();

	for (const match of content.matchAll(DOC_MENTION_REGEX)) {
		const filename = normalizeDocFilename(match[1] ?? "");
		if (!filename || seen.has(filename)) {
			continue;
		}
		seen.add(filename);
		citations.push(toDocCitation(filename));
	}

	return citations;
}

export function stripAgentDocSourcesSuffix(content: string): string {
	return content.replace(SOURCES_SUFFIX_REGEX, "").trimEnd();
}

export function prepareAgentAssistantMessage(
	content: string,
	toolDocCitations: AgentDocCitation[] = []
): {
	displayContent: string;
	docCitations: AgentDocCitation[];
} {
	return {
		displayContent: stripAgentDocSourcesSuffix(content),
		docCitations: mergeAgentDocCitations([toolDocCitations, extractAgentDocCitations(content)]),
	};
}
