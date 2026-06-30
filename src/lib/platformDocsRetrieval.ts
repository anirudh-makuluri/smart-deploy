import { searchPlatformDocs, type PlatformDocChunk } from "@/lib/platformDocsCore";
import { getMossPlatformDocsContextWithMetrics } from "@/lib/platformDocsMoss";

export type PlatformDocsRetrievalResult = {
	chunks: PlatformDocChunk[];
	mossEnabled: boolean;
	mossRetrievalMs: number | null;
};

function mergeChunks(primary: PlatformDocChunk[], secondary: PlatformDocChunk[], limit: number): PlatformDocChunk[] {
	const merged = [...primary, ...secondary];
	const seen = new Set<string>();
	const deduped: PlatformDocChunk[] = [];

	for (const chunk of merged) {
		const key = `${chunk.source}::${chunk.section}::${chunk.content.slice(0, 120)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(chunk);
		if (deduped.length >= limit) break;
	}

	return deduped;
}

export async function retrievePlatformDocChunks(
	question: string,
	options?: {
		deterministicLimit?: number;
		mossLimit?: number;
		mergedLimit?: number;
	}
): Promise<PlatformDocsRetrievalResult> {
	const trimmedQuestion = question.trim();
	if (!trimmedQuestion) {
		return { chunks: [], mossEnabled: false, mossRetrievalMs: null };
	}

	const deterministicLimit = options?.deterministicLimit ?? 6;
	const mossLimit = options?.mossLimit ?? 4;
	const mergedLimit = options?.mergedLimit ?? 8;

	const [deterministicChunks, mossContext] = await Promise.all([
		searchPlatformDocs(trimmedQuestion, deterministicLimit),
		getMossPlatformDocsContextWithMetrics(trimmedQuestion, mossLimit),
	]);

	return {
		chunks: mergeChunks(deterministicChunks, mossContext.chunks, mergedLimit),
		mossEnabled: mossContext.mossEnabled,
		mossRetrievalMs: mossContext.mossRetrievalMs,
	};
}