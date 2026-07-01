import { getAllPlatformDocChunks, type PlatformDocChunk } from "@/lib/platformDocsCore";
import {
	getMossIndexName,
	isMossConfigured,
	PlatformMossRuntime,
	runSequentialTasks,
	type PlatformMossDoc,
} from "@/lib/platformMossRuntime";

const mossIndexName = getMossIndexName();

let initPromise: Promise<PlatformMossRuntime | null> | null = null;

function isMossEnabled(): boolean {
	return isMossConfigured();
}

function toMossText(chunk: PlatformDocChunk): string {
	return [
		`SOURCE: ${chunk.source}`,
		`SECTION: ${chunk.section}`,
		"CONTENT:",
		chunk.content,
	].join("\n");
}

function toMossDocs(chunks: PlatformDocChunk[]): PlatformMossDoc[] {
	return chunks.map((chunk, index) => ({
		id: `platform-doc-${index}`,
		text: toMossText(chunk),
	}));
}

function parseMossText(args: { id: string; text: string; score: number }): PlatformDocChunk {
	const text = args.text;
	const sourceMatch = /^SOURCE:\s*(.+)$/im.exec(text);
	const sectionMatch = /^SECTION:\s*(.+)$/im.exec(text);
	const contentMatch = /CONTENT:\s*([\s\S]*)$/im.exec(text);

	const source = sourceMatch?.[1]?.trim() || args.id || "moss";
	const section = sectionMatch?.[1]?.trim() || "Moss result";
	const content = (contentMatch?.[1] ?? text).trim();

	return {
		id: `${source}#moss`,
		source,
		section,
		content,
		score: args.score,
	};
}

function dedupeChunks(chunks: PlatformDocChunk[]): PlatformDocChunk[] {
	const seen = new Set<string>();
	const result: PlatformDocChunk[] = [];
	for (const chunk of chunks) {
		const key = `${chunk.source}::${chunk.section}::${chunk.content.slice(0, 120)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(chunk);
	}
	return result;
}

async function initializeMoss(): Promise<PlatformMossRuntime | null> {
	if (!isMossEnabled()) return null;

	try {
		const runtime = PlatformMossRuntime.createFromEnv();
		if (!runtime) {
			return null;
		}

		try {
			await runtime.loadIndex(mossIndexName);
			return runtime;
		} catch {
			// Index does not exist yet; create it from docs corpus.
		}

		const allChunks = await getAllPlatformDocChunks();
		const docs = toMossDocs(allChunks);
		if (docs.length === 0) {
			console.warn("Platform docs Moss disabled: no docs corpus available");
			return null;
		}

		const seedCount = Math.min(32, docs.length);
		await runtime.createIndex(mossIndexName, docs.slice(0, seedCount));

		if (docs.length > seedCount) {
			const batches: PlatformMossDoc[][] = [];
			for (let i = seedCount; i < docs.length; i += 40) {
				batches.push(docs.slice(i, i + 40));
			}
			await runSequentialTasks(batches, (batch) => runtime.addDocs(mossIndexName, batch, { upsert: true }));
		}

		await runtime.loadIndex(mossIndexName);
		return runtime;
	} catch (error) {
		console.warn("Platform docs Moss initialization failed; continuing without Moss", error);
		return null;
	}
}

async function getMossRuntime(): Promise<PlatformMossRuntime | null> {
	if (!initPromise) {
		initPromise = initializeMoss();
	}
	return initPromise;
}

export async function getMossPlatformDocsContext(question: string, limit = 4): Promise<PlatformDocChunk[]> {
	if (!question.trim()) return [];
	const runtime = await getMossRuntime();
	if (!runtime) return [];

	try {
		const queried = await runtime.query(mossIndexName, question, limit);
		const docs = (queried.docs ?? []).flatMap((doc) => {
			const chunk = parseMossText({
				id: doc.id,
				text: doc.text,
				score: doc.score,
			});
			return chunk.content.length > 0 ? [chunk] : [];
		});
		return dedupeChunks(docs).slice(0, limit);
	} catch (error) {
		console.warn("Platform docs Moss query failed; using deterministic context only", error);
		return [];
	}
}

export type MossPlatformDocsContextResult = {
	chunks: PlatformDocChunk[];
	mossRetrievalMs: number | null;
	mossEnabled: boolean;
};

export async function getMossPlatformDocsContextWithMetrics(
	question: string,
	limit = 4
): Promise<MossPlatformDocsContextResult> {
	if (!question.trim()) {
		return { chunks: [], mossRetrievalMs: null, mossEnabled: isMossEnabled() };
	}

	if (!isMossEnabled()) {
		return { chunks: [], mossRetrievalMs: null, mossEnabled: false };
	}

	const startedAt = Date.now();
	const chunks = await getMossPlatformDocsContext(question, limit);
	return {
		chunks,
		mossRetrievalMs: Date.now() - startedAt,
		mossEnabled: true,
	};
}