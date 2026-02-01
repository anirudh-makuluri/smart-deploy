import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../auth/authOptions";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { DeployStep } from "@/app/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST - analyze deployment failure logs and suggest fixes */
export async function POST(req: Request) {
	const session = await getServerSession(authOptions);
	if (!session?.accessToken) {
		return NextResponse.json({ error: "Missing access token" }, { status: 401 });
	}

	let body: { steps: DeployStep[]; configSnapshot: Record<string, unknown> };
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const { steps, configSnapshot } = body;
	if (!Array.isArray(steps) || !configSnapshot) {
		return NextResponse.json(
			{ error: "steps (array) and configSnapshot (object) required" },
			{ status: 400 }
		);
	}

	const logsText = steps
		.map(
			(s) =>
				`[${s.label}] (${s.status})\n${(s.logs || []).map((l) => `  ${l}`).join("\n")}`
		)
		.join("\n\n");

	const configText = JSON.stringify(configSnapshot, null, 2);

	const prompt = `A deployment failed. Below are the deployment step logs and the configuration that was used.

Deployment configuration used:
${configText}

Deployment logs (by step):
${logsText}

Analyze why the deployment likely failed. In a clear, concise response:
1. Identify the most likely cause(s) of the failure (e.g. wrong command, missing env var, platform mismatch).
2. Give concrete steps the user can take to fix the issue and succeed on the next deploy (e.g. "Set build_cmd to X", "Add NODE_ENV=production to env vars").
Keep the answer practical and short (a few paragraphs at most). Use plain text, no markdown code fences.`;

	const nodeEnv = process.env.ENVIRONMENT as string | undefined;
	const isProd = nodeEnv === "production";

	try {
		const text = isProd ? await callGemini(prompt) : await callLocalLLM(prompt);
		return NextResponse.json({ response: text });
	} catch (error: unknown) {
		console.error("analyze-failure LLM error:", error);
		return NextResponse.json(
			{
				error: isProd ? "LLM request failed" : "Local LLM request failed",
				details: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 502 }
		);
	}
}

async function callGemini(prompt: string): Promise<string> {
	const geminiApiKey = process.env.GEMINI_API_KEY;
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
	const baseUrl = process.env.LOCAL_LLM_BASE_URL || "";
	if (!baseUrl) {
		throw new Error("Missing LOCAL_LLM_BASE_URL env var");
	}
	const model = process.env.LOCAL_LLM_MODEL || "llama3.2";
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
	const data = await res.json();
	const text = data.response as string;
	if (text == null) {
		throw new Error("Local LLM response missing text");
	}
	return text;
}
