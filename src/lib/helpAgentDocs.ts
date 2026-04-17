import "server-only";

import { listDocMarkdownFiles, readDocsMarkdownBySlug, readProjectReadme } from "@/lib/public-docs";

export type HelpDocChunk = {
	id: string;
	source: string;
	section: string;
	content: string;
	score?: number;
};

type InternalChunk = HelpDocChunk & {
	tokens: string[];
};

let corpusPromise: Promise<InternalChunk[]> | null = null;

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"how",
	"i",
	"in",
	"is",
	"it",
	"of",
	"on",
	"or",
	"that",
	"the",
	"to",
	"was",
	"we",
	"what",
	"when",
	"where",
	"why",
	"with",
	"you",
	"your",
]);

function tokenize(value: string): string[] {
	return value
		.toLowerCase()
		.replace(/[`*_>#()[\]{}:;,.!?/\\'"|-]/g, " ")
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function sourceWeight(source: string): number {
	if (source.endsWith("TROUBLESHOOTING.md")) return 2.2;
	if (source.endsWith("FAQ.md")) return 1.8;
	if (source === "README.md") return 1.4;
	if (source.endsWith("_SETUP.md") || source.endsWith("SELF_HOSTING.md")) return 1.2;
	if (source.endsWith("FIELD_AUDIT.md") || source.endsWith("GRAPHQL_YOGA_MIGRATION.md")) return 0.7;
	return 1;
}

function buildChunksFromMarkdown(markdown: string, source: string): InternalChunk[] {
	const lines = markdown.split(/\r?\n/);
	const chunks: InternalChunk[] = [];
	let section = "Overview";
	let buffer: string[] = [];
	let index = 0;

	const pushChunk = () => {
		const content = buffer.join("\n").trim();
		buffer = [];
		if (content.length < 60) return;
		const trimmed = content.slice(0, 1800);
		chunks.push({
			id: `${source}#${index++}`,
			source,
			section,
			content: trimmed,
			tokens: tokenize(`${section}\n${trimmed}`),
		});
	};

	for (const line of lines) {
		const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
		if (heading) {
			pushChunk();
			section = heading[2].trim();
			continue;
		}
		buffer.push(line);
	}

	pushChunk();
	return chunks;
}

async function buildCorpus(): Promise<InternalChunk[]> {
	const [readme, docFiles] = await Promise.all([readProjectReadme(), listDocMarkdownFiles()]);
	const chunks: InternalChunk[] = buildChunksFromMarkdown(readme, "README.md");

	for (const docFile of docFiles) {
		const doc = await readDocsMarkdownBySlug(docFile.slug);
		if (!doc) continue;
		const source = `docs/${doc.filename}`;
		chunks.push(...buildChunksFromMarkdown(doc.content, source));
	}

	return chunks;
}

async function getCorpus(): Promise<InternalChunk[]> {
	if (!corpusPromise) {
		corpusPromise = buildCorpus();
	}
	return corpusPromise;
}

function scoreChunk(queryTokens: string[], queryLower: string, chunk: InternalChunk): number {
	if (queryTokens.length === 0) return 0;
	const uniqueChunkTokens = new Set(chunk.tokens);
	let overlap = 0;
	for (const token of queryTokens) {
		if (uniqueChunkTokens.has(token)) overlap += 1;
	}

	const sectionBoost = queryTokens.some((token) => chunk.section.toLowerCase().includes(token)) ? 0.8 : 0;
	const phraseBoost = chunk.content.toLowerCase().includes(queryLower) && queryLower.length > 14 ? 1.2 : 0;
	return overlap * sourceWeight(chunk.source) + sectionBoost + phraseBoost;
}

export async function getHelpContext(question: string, limit = 6): Promise<HelpDocChunk[]> {
	const corpus = await getCorpus();
	const queryTokens = tokenize(question);
	const queryLower = question.toLowerCase().trim();

	const ranked = corpus
		.map((chunk) => {
			const score = scoreChunk(queryTokens, queryLower, chunk);
			return { ...chunk, score };
		})
		.filter((chunk) => (chunk.score ?? 0) > 0.9)
		.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
		.slice(0, limit)
		.map(({ tokens: _tokens, ...chunk }) => chunk);

	return ranked;
}
