import { NextResponse } from "next/server";
import type {
	DeploymentFailureAnalysis,
	DeploymentHealthCheck,
	DeployStep,
	FailedArtifactScope,
} from "@/app/types";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { callLLMWithFallback } from "@/lib/llmProviders";
import { inferFailedArtifactScope } from "@/lib/remediationFeedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST - analyze deployment failure logs and suggest fixes */
export async function POST(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: {
		steps: DeployStep[];
		configSnapshot: Record<string, unknown>;
		healthCheck?: Omit<DeploymentHealthCheck, "id"> | DeploymentHealthCheck | null;
		deployError?: string | null;
	};
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const { steps, configSnapshot, healthCheck, deployError } = body;
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
	const healthText = healthCheck
		? JSON.stringify(
			{
				status: healthCheck.status,
				failure_type: healthCheck.failure_type ?? null,
				error_message: healthCheck.error_message ?? null,
				http_status: healthCheck.http_status ?? null,
				url: healthCheck.url,
			},
			null,
			2
		)
		: "none";

	const prompt = `A deployment failed or became unhealthy after deploy. Below are the deployment step logs and the configuration that was used.

Deployment configuration used:
${configText}

Reported deployment error:
${deployError || "none"}

Latest health result:
${healthText}

Deployment logs (by step):
${logsText}

Analyze why the deployment likely failed. Return strict JSON with exactly these keys:
{
  "summary": string,
  "rootCause": string,
  "concreteFixInstructions": string,
  "evidence": string[],
  "failedArtifactScope": "dockerfile" | "nginx" | "compose" | "general",
  "expectedOutcome": string
}

Rules:
- Be concrete and practical.
- Focus on infra/deployment artifacts and runtime wiring, not application source code changes.
- evidence must be 1 to 5 short strings drawn from the logs or health results.
- failedArtifactScope should identify which generated artifact area most likely needs changes.
- Do not wrap the JSON in markdown fences.`;

	try {
		const llm = await callLLMWithFallback(prompt, {
			contextLabel: "Analyze failure",
			maxTokens: 4096,
			temperature: 0.2,
			localModelDefault: "llama3.2",
			localTimeoutMs: 20_000,
		});
		const analysis = parseFailureAnalysis(llm.text, steps, configSnapshot, healthCheck, deployError);
		return NextResponse.json({
			response: formatFailureAnalysisText(analysis),
			analysis,
			source: "llm",
			model: llm.model,
			provider: llm.provider,
		});
	} catch (error: unknown) {
		console.error("analyze-failure LLM error:", error);
		const analysis = buildHeuristicFailureAnalysis(steps, configSnapshot, healthCheck, deployError);
		return NextResponse.json({
			response: formatFailureAnalysisText(analysis),
			analysis,
			source: "heuristic-fallback",
			warning: error instanceof Error ? error.message : "LLM unavailable",
		});
	}
}

function parseLooseJson(raw: string): unknown {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		const firstBrace = trimmed.indexOf("{");
		const lastBrace = trimmed.lastIndexOf("}");
		if (firstBrace >= 0 && lastBrace > firstBrace) {
			return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
		}
		throw new Error("Invalid JSON payload");
	}
}

function normalizeEvidence(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.slice(0, 5);
}

function normalizeFailedArtifactScope(value: unknown, fallbackText: string): FailedArtifactScope {
	if (value === "dockerfile" || value === "nginx" || value === "compose" || value === "general") {
		return value;
	}
	return inferFailedArtifactScope(fallbackText);
}

function parseFailureAnalysis(
	rawText: string,
	steps: DeployStep[],
	configSnapshot: Record<string, unknown>,
	healthCheck?: Omit<DeploymentHealthCheck, "id"> | DeploymentHealthCheck | null,
	deployError?: string | null,
): DeploymentFailureAnalysis {
	try {
		const parsed = parseLooseJson(rawText);
		if (!parsed || typeof parsed !== "object") {
			throw new Error("Parsed analysis is not an object");
		}
		const record = parsed as Record<string, unknown>;
		const fallback = buildHeuristicFailureAnalysis(steps, configSnapshot, healthCheck, deployError);
		return {
			summary: typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : fallback.summary,
			rootCause: typeof record.rootCause === "string" && record.rootCause.trim() ? record.rootCause.trim() : fallback.rootCause,
			concreteFixInstructions:
				typeof record.concreteFixInstructions === "string" && record.concreteFixInstructions.trim()
					? record.concreteFixInstructions.trim()
					: fallback.concreteFixInstructions,
			evidence: normalizeEvidence(record.evidence).length > 0 ? normalizeEvidence(record.evidence) : fallback.evidence,
			failedArtifactScope: normalizeFailedArtifactScope(
				record.failedArtifactScope,
				[
					String(record.summary ?? ""),
					String(record.rootCause ?? ""),
					String(record.concreteFixInstructions ?? ""),
					...normalizeEvidence(record.evidence),
				].join("\n")
			),
			expectedOutcome:
				typeof record.expectedOutcome === "string" && record.expectedOutcome.trim()
					? record.expectedOutcome.trim()
					: fallback.expectedOutcome ?? null,
		};
	} catch {
		return buildHeuristicFailureAnalysis(steps, configSnapshot, healthCheck, deployError);
	}
}

function formatFailureAnalysisText(analysis: DeploymentFailureAnalysis): string {
	return [
		analysis.summary,
		`Likely root cause: ${analysis.rootCause}`,
		analysis.evidence.length > 0 ? `Evidence:\n${analysis.evidence.map((line) => `- ${line}`).join("\n")}` : "",
		`Concrete fix instructions: ${analysis.concreteFixInstructions}`,
		analysis.expectedOutcome ? `Expected outcome: ${analysis.expectedOutcome}` : "",
	].filter(Boolean).join("\n\n");
}

function buildHeuristicFailureAnalysis(
	steps: DeployStep[],
	configSnapshot: Record<string, unknown>,
	healthCheck?: Omit<DeploymentHealthCheck, "id"> | DeploymentHealthCheck | null,
	deployError?: string | null,
): DeploymentFailureAnalysis {
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

	const evidence = [
		deployError?.trim() || null,
		healthCheck?.failure_type ? `Health failure type: ${healthCheck.failure_type}` : null,
		healthCheck?.error_message?.trim() || null,
		...allLogs.slice(-3).map((line) => line.trim()),
	].filter((value): value is string => Boolean(value)).slice(0, 5);
	const concreteFixInstructions = hints.slice(0, 3).join(" ");
	const scopeSource = [logText, deployError, healthCheck?.error_message, healthCheck?.failure_type].filter(Boolean).join("\n");

	return {
		summary: "LLM providers are currently unavailable, so Smart Deploy prepared a heuristic failure analysis.",
		rootCause: `Most likely failure area: ${failedStepLabels || "unknown step"} on ${deploymentTarget}.`,
		concreteFixInstructions:
			concreteFixInstructions ||
			"Inspect the most recent failing logs, adjust the generated deployment artifacts for the failing step, and retry the deployment.",
		evidence: evidence.length > 0 ? evidence : ["No concrete diagnostic lines were available in the most recent deploy logs."],
		failedArtifactScope: inferFailedArtifactScope(scopeSource),
		expectedOutcome: "Updated generated deployment artifacts should produce a healthy deployment on the next retry.",
	};
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
