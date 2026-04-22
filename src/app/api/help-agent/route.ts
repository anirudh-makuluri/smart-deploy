import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { auth } from "@/lib/auth";
import { getHelpContext, type HelpDocChunk } from "@/lib/helpAgentDocs";
import { dbHelper } from "@/db-helper";

type ChatTurn = {
	role: "user" | "assistant";
	content: string;
};

type HelpAgentResponse = {
	answer: string;
	citations: string[];
	confidence: "high" | "medium" | "low";
};

type LLMCallResult = {
	text: string;
	model: string;
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

async function callGemini(prompt: string): Promise<LLMCallResult> {
	const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
	if (!geminiApiKey) {
		throw new Error("Missing GEMINI_API_KEY env var");
	}
	const modelName = "gemini-2.5-flash";
	const genAI = new GoogleGenerativeAI(geminiApiKey);
	const model = genAI.getGenerativeModel({
		model: modelName,
		generationConfig: {
			temperature: 0.2,
			maxOutputTokens: 4096,
		},
	});
	const result = await model.generateContent(prompt);
	const response = await result.response;
	return {
		text: response.text(),
		model: "Gemini 2.5 Flash",
	};
}

async function callLocalLLM(prompt: string): Promise<LLMCallResult> {
	const baseUrl = process.env.LOCAL_LLM_BASE_URL?.trim();
	if (!baseUrl) {
		throw new Error("Missing LOCAL_LLM_BASE_URL env var");
	}
	const model = process.env.LOCAL_LLM_MODEL || "mistral";

	const res = await fetch(baseUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model,
			prompt,
			stream: false,
			temperature: 0.2,
			max_tokens: 4096,
		}),
	});

	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`Local LLM returned ${res.status}: ${errText.slice(0, 200)}`);
	}

	const data = (await res.json()) as { response?: string };
	if (!data.response) throw new Error("Local LLM response missing text");
	return {
		text: data.response,
		model: model,
	};
}

function bedrockModelIdToLabel(modelId: string): string {
	const normalized = modelId.toLowerCase();
	if (normalized.includes("haiku-4")) return "Claude Haiku 4.0";
	if (normalized.includes("sonnet-4")) return "Claude Sonnet 4.0";
	if (normalized.includes("opus-4")) return "Claude Opus 4";
	return modelId;
}

async function callBedrock(prompt: string): Promise<LLMCallResult> {
	const region = process.env.AWS_REGION || "us-west-2";
	const accessKeyId = process.env.AWS_BEDROCK_ACCESS_KEY_ID;
	const secretAccessKey = process.env.AWS_BEDROCK_SECRET_ACCESS_KEY;

	if (!accessKeyId || !secretAccessKey) {
		throw new Error(
			"Missing AWS Bedrock credentials (AWS_BEDROCK_ACCESS_KEY_ID and AWS_BEDROCK_SECRET_ACCESS_KEY)"
		);
	}

	const client = new BedrockRuntimeClient({
		region,
		credentials: {
			accessKeyId,
			secretAccessKey,
		},
	});

	const modelId = process.env.BEDROCK_MODEL_ID || "anthropic.claude-haiku-4-0-v1:0";
	const command = new InvokeModelCommand({
		modelId,
		contentType: "application/json",
		accept: "application/json",
		body: JSON.stringify({
			anthropic_version: "bedrock-2023-05-31",
			max_tokens: 4096,
			temperature: 0.2,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: prompt,
						},
					],
				},
			],
		}),
	});

	const response = await client.send(command);
	const responseBody = JSON.parse(new TextDecoder().decode(response.body));
	const text = responseBody?.content?.[0]?.text;
	if (typeof text !== "string" || !text.trim()) {
		throw new Error("Invalid response from Bedrock API");
	}

	return {
		text,
		model: bedrockModelIdToLabel(modelId),
	};
}

async function callLLMWithFallback(prompt: string): Promise<LLMCallResult> {
	const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
	const hasBedrock = Boolean(
		process.env.AWS_BEDROCK_ACCESS_KEY_ID?.trim() &&
			process.env.AWS_BEDROCK_SECRET_ACCESS_KEY?.trim()
	);
	const hasLocal = Boolean(process.env.LOCAL_LLM_BASE_URL?.trim());

	if (hasGemini) {
		try {
			return await callGemini(prompt);
		} catch (error) {
			console.warn("Help agent Gemini failed; attempting Bedrock fallback", error);
			if (hasBedrock) {
				try {
					return await callBedrock(prompt);
				} catch (bedrockError) {
					console.warn("Help agent Bedrock fallback failed; attempting local fallback", bedrockError);
					if (hasLocal) return callLocalLLM(prompt);
					throw bedrockError;
				}
			}
			if (hasLocal) return callLocalLLM(prompt);
			throw error;
		}
	}

	if (hasBedrock) {
		try {
			return await callBedrock(prompt);
		} catch (error) {
			console.warn("Help agent Bedrock failed; attempting local fallback", error);
			if (hasLocal) return callLocalLLM(prompt);
			throw error;
		}
	}

	if (hasLocal) {
		return callLocalLLM(prompt);
	}

	throw new Error(
		"No help-agent model configured (set GEMINI_API_KEY and/or AWS_BEDROCK_ACCESS_KEY_ID + AWS_BEDROCK_SECRET_ACCESS_KEY and/or LOCAL_LLM_BASE_URL)"
	);
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

	const [chunks, recentDeployments] = await Promise.all([
		getHelpContext(question, 6),
		getRecentDeploymentSummaries(session.user.id, 4),
	]);

	if (chunks.length === 0 && recentDeployments.length === 0) {
		return NextResponse.json({
			answer:
				"I couldn't find this in the current docs yet. Start with docs/TROUBLESHOOTING.md and docs/FAQ.md, and share the exact error text so I can guide you precisely.",
			citations: ["docs/TROUBLESHOOTING.md", "docs/FAQ.md"],
			confidence: "low",
			responseTimeMs: Date.now() - startedAt,
		});
	}

	try {
		const prompt = buildPrompt(question, history, chunks, recentDeployments);
		const llm = await callLLMWithFallback(prompt);
		const parsed = parseModelJson(llm.text);
		const contextSources = new Set(chunks.map((chunk) => chunk.source));

		if (!parsed) {
			return NextResponse.json({
				answer: llm.text.trim().slice(0, 2000),
				citations: preferredDocFallback(contextSources),
				confidence: "low",
				model: llm.model,
				responseTimeMs: Date.now() - startedAt,
			});
		}

		const citations = normalizeCitations(parsed.citations, contextSources);
		return NextResponse.json({
			answer: parsed.answer,
			citations: citations.length > 0 ? citations : preferredDocFallback(contextSources),
			confidence: parsed.confidence,
			model: llm.model,
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
				responseTimeMs: Date.now() - startedAt,
			},
			{ status: 200 }
		);
	}
}
