import { z } from "zod";
import {
	callLLMWithFallback,
	type LLMFallbackResult,
} from "@/lib/llmProviders";
import { JSON_FENCE_REGEX } from "@/lib/deploymentAgent/constants";
import {
	DEPLOYMENT_AGENT_EVAL_FAILURE_MODES,
	DEPLOYMENT_AGENT_EVAL_HELPFULNESS,
	DEPLOYMENT_AGENT_EVAL_INTENTS,
	type DeploymentAgentEvalJudgeResult,
	type DeploymentAgentEvalRun,
} from "@/lib/deploymentAgentEval";

const JudgeSchema = z.object({
	intent: z.enum(DEPLOYMENT_AGENT_EVAL_INTENTS),
	helpfulness: z.enum(DEPLOYMENT_AGENT_EVAL_HELPFULNESS),
	primaryFailureMode: z.enum(DEPLOYMENT_AGENT_EVAL_FAILURE_MODES).nullable(),
	expectedToolPath: z.string().trim().min(1),
	notes: z.string().trim().min(1),
	scores: z.object({
		correctness: z.number().int().min(0).max(2),
		completeness: z.number().int().min(0).max(2),
		actionability: z.number().int().min(0).max(2),
		toolChoice: z.number().int().min(0).max(2),
		grounding: z.number().int().min(0).max(2),
	}),
});

function extractBalancedJsonObject(raw: string): string | null {
	const start = raw.indexOf("{");
	if (start === -1) {
		return null;
	}

	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let index = start; index < raw.length; index += 1) {
		const character = raw[index];
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === "\\") {
				escaped = true;
				continue;
			}
			if (character === '"') {
				inString = false;
			}
			continue;
		}

		if (character === '"') {
			inString = true;
			continue;
		}
		if (character === "{") {
			depth += 1;
			continue;
		}
		if (character === "}") {
			depth -= 1;
			if (depth === 0) {
				return raw.slice(start, index + 1);
			}
		}
	}

	return null;
}

function candidateJsonStrings(raw: string): string[] {
	const trimmed = raw.trim();
	const candidates: string[] = [];
	const seen = new Set<string>();

	const addCandidate = (value: string | null | undefined) => {
		const candidate = value?.trim();
		if (!candidate || seen.has(candidate)) {
			return;
		}
		seen.add(candidate);
		candidates.push(candidate);
	};

	const fenced = JSON_FENCE_REGEX.exec(trimmed);
	addCandidate(fenced?.[1]);
	addCandidate(extractBalancedJsonObject(trimmed));
	addCandidate(trimmed);

	return candidates;
}

function buildJudgePrompt(run: DeploymentAgentEvalRun): string {
	return `You are evaluating a deployment support agent response.

Judge only from the evidence provided below. Do not invent missing facts. Be strict but fair.

Scoring rubric:
- correctness: 0-2
- completeness: 0-2
- actionability: 0-2
- toolChoice: 0-2
- grounding: 0-2

Allowed intent values:
${DEPLOYMENT_AGENT_EVAL_INTENTS.join(", ")}

Allowed helpfulness values:
${DEPLOYMENT_AGENT_EVAL_HELPFULNESS.join(", ")}

Allowed primaryFailureMode values:
${DEPLOYMENT_AGENT_EVAL_FAILURE_MODES.join(", ")}

Return only a single JSON object with this shape:
{
  "intent": "overview | current_status | runtime_health | failure_diagnosis | docs_howto | ambiguous_lookup",
  "helpfulness": "helpful | partially_helpful | not_helpful",
  "primaryFailureMode": "wrong_answer | too_shallow | missing_tool | tool_limit | clarification_needed | out_of_scope | null",
  "expectedToolPath": "string",
  "notes": "short explanation",
  "scores": {
    "correctness": 0,
    "completeness": 0,
    "actionability": 0,
    "toolChoice": 0,
    "grounding": 0
  }
}

Run metadata:
- autoIntent: ${run.autoIntent}
- expectedToolPath: ${run.expectedToolPath}
- actualToolPath: ${run.actualToolPath || "direct answer"}
- outcome: ${run.outcome ?? "unknown"}
- toolCallsUsed: ${run.toolCallsUsed}
- promptTurnCount: ${run.promptTurnCount ?? "unknown"}
- repoName: ${run.resolvedRepoName ?? "unknown"}
- serviceName: ${run.resolvedServiceName ?? "unknown"}

User message:
${run.userMessage || "(missing)"}

Assistant answer:
${run.assistantMessage}

Tool results:
${JSON.stringify(run.toolResults, null, 2)}
`;
}

function parseJudgeResponse(text: string): DeploymentAgentEvalJudgeResult {
	for (const candidate of candidateJsonStrings(text)) {
		try {
			const parsed = JSON.parse(candidate) as unknown;
			return JudgeSchema.parse(parsed);
		} catch {
			continue;
		}
	}

	throw new Error("Deployment agent judge returned invalid JSON");
}

export async function judgeDeploymentAgentRun(args: {
	run: DeploymentAgentEvalRun;
}): Promise<DeploymentAgentEvalJudgeResult & Pick<LLMFallbackResult, "model" | "provider">> {
	const llm = await callLLMWithFallback(buildJudgePrompt(args.run), {
		contextLabel: "Deployment agent judge",
		maxTokens: 1200,
		temperature: 0.1,
		localModelDefault: "mistral",
		responseMimeType: "application/json",
	});

	const result = parseJudgeResponse(llm.text);
	return {
		...result,
		model: llm.model,
		provider: llm.provider,
	};
}

export const __testing = {
	buildJudgePrompt,
	parseJudgeResponse,
};
