import { searchPlatformDocs, type PlatformDocChunk } from "@/lib/platformDocsCore";
import { getMossPlatformDocsContextWithMetrics } from "@/lib/platformDocsMoss";

const DEFAULT_LIMIT = 8;

export type PlatformDocsRetrievalResult = {
	chunks: PlatformDocChunk[];
	mossEnabled: boolean;
	mossRetrievalMs: number | null;
};

export async function retrievePlatformDocChunks(
	question: string,
	limit = DEFAULT_LIMIT
): Promise<PlatformDocsRetrievalResult> {
	const trimmedQuestion = question.trim();
	if (!trimmedQuestion) {
		return { chunks: [], mossEnabled: false, mossRetrievalMs: null };
	}

	const mossContext = await getMossPlatformDocsContextWithMetrics(trimmedQuestion, limit);
	if (mossContext.chunks.length > 0) {
		return {
			chunks: mossContext.chunks,
			mossEnabled: mossContext.mossEnabled,
			mossRetrievalMs: mossContext.mossRetrievalMs,
		};
	}

	const deterministicChunks = await searchPlatformDocs(trimmedQuestion, limit);
	return {
		chunks: deterministicChunks,
		mossEnabled: mossContext.mossEnabled,
		mossRetrievalMs: mossContext.mossRetrievalMs,
	};
}