import { listDocMarkdownFiles, readDocsMarkdownBySlug, readProjectReadme } from "@/lib/public-docsCore";

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
	if (source.endsWith("DEBUGGING_DEPLOYMENTS.md")) return 2.4;
	if (source.endsWith("ERROR_CATALOG.md")) return 2.2;
	if (source.endsWith("FAQ.md")) return 1.8;
	if (source.endsWith("DEPLOYMENT_AGENT.md")) return 1.6;
	if (source === "README.md") return 1.4;
	if (source.endsWith("BUILD_FAILURES.md") || source.endsWith("STARTUP_AND_RUNTIME_FAILURES.md")) return 1.3;
	if (source.includes("/internal/")) return 0.5;
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

	const docChunks = await Promise.all(
		docFiles.flatMap((docFile) =>
			docFile.filename === "HELP_AGENT_BENCHMARK.md"
				? []
				: [
						(async () => {
							const doc = await readDocsMarkdownBySlug(docFile.slug);
							if (!doc) return [] as InternalChunk[];
							return buildChunksFromMarkdown(doc.content, `docs/${doc.filename}`);
						})(),
					]
		)
	);
	chunks.push(...docChunks.flat());

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
		.flatMap((chunk) => {
			const score = scoreChunk(queryTokens, queryLower, chunk);
			return score > 0.9 ? [{ ...chunk, score }] : [];
		})
		.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
		.slice(0, limit)
		.map(({ tokens: _tokens, ...chunk }) => chunk);

	return ranked;
}

export async function getAllHelpDocChunks(): Promise<HelpDocChunk[]> {
	const corpus = await getCorpus();
	return corpus.map(({ tokens: _tokens, ...chunk }) => chunk);
}