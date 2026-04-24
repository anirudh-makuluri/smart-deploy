import { getAllHelpDocChunks, type HelpDocChunk } from "@/lib/helpAgentDocsCore";

type MossQueryDoc = {
	id?: string;
	text?: string;
	score?: number;
};

type MossQueryResponse = {
	docs?: MossQueryDoc[];
};

type MossClientLike = {
	createIndex: (name: string, docs: Array<{ id: string; text: string }>) => Promise<unknown>;
	loadIndex: (name: string) => Promise<unknown>;
	query: (name: string, question: string, options: { topK: number }) => Promise<MossQueryResponse>;
	addDocs?: (name: string, docs: Array<{ id: string; text: string }>, options?: { upsert?: boolean }) => Promise<unknown>;
};

const mossProjectId = process.env.MOSS_PROJECT_ID?.trim() || "";
const mossProjectKey = process.env.MOSS_PROJECT_KEY?.trim() || "";
const mossIndexName = process.env.MOSS_HELP_AGENT_INDEX_NAME?.trim() || "smart_deploy_help_docs";

let initPromise: Promise<{ client: MossClientLike; indexName: string } | null> | null = null;

function isMossEnabled(): boolean {
	return Boolean(mossProjectId && mossProjectKey);
}

function toMossText(chunk: HelpDocChunk): string {
	return [
		`SOURCE: ${chunk.source}`,
		`SECTION: ${chunk.section}`,
		"CONTENT:",
		chunk.content,
	].join("\n");
}

function parseMossText(doc: MossQueryDoc): HelpDocChunk {
	const text = String(doc.text ?? "");
	const sourceMatch = /^SOURCE:\s*(.+)$/im.exec(text);
	const sectionMatch = /^SECTION:\s*(.+)$/im.exec(text);
	const contentMatch = /CONTENT:\s*([\s\S]*)$/im.exec(text);

	const source = sourceMatch?.[1]?.trim() || doc.id || "moss";
	const section = sectionMatch?.[1]?.trim() || "Moss result";
	const content = (contentMatch?.[1] ?? text).trim();

	return {
		id: String(doc.id ?? `${source}#moss`),
		source,
		section,
		content,
		score: typeof doc.score === "number" ? doc.score : undefined,
	};
}

function dedupeChunks(chunks: HelpDocChunk[]): HelpDocChunk[] {
	const seen = new Set<string>();
	const result: HelpDocChunk[] = [];
	for (const chunk of chunks) {
		const key = `${chunk.source}::${chunk.section}::${chunk.content.slice(0, 120)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(chunk);
	}
	return result;
}

async function initializeMoss(): Promise<{ client: MossClientLike; indexName: string } | null> {
	if (!isMossEnabled()) return null;

	try {
		const mossModule = await import("@moss-dev/moss");
		const MossClientCtor = (mossModule as { MossClient?: new (id: string, key: string) => MossClientLike }).MossClient;
		if (!MossClientCtor) {
			console.warn("Help-agent Moss disabled: failed to load MossClient");
			return null;
		}

		const client = new MossClientCtor(mossProjectId, mossProjectKey);

		try {
			await client.loadIndex(mossIndexName);
			return { client, indexName: mossIndexName };
		} catch {
			// Index does not exist yet; create it from docs corpus.
		}

		const allChunks = await getAllHelpDocChunks();
		const docs = allChunks.map((chunk, index) => ({
			id: `help-doc-${index}`,
			text: toMossText(chunk),
		}));

		if (docs.length === 0) {
			console.warn("Help-agent Moss disabled: no docs corpus available");
			return null;
		}

		const seedCount = Math.min(32, docs.length);
		await client.createIndex(mossIndexName, docs.slice(0, seedCount));

		if (typeof client.addDocs === "function" && docs.length > seedCount) {
			for (let i = seedCount; i < docs.length; i += 40) {
				await client.addDocs(mossIndexName, docs.slice(i, i + 40), { upsert: true });
			}
		}

		await client.loadIndex(mossIndexName);
		return { client, indexName: mossIndexName };
	} catch (error) {
		console.warn("Help-agent Moss initialization failed; continuing without Moss", error);
		return null;
	}
}

async function getMossRuntime(): Promise<{ client: MossClientLike; indexName: string } | null> {
	if (!initPromise) {
		initPromise = initializeMoss();
	}
	return initPromise;
}

export async function getMossHelpContext(question: string, limit = 4): Promise<HelpDocChunk[]> {
	if (!question.trim()) return [];
	const runtime = await getMossRuntime();
	if (!runtime) return [];

	try {
		const queried = await runtime.client.query(runtime.indexName, question, { topK: limit });
		const docs = (queried.docs ?? []).map(parseMossText).filter((chunk) => chunk.content.length > 0);
		return dedupeChunks(docs).slice(0, limit);
	} catch (error) {
		console.warn("Help-agent Moss query failed; using deterministic context only", error);
		return [];
	}
}

export type MossHelpContextResult = {
	chunks: HelpDocChunk[];
	mossRetrievalMs: number | null;
	mossEnabled: boolean;
};

export async function getMossHelpContextWithMetrics(question: string, limit = 4): Promise<MossHelpContextResult> {
	if (!question.trim()) {
		return { chunks: [], mossRetrievalMs: null, mossEnabled: isMossEnabled() };
	}

	if (!isMossEnabled()) {
		return { chunks: [], mossRetrievalMs: null, mossEnabled: false };
	}

	const startedAt = Date.now();
	const chunks = await getMossHelpContext(question, limit);
	return {
		chunks,
		mossRetrievalMs: Date.now() - startedAt,
		mossEnabled: true,
	};
}
