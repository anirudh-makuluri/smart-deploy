import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { auth } from "@/lib/auth";
import { getHelpContext, type HelpDocChunk } from "@/lib/helpAgentDocs";

type ChatTurn = {
	role: "user" | "assistant";
	content: string;
};

type HelpAgentResponse = {
	answer: string;
	citations: string[];
	confidence: "high" | "medium" | "low";
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

async function callGemini(prompt: string): Promise<string> {
	const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
	if (!geminiApiKey) {
		throw new Error("Missing GEMINI_API_KEY env var");
	}
	const genAI = new GoogleGenerativeAI(geminiApiKey);
	const model = genAI.getGenerativeModel({
		model: "gemini-2.5-flash",
		generationConfig: {
			temperature: 0.2,
			maxOutputTokens: 4096,
		},
	});
	const result = await model.generateContent(prompt);
	const response = await result.response;
	return response.text();
}

async function callLocalLLM(prompt: string): Promise<string> {
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
	return data.response;
}

async function callLLMWithFallback(prompt: string): Promise<string> {
	const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
	const hasLocal = Boolean(process.env.LOCAL_LLM_BASE_URL?.trim());

	if (hasGemini) {
		try {
			return await callGemini(prompt);
		} catch (error) {
			console.warn("Help agent Gemini failed; attempting local fallback", error);
			if (hasLocal) return callLocalLLM(prompt);
			throw error;
		}
	}

	if (hasLocal) {
		return callLocalLLM(prompt);
	}

	throw new Error("No help-agent model configured");
}

function buildPrompt(question: string, history: ChatTurn[], chunks: HelpDocChunk[]): string {
	const context = chunks
		.map((chunk, index) => {
			return `[${index + 1}] source=${chunk.source}; section=${chunk.section}; relevance=${(chunk.score ?? 0).toFixed(2)}\n${chunk.content}`;
		})
		.join("\n\n");

	const recentHistory = history
		.slice(-6)
		.map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
		.join("\n");

	return `You are Smart Deploy's support agent.
Your goal is to unblock the user using ONLY the provided documentation context.
If docs do not contain the answer, clearly say it is not documented yet and suggest the closest documented next step.
Do not invent commands, paths, env vars, or product behavior.
Prefer concise steps.

Return ONLY valid JSON:
{
  "answer": "string",
  "citations": ["README.md", "docs/TROUBLESHOOTING.md"],
  "confidence": "high" | "medium" | "low"
}

Rules:
- Every actionable answer must include citations from the provided sources.
- Use only source paths present in context.
- If uncertain, set confidence to "low".

CONVERSATION:
${recentHistory || "(no prior context)"}

USER QUESTION:
${question}

DOC CONTEXT:
${context}`;
}

function normalizeCitations(citations: string[], contextSources: Set<string>): string[] {
	const normalized = citations.map((citation) => citation.trim()).filter((citation) => contextSources.has(citation));
	return Array.from(new Set(normalized));
}

export async function POST(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = (await req.json()) as { question?: string; history?: ChatTurn[] };
	const question = body.question?.trim();
	const history = Array.isArray(body.history) ? body.history : [];

	if (!question) {
		return NextResponse.json({ error: "Missing question" }, { status: 400 });
	}

	const chunks = await getHelpContext(question, 6);
	if (chunks.length === 0) {
		return NextResponse.json({
			answer:
				"I couldn't find this in the current docs yet. Start with docs/TROUBLESHOOTING.md and docs/FAQ.md, and share the exact error text so I can guide you precisely.",
			citations: ["docs/TROUBLESHOOTING.md", "docs/FAQ.md"],
			confidence: "low",
		});
	}

	try {
		const prompt = buildPrompt(question, history, chunks);
		const raw = await callLLMWithFallback(prompt);
		const parsed = parseModelJson(raw);
		const contextSources = new Set(chunks.map((chunk) => chunk.source));

		if (!parsed) {
			return NextResponse.json({
				answer: raw.trim().slice(0, 2000),
				citations: Array.from(contextSources).slice(0, 3),
				confidence: "low",
			});
		}

		const citations = normalizeCitations(parsed.citations, contextSources);
		return NextResponse.json({
			answer: parsed.answer,
			citations: citations.length > 0 ? citations : [chunks[0].source],
			confidence: parsed.confidence,
		});
	} catch (error) {
		console.error("Help agent request failed:", error);
		return NextResponse.json(
			{
				answer:
					"I found relevant docs, but the help model is unavailable right now. You can still check docs/TROUBLESHOOTING.md first, then docs/FAQ.md.",
				citations: ["docs/TROUBLESHOOTING.md", "docs/FAQ.md"],
				confidence: "low",
			},
			{ status: 200 }
		);
	}
}
