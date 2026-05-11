import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { getAllHelpDocChunks, getHelpContext, type HelpDocChunk } from "@/lib/helpAgentDocsCore";

type ChatTurn = {
	role: "user" | "assistant";
	content: string;
};

type BenchmarkCase = {
	id: string;
	question: string;
	history?: ChatTurn[];
	expectedSignals: string[];
	notes?: string;
};

type RetrievalDoc = Pick<HelpDocChunk, "source" | "section" | "content"> & {
	score?: number;
};

type TargetResult = {
	target: string;
	caseId: string;
	ms: number;
	coverage: number;
	matchedSignals: string[];
	topSources: string[];
	chunkCount: number;
	notes?: string;
};

type CandidateRetrievalResponse = {
	docs?: RetrievalDoc[];
	results?: RetrievalDoc[];
	items?: RetrievalDoc[];
};

type MossQueryDoc = {
	id?: string;
	text?: string;
	score?: number;
	metadata?: Record<string, unknown>;
};

type MossQueryResponse = {
	docs?: MossQueryDoc[];
};

type MossClientLike = {
	createIndex: (name: string, docs: Array<{ id: string; text: string; metadata: Record<string, unknown> }>) => Promise<unknown>;
	loadIndex: (name: string) => Promise<unknown>;
	query: (name: string, question: string, options: { topK: number }) => Promise<MossQueryResponse>;
	addDocs?: (
		name: string,
		docs: Array<{ id: string; text: string; metadata?: Record<string, unknown> }>,
		options?: { upsert?: boolean }
	) => Promise<unknown>;
	deleteIndex?: (name: string) => Promise<unknown>;
};

type MossHarness = {
	run: (caseItem: BenchmarkCase) => Promise<TargetResult>;
	cleanup: () => Promise<void>;
};

async function loadOptionalMossModule(): Promise<unknown> {
	const dynamicImport = new Function("moduleName", "return import(moduleName);") as (moduleName: string) => Promise<unknown>;
	return dynamicImport("@moss-dev/moss-web");
}

const root = path.join(__dirname, "..");
const promptsPath = path.join(root, "benchmarks", "help-agent-benchmark.prompts.json");
const defaultCandidateUrl = process.env.MOSS_BENCHMARK_URL?.trim() || "";
// Credentials must be provided via environment variables for Moss integration
const defaultMossProjectId = "";
const defaultMossProjectKey = "";
const debugEnabled = process.env.HELP_AGENT_BENCHMARK_DEBUG === "1";
const keepMossIndex = process.env.KEEP_MOSS_INDEX === "1";

function debugLog(message: string, details?: Record<string, unknown>) {
	if (!debugEnabled) return;
	if (details) {
		console.log(`[help-agent-benchmark] ${message}`, details);
		return;
	}
	console.log(`[help-agent-benchmark] ${message}`);
}

function formatErrorDetails(error: unknown): Record<string, unknown> {
	if (error instanceof Error) {
		const e = error as Error & { cause?: unknown; stack?: string };
		return {
			name: e.name,
			message: e.message,
			cause: e.cause ?? null,
			stack: e.stack?.split("\n").slice(0, 5).join("\n") ?? null,
		};
	}
	return { message: String(error) };
}

function loadBenchmarkCases(): BenchmarkCase[] {
	const raw = fs.readFileSync(promptsPath, "utf-8");
	const parsed = JSON.parse(raw) as BenchmarkCase[];
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new Error("Benchmark prompt set is empty");
	}
	return parsed;
}

function normalizeText(value: unknown): string {
	return String(value ?? "").toLowerCase();
}

function normalizeDocs(docs: RetrievalDoc[]): RetrievalDoc[] {
	return docs.map((doc) => ({
		source: String(doc.source ?? ""),
		section: String(doc.section ?? ""),
		content: String(doc.content ?? ""),
		score: typeof doc.score === "number" ? doc.score : undefined,
	}));
}

function scoreCoverage(expectedSignals: string[], docs: RetrievalDoc[]) {
	const haystack = docs
		.map((doc) => normalizeText([doc.source, doc.section, doc.content].join(" \n")))
		.join("\n\n");
	const matchedSignals = expectedSignals.filter((signal) => haystack.includes(normalizeText(signal)));
	return {
		coverage: expectedSignals.length === 0 ? 0 : Math.round((matchedSignals.length / expectedSignals.length) * 100),
		matchedSignals,
	};
}

function topSources(docs: RetrievalDoc[]): string[] {
	return Array.from(new Set(docs.map((doc) => doc.source).filter(Boolean))).slice(0, 3);
}

async function benchmarkBaseline(caseItem: BenchmarkCase): Promise<TargetResult> {
	const start = performance.now();
	const docs = normalizeDocs(await getHelpContext(caseItem.question, 6));
	const ms = Math.round(performance.now() - start);
	const { coverage, matchedSignals } = scoreCoverage(caseItem.expectedSignals, docs);
	return {
		target: "baseline",
		caseId: caseItem.id,
		ms,
		coverage,
		matchedSignals,
		topSources: topSources(docs),
		chunkCount: docs.length,
		notes: caseItem.notes,
	};
}

async function fetchCandidateDocs(caseItem: BenchmarkCase, candidateUrl: string): Promise<RetrievalDoc[]> {
	debugLog("Candidate endpoint request", { caseId: caseItem.id, url: candidateUrl });
	const response = await fetch(candidateUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ question: caseItem.question, history: caseItem.history ?? [] }),
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`Candidate endpoint returned ${response.status}: ${errText.slice(0, 200)}`);
	}

	const payload = (await response.json()) as CandidateRetrievalResponse | RetrievalDoc[];
	const docs = Array.isArray(payload)
		? payload
		: payload.docs ?? payload.results ?? payload.items ?? [];
	debugLog("Candidate endpoint response", { caseId: caseItem.id, docs: docs.length });
	return normalizeDocs(docs);
}

async function benchmarkCandidate(caseItem: BenchmarkCase, candidateUrl: string): Promise<TargetResult> {
	const start = performance.now();
	const docs = await fetchCandidateDocs(caseItem, candidateUrl);
	const ms = Math.round(performance.now() - start);
	const { coverage, matchedSignals } = scoreCoverage(caseItem.expectedSignals, docs);
	return {
		target: "moss",
		caseId: caseItem.id,
		ms,
		coverage,
		matchedSignals,
		topSources: topSources(docs),
		chunkCount: docs.length,
		notes: caseItem.notes,
	};
}

function docsFromMossQuery(queryResponse: MossQueryResponse | null | undefined): RetrievalDoc[] {
	const docs = queryResponse?.docs ?? [];
	return docs.map((doc) => {
		// Latest Moss SDK does not include metadata, so fallback to doc.id and generic section
		const source = typeof doc.id === "string" ? doc.id : "moss";
		const section = "Moss result";
		return {
			source,
			section,
			content: String(doc.text ?? ""),
			score: typeof doc.score === "number" ? doc.score : undefined,
		};
	});
}

function toMossIndexName(timestamp: number): string {
	return `smart_deploy_help_bench_${timestamp}`;
}

function trimForMoss(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars - 1)}…`;
}

function buildMossDocs(
	chunks: HelpDocChunk[],
	options: { maxChars: number; includeMetadata: boolean }
): Array<{ id: string; text: string; metadata?: Record<string, unknown> }> {
	return chunks.map((chunk, index) => {
		const doc = {
			id: `help-doc-${index}`,
			text: trimForMoss(`${chunk.section}\n${chunk.content}`, options.maxChars),
		};
		if (!options.includeMetadata) return doc;
		return {
			...doc,
			metadata: {
				source: chunk.source,
				section: chunk.section,
			},
		};
	});
}

async function createIndexWithRetry(
	client: MossClientLike,
	indexName: string,
	allChunks: HelpDocChunk[]
): Promise<Array<{ id: string; text: string; metadata?: Record<string, unknown> }>> {
	// Latest Moss SDK does not support metadata fields in documents
	const plans = [
		{ seedCount: 32, maxChars: 1200, includeMetadata: false },
		{ seedCount: 16, maxChars: 1000, includeMetadata: false },
		{ seedCount: 8, maxChars: 700, includeMetadata: false },
		{ seedCount: 4, maxChars: 500, includeMetadata: false },
	];

	let lastError: unknown = null;
	for (const plan of plans) {
		const docs = buildMossDocs(allChunks, {
			maxChars: plan.maxChars,
			includeMetadata: plan.includeMetadata,
		});
		const seedDocs = docs.slice(0, Math.min(plan.seedCount, docs.length));

		try {
			debugLog("Moss createIndex attempt", {
				indexName,
				seedDocs: seedDocs.length,
				maxChars: plan.maxChars,
				includeMetadata: plan.includeMetadata,
			});
			await client.createIndex(indexName, seedDocs as Array<{ id: string; text: string; metadata: Record<string, unknown> }>);
			debugLog("Moss createIndex succeeded", { indexName, seedDocs: seedDocs.length });

			const remaining = docs.slice(seedDocs.length);
			if (remaining.length > 0 && typeof client.addDocs === "function") {
				const batchSize = Math.max(1, Number(process.env.MOSS_BENCHMARK_BATCH_SIZE || 40));
				debugLog("Moss addDocs start", { indexName, remaining: remaining.length, batchSize });
				for (let i = 0; i < remaining.length; i += batchSize) {
					const batch = remaining.slice(i, i + batchSize);
					await client.addDocs(indexName, batch, { upsert: true });
				}
				debugLog("Moss addDocs complete", { indexName });
			}

			return docs;
		} catch (error) {
			lastError = error;
			console.error("Moss createIndex attempt failed", {
				indexName,
				seedDocs: seedDocs.length,
				maxChars: plan.maxChars,
				includeMetadata: plan.includeMetadata,
				...formatErrorDetails(error),
			});
		}
	}

	throw lastError instanceof Error ? lastError : new Error("Failed to create Moss index after retries");
}

async function createMossHarness(): Promise<MossHarness | null> {
	const projectId = process.env.MOSS_PROJECT_ID?.trim() || defaultMossProjectId;
	const projectKey = process.env.MOSS_PROJECT_KEY?.trim() || defaultMossProjectKey;
	if (!projectId || !projectKey) return null;
 
	debugLog("Preparing Moss harness", {
		usingEnvProjectId: Boolean(process.env.MOSS_PROJECT_ID?.trim()),
		usingEnvProjectKey: Boolean(process.env.MOSS_PROJECT_KEY?.trim()),
		projectIdPreview: `${projectId.slice(0, 8)}...`,
		keepMossIndex,
	});

	const mossModule = await loadOptionalMossModule();
	const MossClientCtor = (mossModule as { MossClient?: new (id: string, key: string) => MossClientLike }).MossClient;
	if (!MossClientCtor) {
		throw new Error("Failed to load MossClient from @moss-dev/moss-web");
	}

	const client = new MossClientCtor(projectId, projectKey);
	const indexName = toMossIndexName(Date.now());
	const chunks = await getAllHelpDocChunks();
	debugLog("Moss corpus prepared", { indexName, chunkCount: chunks.length });

	try {
		const docs = await createIndexWithRetry(client, indexName, chunks);
		debugLog("Moss createIndex complete", { indexName, docs: docs.length });
		debugLog("Moss createIndex complete", { indexName });
	} catch (error) {
		console.error("Moss createIndex failed", formatErrorDetails(error));
		throw error;
	}

	try {
		debugLog("Moss loadIndex start", { indexName });
		await client.loadIndex(indexName);
		debugLog("Moss loadIndex complete", { indexName });
	} catch (error) {
		console.error("Moss loadIndex failed", formatErrorDetails(error));
		throw error;
	}

	return {
		run: async (caseItem: BenchmarkCase) => {
			const start = performance.now();
			let queried: MossQueryResponse;
			try {
				debugLog("Moss query start", { indexName, caseId: caseItem.id });
				queried = await client.query(indexName, caseItem.question, { topK: 6 });
				debugLog("Moss query complete", { indexName, caseId: caseItem.id, docs: queried.docs?.length ?? 0 });
			} catch (error) {
				console.error("Moss query failed", {
					caseId: caseItem.id,
					indexName,
					...formatErrorDetails(error),
				});
				throw error;
			}
			const ms = Math.round(performance.now() - start);
			const normalizedDocs = docsFromMossQuery(queried);
			const { coverage, matchedSignals } = scoreCoverage(caseItem.expectedSignals, normalizedDocs);
			return {
				target: "moss",
				caseId: caseItem.id,
				ms,
				coverage,
				matchedSignals,
				topSources: topSources(normalizedDocs),
				chunkCount: normalizedDocs.length,
				notes: caseItem.notes,
			};
		},
		cleanup: async () => {
			if (keepMossIndex) {
				console.log(`KEEP_MOSS_INDEX=1, skipping deleteIndex for ${indexName}`);
				return;
			}
			if (typeof client.deleteIndex === "function") {
				try {
					debugLog("Moss deleteIndex start", { indexName });
					await client.deleteIndex(indexName);
					debugLog("Moss deleteIndex complete", { indexName });
				} catch (error) {
					console.error("Moss deleteIndex failed", {
						indexName,
						...formatErrorDetails(error),
					});
				}
			}
		},
	};
}

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

async function main() {
	debugLog("Benchmark run options", {
		debugEnabled,
		keepMossIndex,
		candidateUrlMode: Boolean(defaultCandidateUrl),
	});

	const cases = loadBenchmarkCases();
	console.log(`Loaded ${cases.length} help-agent benchmark cases.`);

	// Warm the corpus cache so baseline timings reflect steady-state retrieval.
	await getHelpContext("benchmark warmup", 1);

	const results: TargetResult[] = [];
	for (const caseItem of cases) {
		results.push(await benchmarkBaseline(caseItem));
	}

	let mossHarness: MossHarness | null = null;
	if (defaultCandidateUrl) {
		debugLog("Running candidate endpoint mode", { url: defaultCandidateUrl });
		for (const caseItem of cases) {
			results.push(await benchmarkCandidate(caseItem, defaultCandidateUrl));
		}
	} else {
		try {
			debugLog("Running direct Moss SDK mode");
			mossHarness = await createMossHarness();
			if (mossHarness) {
				for (const caseItem of cases) {
					results.push(await mossHarness.run(caseItem));
				}
			} else {
				console.log("Skipping Moss candidate: set MOSS_BENCHMARK_URL or Moss credentials.");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`Moss benchmark failed: ${message}`);
			console.log("Continuing with baseline-only results.");
		} finally {
			if (mossHarness) {
				await mossHarness.cleanup();
			}
		}
	}

	const grouped = results.reduce<Record<string, TargetResult[]>>((acc, result) => {
		acc[result.target] ??= [];
		acc[result.target].push(result);
		return acc;
	}, {});

	for (const [target, entries] of Object.entries(grouped)) {
		console.log(`\n${target.toUpperCase()}`);
		console.table(
			entries.map((entry) => ({
				caseId: entry.caseId,
				ms: entry.ms,
				coverage: `${entry.coverage}%`,
				chunkCount: entry.chunkCount,
				topSources: entry.topSources.join(", "),
				matchedSignals: entry.matchedSignals.join(", "),
			})),
		);
		console.log(
			`${target} summary: avg latency ${average(entries.map((entry) => entry.ms))} ms, avg coverage ${average(entries.map((entry) => entry.coverage))}%`,
		);
	}

	const outputPath = process.env.HELP_AGENT_BENCHMARK_OUT?.trim();
	if (outputPath) {
		const resolved = path.isAbsolute(outputPath) ? outputPath : path.join(root, outputPath);
		fs.mkdirSync(path.dirname(resolved), { recursive: true });
		fs.writeFileSync(
			resolved,
			`${JSON.stringify(
				{
					generatedAt: new Date().toISOString(),
					candidateUrl: defaultCandidateUrl || null,
					results,
				},
				null,
				2,
			)}\n`,
		);
		console.log(`\nWrote benchmark results to ${path.relative(root, resolved)}`);
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
