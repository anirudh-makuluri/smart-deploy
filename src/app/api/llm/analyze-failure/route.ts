import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { DeployStep } from "@/app/types";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST - analyze deployment failure logs and suggest fixes */
export async function POST(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

	const logsText = prioritizeDiagnosticsLogs(steps)
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

	try {
		const text = await callLLMWithFallback(prompt);
		return NextResponse.json({ response: text, source: "llm" });
	} catch (error: unknown) {
		console.error("analyze-failure LLM error:", error);
		const fallback = buildHeuristicFailureAnalysis(steps, configSnapshot);
		return NextResponse.json({
			response: fallback,
			source: "heuristic-fallback",
			warning: error instanceof Error ? error.message : "LLM unavailable",
		});
	}
}

/** Try Gemini first; if it fails, run the same prompt on the local LLM. */
async function callLLMWithFallback(prompt: string): Promise<string> {
	const hasGemini = !!process.env.GEMINI_API_KEY?.trim();
	const hasLocal = !!process.env.LOCAL_LLM_BASE_URL?.trim();

	if (hasGemini) {
		try {
			return await callGemini(prompt);
		} catch (geminiError) {
			console.warn("Gemini failed, falling back to local LLM:", geminiError);
			if (hasLocal) {
				return await callLocalLLM(prompt);
			}
			throw geminiError;
		}
	}
	if (hasLocal) {
		return await callLocalLLM(prompt);
	}
	throw new Error("No LLM configured. Set GEMINI_API_KEY and/or LOCAL_LLM_BASE_URL.");
}

async function callGemini(prompt: string): Promise<string> {
	const geminiApiKey = process.env.GEMINI_API_KEY;
	if (!geminiApiKey?.trim()) {
		throw new Error("Missing GEMINI_API_KEY env var");
	}
	const genAI = new GoogleGenerativeAI(geminiApiKey);
	const model = genAI.getGenerativeModel({
		model: "gemini-3-flash",
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
	if (!baseUrl?.trim()) {
		throw new Error("Missing LOCAL_LLM_BASE_URL env var");
	}
	const model = process.env.LOCAL_LLM_MODEL || "llama3.2";
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 20_000);
	let res: Response;
	try {
		res = await fetch(baseUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			signal: controller.signal,
			body: JSON.stringify({
				model,
				prompt,
				stream: false,
				temperature: 0.2,
				max_tokens: 4096,
			}),
		});
	} finally {
		clearTimeout(timeout);
	}
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

function buildHeuristicFailureAnalysis(
	steps: DeployStep[],
	configSnapshot: Record<string, unknown>
): string {
	const allLogs = steps.flatMap((s) => s.logs ?? []);
	const logText = allLogs.join("\n");
	const failedSteps = steps.filter((s) => s.status === "error");
	const failedStepLabels = failedSteps.map((s) => s.label).join(", ");

	const hints: string[] = [];
	if (/econnrefused|connection refused|timed out|timeout|network/i.test(logText)) {
		hints.push("Network or upstream connectivity failed. Verify service endpoints, firewall/security group rules, and retry after confirming network reachability.");
	}
	if (/bad credentials|unauthorized|401|403|forbidden/i.test(logText)) {
		hints.push("Authentication appears invalid. Reconnect provider credentials (GitHub/cloud) and re-run deployment.");
	}
	if (/dockerfile|build failed|npm err|pnpm err|yarn err|module not found|tsc|compile/i.test(logText)) {
		hints.push("Build/runtime dependency failure detected. Verify lockfile consistency, install/build commands, and required runtime packages.");
	}
	if (/env|environment variable|missing .*key|secret/i.test(logText)) {
		hints.push("Missing or invalid environment variables are likely. Recheck required secrets and variable names in deployment configuration.");
	}
	if (failedSteps.length === 0) {
		hints.push("Deployment did not complete successfully, but no explicit error step was marked. Review the latest logs around setup/build/deploy boundaries.");
	}

	const deploymentTarget = typeof configSnapshot.deploymentTarget === "string"
		? configSnapshot.deploymentTarget
		: "unknown";

	const topLogs = allLogs.slice(-8).map((l) => `- ${l}`).join("\n");
	const suggested = hints.slice(0, 3).map((h, i) => `${i + 1}. ${h}`).join("\n");

	return [
		"LLM providers are currently unavailable, so this is a heuristic analysis.",
		`Most likely failure area: ${failedStepLabels || "unknown step"}.`,
		`Deployment target: ${deploymentTarget}.`,
		suggested || "1. Inspect the most recent error logs and retry after fixing the first concrete error.",
		topLogs ? `Recent log lines:\n${topLogs}` : "",
	].filter(Boolean).join("\n\n");
}

export function prioritizeDiagnosticsLogs(steps: DeployStep[]): DeployStep[] {
	const DIAG_START = "diagnostics:docker_logs:start";
	const DIAG_END = "diagnostics:docker_logs:end";

	let latestStepIndex = -1;
	let latestStartIndex = -1;
	let latestEndIndex = -1;

	for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
		const logs = steps[stepIndex]?.logs || [];
		for (let i = 0; i < logs.length; i++) {
			if (logs[i]?.includes(DIAG_START)) {
				let endIndex = -1;
				for (let j = i + 1; j < logs.length; j++) {
					if (logs[j]?.includes(DIAG_END)) {
						endIndex = j;
						break;
					}
				}
				latestStepIndex = stepIndex;
				latestStartIndex = i;
				latestEndIndex = endIndex;
			}
		}
	}

	if (latestStepIndex === -1 || latestStartIndex === -1) {
		return steps;
	}

	const ordered = [...steps];
	const sourceStep = ordered[latestStepIndex];
	const sourceLogs = sourceStep?.logs || [];
	const endExclusive = latestEndIndex >= latestStartIndex ? latestEndIndex + 1 : sourceLogs.length;
	const dockerDiagBlock = sourceLogs.slice(latestStartIndex, endExclusive);
	if (dockerDiagBlock.length === 0) return steps;

	const withoutBlock = sourceLogs.filter((line, idx) => idx < latestStartIndex || idx >= endExclusive);
	const rebuiltStep: DeployStep = {
		...sourceStep,
		logs: [...dockerDiagBlock, ...withoutBlock],
	};

	ordered.splice(latestStepIndex, 1);
	return [rebuiltStep, ...ordered];
}
