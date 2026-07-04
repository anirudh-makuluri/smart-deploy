import { describe, expect, it } from "vitest";
import { __testing as judgeTesting } from "@/lib/deploymentAgentJudge";
import type { DeploymentAgentEvalRun } from "@/lib/deploymentAgentEval";

function makeRun(overrides: Partial<DeploymentAgentEvalRun> = {}): DeploymentAgentEvalRun {
	return {
		runId: "550e8400-e29b-41d4-a716-446655440000",
		assistantMessageId: "assistant-1",
		userId: "user-1",
		conversationId: "conversation-1",
		createdAt: "2026-07-03T00:00:00.000Z",
		userMessage: "Why did my deployment fail?",
		assistantMessage: "The build failed and you should inspect the build logs.",
		outcome: "complete",
		completed: true,
		durationMs: 1300,
		promptTurnCount: 2,
		toolCallsUsed: 1,
		tokenTotal: 200,
		model: "gemini-2.5-flash",
		provider: "gemini",
		actualToolPath: "get_deployment_history",
		toolNames: ["get_deployment_history"],
		resolvedRepoName: "smart-deploy",
		resolvedServiceName: "web",
		autoIntent: "failure_diagnosis",
		expectedToolPath: "get_deployment_history -> search_docs",
		suggestedFailureMode: "too_shallow",
		toolResults: [],
		...overrides,
	};
}

describe("deploymentAgentJudge", () => {
	it("builds a prompt with the main run context", () => {
		const prompt = judgeTesting.buildJudgePrompt(makeRun());
		expect(prompt).toContain("Why did my deployment fail?");
		expect(prompt).toContain("get_deployment_history");
		expect(prompt).toContain("failure_diagnosis");
	});

	it("parses structured judge responses", () => {
		const parsed = judgeTesting.parseJudgeResponse(
			JSON.stringify({
				intent: "failure_diagnosis",
				helpfulness: "partially_helpful",
				primaryFailureMode: "too_shallow",
				expectedToolPath: "get_deployment_history -> search_docs",
				notes: "The answer identified the failing area but did not ground a fix strongly enough.",
				scores: {
					correctness: 2,
					completeness: 1,
					actionability: 1,
					toolChoice: 1,
					grounding: 2,
				},
			})
		);

		expect(parsed.helpfulness).toBe("partially_helpful");
		expect(parsed.primaryFailureMode).toBe("too_shallow");
		expect(parsed.scores.correctness).toBe(2);
	});

	it("parses fenced or wrapped JSON judge responses", () => {
		const parsed = judgeTesting.parseJudgeResponse(`
Here is the evaluation:
\`\`\`json
{
  "intent": "failure_diagnosis",
  "helpfulness": "partially_helpful",
  "primaryFailureMode": "too_shallow",
  "expectedToolPath": "get_deployment_history -> search_docs",
  "notes": "The answer is partially helpful but misses a grounded next step.",
  "scores": {
    "correctness": 2,
    "completeness": 1,
    "actionability": 1,
    "toolChoice": 1,
    "grounding": 2
  }
}
\`\`\`
`);

		expect(parsed.intent).toBe("failure_diagnosis");
		expect(parsed.helpfulness).toBe("partially_helpful");
	});
});
