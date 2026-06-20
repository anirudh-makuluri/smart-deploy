import { NextResponse } from "next/server";
import type { DeployStep, DeploymentHistoryEntry } from "@/app/types";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { callLLMWithFallback } from "@/lib/llmProviders";
import { dbHelper } from "@/db-helper";
import {
	deployStepsFromLogLines,
	fetchDeployRunLogsFromS3,
	type DeployStepSummary,
} from "@/lib/aws/deployRunLogs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST - analyze deployment failure logs and suggest fixes */
export async function POST(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: { runId?: string };
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const runId = String(body.runId ?? "").trim();
	if (!runId) {
		return NextResponse.json(
			{ error: "runId is required" },
			{ status: 400 }
		);
	}

	let analysisContext: { entry?: DeploymentHistoryEntry; steps?: DeployStep[], error?: string, status?: number};
	try {
		analysisContext = await fetchDeploymentRunAnalysisContext(runId, session.user.id);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Failed to load deployment run logs" },
			{ status: 500 }
		);
	}
	if (analysisContext.error || !analysisContext.entry || !analysisContext.steps) {
		return NextResponse.json({ error: analysisContext.error }, { status: analysisContext.status });
	}

	const { entry, steps } = analysisContext;

	const logsText = prioritizeDiagnosticsLogs(steps)
		.map(
			(s) =>
				`[${s.label}] (${s.status})\n${(s.logs || []).map((l) => `  ${l}`).join("\n")}`
		)
		.join("\n\n");

	const runMetadata = [
		`Deployment run ID: ${entry.id}`,
		entry.repo_name ? `Repository: ${entry.repo_name}` : "",
		entry.service_name ? `Service: ${entry.service_name}` : "",
		entry.branch ? `Branch: ${entry.branch}` : "",
		entry.commitSha ? `Commit: ${entry.commitSha}` : "",
		entry.failureCode ? `Failure code: ${entry.failureCode}` : "",
		entry.failureClassification?.summary
			? `Failure summary: ${entry.failureClassification.summary}`
			: "",
		entry.failureClassification?.likelyCause
			? `Likely cause from classifier: ${entry.failureClassification.likelyCause}`
			: "",
	]
		.filter(Boolean)
		.join("\n");

	const prompt = `A deployment failed. Below are the run details and full deployment step logs captured for that run.

Deployment run details:
${runMetadata || "No deployment metadata available."}

Deployment logs (full run, grouped by step):
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
		const fallback = buildHeuristicFailureAnalysis(steps, entry);
		return NextResponse.json({
			response: fallback,
			source: "heuristic-fallback",
			warning: error instanceof Error ? error.message : "LLM unavailable",
		});
	}
}

async function fetchDeploymentRunAnalysisContext(
	runId: string,
	userId: string
): Promise<
	{ entry?: DeploymentHistoryEntry | undefined; steps?: DeployStep[], error?: string, status?: number}
> {
	const entryResponse = await dbHelper.getDeploymentHistoryEntryById(runId, userId);
	if (entryResponse.error) {
		return { error: String(entryResponse.error), status: 500 };
	}

	const entry = entryResponse.history;
	if (!entry) {
		return { error: "Deployment run not found", status: 404 };
	}

	if (!entry.logRef) {
		return { entry, steps: entry.steps ?? [] };
	}

	const lines = await fetchDeployRunLogsFromS3({ logRef: entry.logRef });
	const stepSummary: DeployStepSummary[] = (entry.steps ?? []).map((step) => ({
		id: step.id,
		label: step.label,
		status: step.status,
		...(step.startedAt ? { startedAt: step.startedAt } : {}),
		...(step.endedAt ? { endedAt: step.endedAt } : {}),
		lineCount: step.logs?.length ?? 0,
	}));

	return {
		entry,
		steps: deployStepsFromLogLines(stepSummary, lines),
	};
}

function buildHeuristicFailureAnalysis(steps: DeployStep[], entry: DeploymentHistoryEntry): string {
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

	const topLogs = allLogs.slice(-8).map((l) => `- ${l}`).join("\n");
	const suggested = hints.slice(0, 3).map((h, i) => `${i + 1}. ${h}`).join("\n");

	return [
		"LLM providers are currently unavailable, so this is a heuristic analysis.",
		`Deployment run: ${entry.id}.`,
		`Most likely failure area: ${failedStepLabels || "unknown step"}.`,
		entry.failureCode ? `Failure code: ${entry.failureCode}.` : "",
		entry.failureClassification?.likelyCause
			? `Classifier likely cause: ${entry.failureClassification.likelyCause}.`
			: "",
		suggested || "1. Inspect the most recent error logs and retry after fixing the first concrete error.",
		topLogs ? `Recent log lines:\n${topLogs}` : "",
	].filter(Boolean).join("\n\n");
}

export function prioritizeDiagnosticsLogs(steps: DeployStep[]): DeployStep[] {
	const diagnosticBlocks = [
		{ start: "diagnostics:ecs_service:start", end: "diagnostics:ecs_service:end" },
		{ start: "diagnostics:ecs_logs:start", end: "diagnostics:ecs_logs:end" },
		{ start: "diagnostics:docker_logs:start", end: "diagnostics:docker_logs:end" },
	];

	let latestStepIndex = -1;
	let latestStartIndex = -1;
	let latestEndIndex = -1;

	for (const block of diagnosticBlocks) {
		for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
			const logs = steps[stepIndex]?.logs || [];
			for (let i = 0; i < logs.length; i++) {
				const logLine = logs[i];
				if (typeof logLine !== "string" || !logLine.includes(block.start)) continue;
				let endIndex = -1;
				for (let j = i + 1; j < logs.length; j++) {
					const endLine = logs[j];
					if (typeof endLine === "string" && endLine.includes(block.end)) {
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
	const diagnosticBlock = sourceLogs.slice(latestStartIndex, endExclusive);
	if (diagnosticBlock.length === 0) return steps;

	const withoutBlock = sourceLogs.filter((line, idx) => idx < latestStartIndex || idx >= endExclusive);
	const rebuiltStep: DeployStep = {
		...sourceStep,
		logs: [...diagnosticBlock, ...withoutBlock],
	};

	ordered.splice(latestStepIndex, 1);
	return [rebuiltStep, ...ordered];
}
