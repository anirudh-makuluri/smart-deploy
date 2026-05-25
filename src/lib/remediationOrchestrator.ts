import type {
	DeployConfig,
	DeploymentHealthCheck,
	DeploymentRemediationAttempt,
	DeploymentRemediationChange,
	DeployStep,
	RemediationTriggerType,
} from "@/app/types";
import { dbHelper } from "@/db-helper";
import crypto from "crypto";

type QueueRemediationAttemptArgs = {
	deployConfig: DeployConfig;
	userID?: string;
	deploymentHistoryId?: string;
	triggerType: RemediationTriggerType;
	steps?: DeployStep[];
	healthCheck?: Omit<DeploymentHealthCheck, "id"> | DeploymentHealthCheck | null;
	errorMessage?: string | null;
};

type QueueRemediationAttemptResult =
	| { status: "queued"; attempt: DeploymentRemediationAttempt }
	| { status: "exhausted"; maxRetries: number }
	| { status: "skipped"; reason: string };

function buildEvidence(steps: DeployStep[] | undefined, errorMessage?: string | null, healthCheck?: QueueRemediationAttemptArgs["healthCheck"]) {
	const evidence: string[] = [];
	if (errorMessage?.trim()) evidence.push(errorMessage.trim());
	if (healthCheck?.failure_type) {
		evidence.push(`Health failure type: ${healthCheck.failure_type}`);
	}
	if (healthCheck?.error_message?.trim()) {
		evidence.push(healthCheck.error_message.trim());
	}
	const errorStepLogs = (steps ?? [])
		.filter((step) => step.status === "error")
		.flatMap((step) => step.logs.slice(-3))
		.map((line) => line.trim())
		.filter(Boolean);
	for (const line of errorStepLogs) {
		if (!evidence.includes(line)) evidence.push(line);
	}
	return evidence.slice(0, 8);
}

function buildSummary(triggerType: RemediationTriggerType, errorMessage?: string | null, healthCheck?: QueueRemediationAttemptArgs["healthCheck"]) {
	if (triggerType === "post_deploy_unhealthy") {
		return healthCheck?.failure_type
			? `Deployment became unhealthy after success (${healthCheck.failure_type}). Smart Deploy can investigate and generate updated deployment artifacts.`
			: "Deployment became unhealthy after success. Smart Deploy can investigate and generate updated deployment artifacts.";
	}
	if (errorMessage?.trim()) {
		return `Deployment failed: ${errorMessage.trim()}. Smart Deploy can investigate and generate updated deployment artifacts.`;
	}
	return "Deployment failed. Smart Deploy can investigate and generate updated deployment artifacts.";
}

function buildPlaceholderChanges(triggerType: RemediationTriggerType): DeploymentRemediationChange[] {
	return [
		{
			title: "Analyze failure and generate revised artifacts",
			description:
				triggerType === "post_deploy_unhealthy"
					? "If you approve, Smart Deploy will analyze the unhealthy deployment, send concrete failure context to sd-artifacts, and prepare a diff for review before redeploying."
					: "If you approve, Smart Deploy will analyze the failed deployment, send concrete failure context to sd-artifacts, and prepare a diff for review before redeploying.",
			target: "generated-artifacts",
		},
	];
}

export async function queueRemediationAttempt(
	args: QueueRemediationAttemptArgs
): Promise<QueueRemediationAttemptResult> {
	const { deployConfig, userID, deploymentHistoryId, triggerType, steps, healthCheck, errorMessage } = args;
	if (!userID) return { status: "skipped", reason: "Missing userID" };
	if (!deployConfig.autoFixEnabled) return { status: "skipped", reason: "Auto-fix disabled for deployment" };

	const maxRetries =
		typeof deployConfig.maxAutoFixRetries === "number" && Number.isFinite(deployConfig.maxAutoFixRetries)
			? Math.max(0, Math.floor(deployConfig.maxAutoFixRetries))
			: 2;

	const currentAttemptCount =
		typeof deployConfig.activeRemediationAttemptCount === "number" && Number.isFinite(deployConfig.activeRemediationAttemptCount)
			? Math.max(0, Math.floor(deployConfig.activeRemediationAttemptCount))
			: 0;

	if (currentAttemptCount >= maxRetries) {
		await dbHelper.updateDeploymentRuntimeState({
			repoName: deployConfig.repoName,
			serviceName: deployConfig.serviceName,
			userID,
			lifecycleState: "remediation_exhausted",
			activeRemediationAttemptCount: currentAttemptCount,
		});
		return { status: "exhausted", maxRetries };
	}

	const sessionId = deployConfig.activeRemediationSessionId?.trim() || crypto.randomUUID();
	const attemptNumber = currentAttemptCount + 1;
	const summary = buildSummary(triggerType, errorMessage, healthCheck);
	const evidence = buildEvidence(steps, errorMessage, healthCheck);
	const rootCause = errorMessage ?? healthCheck?.error_message ?? null;

	const attemptResult = await dbHelper.addDeploymentRemediationAttempt({
		userID,
		repoName: deployConfig.repoName,
		serviceName: deployConfig.serviceName,
		deploymentHistoryId: deploymentHistoryId ?? null,
		sessionId,
		attemptNumber,
		triggerType,
		healthFailureType: healthCheck?.failure_type ?? null,
		summary,
		rootCause,
		evidence,
		riskLevel: "safe",
		confidence: null,
		filesToModify: ["generated-artifacts"],
		changes: buildPlaceholderChanges(triggerType),
		diffPreview: [],
		expectedOutcome: "Review AI-generated artifact changes and redeploy only if the diff looks correct.",
		canAutoApply: false,
		status: "proposed",
	});

	if (attemptResult.error || !attemptResult.attempt) {
		return {
			status: "skipped",
			reason: attemptResult.error || "Failed to persist remediation attempt",
		};
	}

	await dbHelper.updateDeploymentRuntimeState({
		repoName: deployConfig.repoName,
		serviceName: deployConfig.serviceName,
		userID,
		lifecycleState: "awaiting_remediation_approval",
		activeRemediationSessionId: sessionId,
		activeRemediationAttemptCount: attemptNumber,
	});

	return {
		status: "queued",
		attempt: attemptResult.attempt,
	};
}
