import type {
	DeployConfig,
	DeploymentFailureAnalysis,
	DeployStep,
	FailedArtifactScope,
} from "@/app/types";

export type ArtifactRemediationFeedbackPayload = {
	repoUrl: string;
	commitSha: string;
	packagePath?: string;
	feedback: string;
	failureSummary?: string;
	failureLogs?: string;
	failedArtifactScope?: FailedArtifactScope;
};

export function inferFailedArtifactScope(text: string): FailedArtifactScope {
	const normalized = text.toLowerCase();
	if (/nginx|upstream|proxy_pass|502|504|bad gateway/.test(normalized)) return "nginx";
	if (/dockerfile|npm err|pnpm err|yarn err|module not found|build failed|compile|tsc|pip install/.test(normalized)) {
		return "dockerfile";
	}
	if (/docker compose|docker-compose|compose|container name|port mapping|service name|depends_on/.test(normalized)) {
		return "compose";
	}
	return "general";
}

export function buildFailureLogs(deploySteps: DeployStep[] = []): string | undefined {
	const lines = deploySteps
		.flatMap((step) => (step.logs ?? []).map((log) => `${step.label}: ${log}`))
		.filter(Boolean)
		.slice(-80);
	if (lines.length === 0) return undefined;
	return lines.join("\n").slice(-12000);
}

export function buildArtifactRemediationFeedbackPayload(args: {
	deployConfig: DeployConfig;
	analysis: DeploymentFailureAnalysis;
	failureLogs?: string;
	packagePath?: string;
}): ArtifactRemediationFeedbackPayload | null {
	const { deployConfig, analysis, failureLogs, packagePath } = args;
	const commitSha =
		(deployConfig.scanResults as { commit_sha?: string } | null)?.commit_sha ??
		deployConfig.commitSha ??
		undefined;
	const repoUrl = deployConfig.url?.trim();

	if (!repoUrl || !commitSha) return null;

	const evidence = (analysis.evidence ?? [])
		.filter(Boolean)
		.map((line) => `- ${line}`)
		.join("\n");

	const feedback = [
		"Deployment remediation request for Smart Deploy generated artifacts.",
		"Only modify generated deployment artifacts managed by sd-artifacts.",
		"Do not edit application source code.",
		"Target platform: AWS EC2.",
		"Goal: fix the deployment/runtime issue and make the application URL healthy again.",
		`Failure summary: ${analysis.summary}`,
		`Likely root cause: ${analysis.rootCause}`,
		evidence ? `Evidence:\n${evidence}` : "",
		`Concrete fix instructions:\n${analysis.concreteFixInstructions}`,
		analysis.expectedOutcome ? `Expected outcome: ${analysis.expectedOutcome}` : "",
		`Focus area: ${analysis.failedArtifactScope}.`,
		"Return improved Dockerfiles, docker-compose, and/or nginx config as needed.",
	]
		.filter(Boolean)
		.join("\n\n");

	return {
		repoUrl,
		commitSha,
		packagePath: packagePath || ".",
		feedback,
		failureSummary: analysis.summary,
		failureLogs,
		failedArtifactScope: analysis.failedArtifactScope,
	};
}
