import { NextResponse } from "next/server";
import type { DeployStep } from "@/app/types";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { callLLMWithFallback } from "@/lib/llmProviders";

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

	try {
		const llm = await callLLMWithFallback(prompt, {
			contextLabel: "Analyze failure",
			maxTokens: 4096,
			temperature: 0.2,
			localModelDefault: "llama3.2",
			localTimeoutMs: 20_000,
		});
		return NextResponse.json({ response: llm.text, source: "llm", model: llm.model, provider: llm.provider });
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
