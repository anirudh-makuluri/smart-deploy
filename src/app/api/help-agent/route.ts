import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getHelpContext, type HelpDocChunk } from "@/lib/helpAgentDocs";
import { getMossHelpContextWithMetrics } from "@/lib/helpAgentMoss";
import { dbHelper } from "@/db-helper";
import { callLLMWithFallback, type LLMFallbackResult } from "@/lib/llmProviders";

type ChatTurn = {
	role: "user" | "assistant";
	content: string;
};

type HelpAgentResponse = {
	answer: string;
	citations: string[];
	confidence: "high" | "medium" | "low";
};

type RecentDeploymentSummary = {
	repoName: string;
	serviceName: string;
	timestamp: string;
	success: boolean;
	branch: string | null;
	commitSha: string | null;
	deploymentTarget: string | null;
	failedStep: string | null;
	errorLogs: string[];
};

const JSON_FENCE_REGEX = /```(?:json)?\s*([\s\S]*?)```/i;

function parseModelJson(raw: string): HelpAgentResponse | null {
	const fenced = JSON_FENCE_REGEX.exec(raw);
	const candidate = (fenced?.[1] ?? raw).trim();
	try {
		const parsed = JSON.parse(candidate) as Partial<HelpAgentResponse>;
		if (typeof parsed.answer !== "string" || parsed.answer.trim().length === 0) return null;
		const confidence =
			parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
				? parsed.confidence
				: "low";
		const citations = Array.isArray(parsed.citations)
			? parsed.citations.filter((citation): citation is string => typeof citation === "string")
			: [];
		return {
			answer: parsed.answer.trim(),
			citations,
			confidence,
		};
	} catch {
		return null;
	}
}

async function callHelpAgentLLM(prompt: string): Promise<LLMFallbackResult> {
	return callLLMWithFallback(prompt, {
		contextLabel: "Help agent",
		maxTokens: 4096,
		temperature: 0.2,
		localModelDefault: "mistral",
	});
}

function summarizeRecentLogs(logs: string[], maxLines = 4): string[] {
	const trimmed = logs
		.map((line) => String(line || "").trim())
		.filter((line) => line.length > 0);
	if (trimmed.length === 0) return [];
	return trimmed.slice(-maxLines);
}

async function getRecentDeploymentSummaries(userID: string, limit = 4): Promise<RecentDeploymentSummary[]> {
	const result = await dbHelper.getAllDeploymentHistory(userID, 1, 12);
	if (result.error || !result.history || result.history.length === 0) return [];

	const summarized = result.history
		.slice(0, 12)
		.map((entry) => {
			const failedStep = (entry.steps || []).find((step) => step.status === "error") || null;
			const stepLogs = failedStep?.logs || [];
			const fallbackLogs = (entry.steps || []).flatMap((step) => step.logs || []);
			const configTarget = entry.configSnapshot?.deploymentTarget;
			return {
				repoName: entry.repo_name,
				serviceName: entry.service_name,
				timestamp: entry.timestamp,
				success: entry.success,
				branch: entry.branch ?? null,
				commitSha: entry.commitSha ?? null,
				deploymentTarget: typeof configTarget === "string" ? configTarget : null,
				failedStep: failedStep?.label ?? failedStep?.id ?? null,
				errorLogs: summarizeRecentLogs(stepLogs.length > 0 ? stepLogs : fallbackLogs),
			};
		});

	const failures = summarized.filter((entry) => !entry.success);
	const successes = summarized.filter((entry) => entry.success);
	return [...failures, ...successes].slice(0, limit);
}

function buildDeploymentContext(deployments: RecentDeploymentSummary[]): string {
	if (deployments.length === 0) return "No recent deployment history available.";

	return deployments
		.map((deployment, index) => {
			const status = deployment.success ? "success" : "failed";
			const logs = deployment.errorLogs.length > 0
				? deployment.errorLogs.map((line) => `  - ${line}`).join("\n")
				: "  - (no logs captured)";
			return [
				`[DEPLOYMENT ${index + 1}] ${status}`,
				`repo=${deployment.repoName}; service=${deployment.serviceName}; timestamp=${deployment.timestamp}`,
				`branch=${deployment.branch ?? "unknown"}; commit=${deployment.commitSha ?? "unknown"}; target=${deployment.deploymentTarget ?? "unknown"}`,
				`failed_step=${deployment.failedStep ?? "n/a"}`,
				"recent_logs:",
				logs,
			].join("\n");
		})
		.join("\n\n");
}


function buildPrompt(
	question: string,
	history: ChatTurn[],
	chunks: HelpDocChunk[],
	recentDeployments: RecentDeploymentSummary[]
): string {
	const context = chunks
		.map((chunk, index) => {
			return `[${index + 1}] source=${chunk.source}; section=${chunk.section}; relevance=${(chunk.score ?? 0).toFixed(2)}\n${chunk.content}`;
		})
		.join("\n\n");
	const deploymentContext = buildDeploymentContext(recentDeployments);

	const recentHistory = history
		.slice(-6)
		.map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
		.join("\n");

	return `You are Smart Deploy's support agent.
Your goal is to unblock the user using the provided documentation context and the user's recent deployment history.
If docs and deployment history do not contain the answer, clearly say what is missing and suggest the closest safe next step.
Do not invent commands, paths, env vars, statuses, timestamps, or product behavior.
If deployment history includes failure evidence, prioritize explaining the likely cause from that evidence first.
Prefer concise steps.

Return ONLY valid JSON:
{
  "answer": "string",
	"citations": ["docs/TROUBLESHOOTING.md", "docs/FAQ.md"],
  "confidence": "high" | "medium" | "low"
}

Rules:
- Cite docs when you use documentation guidance.
- Use only source paths present in DOC CONTEXT.
- If uncertain, set confidence to "low".

CONVERSATION:
${recentHistory || "(no prior context)"}

USER QUESTION:
${question}

RECENT DEPLOYMENT HISTORY CONTEXT:
${deploymentContext}

DOC CONTEXT:
${context || "(no matching docs found for this question)"}`;
}

function normalizeCitations(citations: string[], contextSources: Set<string>): string[] {
	const normalized = citations
		.map((citation) => citation.trim())
		.filter((citation) => citation !== "README.md")
		.filter((citation) => contextSources.has(citation));
	return Array.from(new Set(normalized));
}

function preferredDocFallback(contextSources: Set<string>): string[] {
	const all = Array.from(contextSources);
	const withoutReadme = all.filter((source) => source !== "README.md");
	const preferred = withoutReadme.length > 0 ? withoutReadme : all;
	return preferred.slice(0, 3);
}

function mergeChunks(primary: HelpDocChunk[], secondary: HelpDocChunk[], limit = 8): HelpDocChunk[] {
	const merged = [...primary, ...secondary];
	const seen = new Set<string>();
	const deduped: HelpDocChunk[] = [];

	for (const chunk of merged) {
		const key = `${chunk.source}::${chunk.section}::${chunk.content.slice(0, 120)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(chunk);
		if (deduped.length >= limit) break;
	}

	return deduped;
}

export async function POST(req: Request) {
	const startedAt = Date.now();
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) {
		return NextResponse.json({ error: "Unauthorized", responseTimeMs: Date.now() - startedAt }, { status: 401 });
	}

	const body = (await req.json()) as { question?: string; history?: ChatTurn[] };
	const question = body.question?.trim();
	const history = Array.isArray(body.history) ? body.history : [];

	if (!question) {
		return NextResponse.json({ error: "Missing question", responseTimeMs: Date.now() - startedAt }, { status: 400 });
	}

	const [deterministicChunks, mossContext, recentDeployments] = await Promise.all([
		getHelpContext(question, 6),
		getMossHelpContextWithMetrics(question, 4),
		getRecentDeploymentSummaries(session.user.id, 4),
	]);
	const mossChunks = mossContext.chunks;
	const chunks = mergeChunks(deterministicChunks, mossChunks, 8);

	if (chunks.length === 0 && recentDeployments.length === 0) {
		return NextResponse.json({
			answer:
				"I couldn't find this in the current docs yet. Start with docs/TROUBLESHOOTING.md and docs/FAQ.md, and share the exact error text so I can guide you precisely.",
			citations: ["docs/TROUBLESHOOTING.md", "docs/FAQ.md"],
			confidence: "low",
			mossRetrievalMs: mossContext.mossRetrievalMs,
			responseTimeMs: Date.now() - startedAt,
		});
	}

	try {
		const prompt = buildPrompt(question, history, chunks, recentDeployments);
		const llm = await callHelpAgentLLM(prompt);
		const parsed = parseModelJson(llm.text);
		const contextSources = new Set(chunks.map((chunk) => chunk.source));

		if (!parsed) {
			return NextResponse.json({
				answer: llm.text.trim().slice(0, 2000),
				citations: preferredDocFallback(contextSources),
				confidence: "low",
				model: llm.model,
				mossRetrievalMs: mossContext.mossRetrievalMs,
				responseTimeMs: Date.now() - startedAt,
			});
		}

		const citations = normalizeCitations(parsed.citations, contextSources);
		return NextResponse.json({
			answer: parsed.answer,
			citations: citations.length > 0 ? citations : preferredDocFallback(contextSources),
			confidence: parsed.confidence,
			model: llm.model,
			mossRetrievalMs: mossContext.mossRetrievalMs,
			responseTimeMs: Date.now() - startedAt,
		});
	} catch (error) {
		console.error("Help agent request failed:", error);
		return NextResponse.json(
			{
				answer:
					"I found relevant docs, but the help model is unavailable right now. You can still check docs/TROUBLESHOOTING.md first, then docs/FAQ.md.",
				citations: ["docs/TROUBLESHOOTING.md", "docs/FAQ.md"],
				confidence: "low",
				mossRetrievalMs: mossContext.mossRetrievalMs,
				responseTimeMs: Date.now() - startedAt,
			},
			{ status: 200 }
		);
	}
}
