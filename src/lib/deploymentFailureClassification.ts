import type {
	DeployConfig,
	DeployStep,
	DeploymentFailureCategory,
	DeploymentFailureClassification,
	DeploymentFailureCode,
	DeploymentFailureStage,
} from "@/app/types";

type FailureDefinition = {
	stage: DeploymentFailureStage;
	category: DeploymentFailureCategory;
	retryable: boolean;
	summary: string;
	likelyCause: string;
};

export type DeploymentFailureRecord = {
	code: DeploymentFailureCode;
	classification: DeploymentFailureClassification;
};

type ClassificationArgs = {
	deployConfig: DeployConfig;
	steps: DeployStep[];
	errorMessage?: string | null;
	rolledBack?: boolean;
	finalStatus?: DeployConfig["status"] | null;
};

const FAILURE_DEFINITIONS: Record<DeploymentFailureCode, FailureDefinition> = {
	AUTHENTICATION_FAILED: {
		stage: "auth",
		category: "auth_failure",
		retryable: false,
		summary: "Deployment could not authenticate with a required provider or cloud service.",
		likelyCause: "A GitHub, cloud, or registry credential is missing, expired, or does not have the required permission.",
	},
	CODEBUILD_DOCKER_IMAGE_BUILD_FAILED: {
		stage: "build",
		category: "build_failure",
		retryable: false,
		summary: "Image build failed before the release could be deployed.",
		likelyCause: "The Docker build, dependency install, or build command failed in CodeBuild.",
	},
	DEPLOYMENT_VERIFICATION_FAILED: {
		stage: "verify",
		category: "health_check_failure",
		retryable: false,
		summary: "Deployment verification failed after the app was released.",
		likelyCause: "The app did not become healthy at the expected URL or health endpoint within the verification window.",
	},
	AUTOMATIC_ROLLBACK_FAILED: {
		stage: "rollback",
		category: "rollback_failure",
		retryable: false,
		summary: "Verification failed and Smart Deploy could not complete the automatic rollback.",
		likelyCause: "A previous release existed, but restoring it or re-pointing traffic to it failed.",
	},
	AUTOMATIC_ROLLBACK_NO_CANDIDATE: {
		stage: "rollback",
		category: "rollback_failure",
		retryable: false,
		summary: "Verification failed and Smart Deploy had no usable previous release to restore.",
		likelyCause: "There is no earlier successful deployment history entry with rollback metadata for this service.",
	},
	MANUAL_ROLLBACK_FAILED: {
		stage: "rollback",
		category: "rollback_failure",
		retryable: false,
		summary: "Rollback could not restore the selected release.",
		likelyCause: "The selected rollback artifact was missing, invalid, or failed when Smart Deploy tried to redeploy it.",
	},
	INFRASTRUCTURE_NETWORK_FAILURE: {
		stage: "deploy",
		category: "infrastructure_failure",
		retryable: true,
		summary: "Deployment hit a network or infrastructure reachability problem.",
		likelyCause: "A transient connectivity issue, unreachable upstream service, or blocked network path interrupted the deployment.",
	},
	DEPLOYMENT_FAILED_GENERIC: {
		stage: "unknown",
		category: "unknown_failure",
		retryable: false,
		summary: "Deployment failed, but Smart Deploy could not match it to a more specific failure type.",
		likelyCause: "The failure did not match a known deploy error pattern and needs log review.",
	},
};

const AUTH_FAILURE_RE = /unauthorized|forbidden|bad credentials|invalid token|access denied|github token|auth(?:entication)? failed/i;
const NETWORK_FAILURE_RE = /econnrefused|connection refused|timed out|timeout|network|ehostunreach|enotfound|socket hang up/i;

function normalizeLogLine(line: string): string {
	return line.replace(/\s+/g, " ").trim();
}

function inferStageFromStepId(stepId: string | null | undefined): DeploymentFailureStage {
	switch (stepId) {
		case "clone":
		case "detect":
		case "auth":
		case "database":
		case "build":
		case "publish":
		case "setup":
		case "deploy":
		case "rollout":
		case "verify":
		case "rollback":
		case "done":
			return stepId;
		default:
			return "unknown";
	}
}

function getFailedStep(steps: DeployStep[]): DeployStep | null {
	for (let index = steps.length - 1; index >= 0; index -= 1) {
		if (steps[index]?.status === "error") {
			return steps[index];
		}
	}
	return null;
}

function collectEvidence(steps: DeployStep[], failedStep: DeployStep | null, errorMessage?: string | null): string[] {
	const evidence: string[] = [];
	if (errorMessage?.trim()) {
		evidence.push(normalizeLogLine(errorMessage));
	}

	const failedStepLogs = failedStep?.logs ?? [];
	for (let index = Math.max(0, failedStepLogs.length - 5); index < failedStepLogs.length; index += 1) {
		const line = normalizeLogLine(failedStepLogs[index] ?? "");
		if (line) {
			evidence.push(line);
		}
	}

	if (evidence.length === 0) {
		const allLogs = steps.flatMap((step) => step.logs ?? []);
		for (let index = Math.max(0, allLogs.length - 5); index < allLogs.length; index += 1) {
			const line = normalizeLogLine(allLogs[index] ?? "");
			if (line) {
				evidence.push(line);
			}
		}
	}

	return Array.from(new Set(evidence)).slice(0, 6);
}

function findFailureCode(args: {
	combinedText: string;
	failedStepId: string | null;
	errorMessage?: string | null;
	rolledBack?: boolean;
}): DeploymentFailureCode {
	const { combinedText, failedStepId, rolledBack } = args;

	if (
		/verification failed and no previous successful deployment history entry was available for rollback|automatic rollback could not run because the last successful deployment is missing release artifact metadata|automatic rollback could not reconstruct the previous deployment config|automatic rollback could not identify the release artifact type/i.test(
			combinedText
		)
	) {
		return "AUTOMATIC_ROLLBACK_NO_CANDIDATE";
	}

	if (
		/automatic rollback also failed|automatic rollback failed|automatic rollback could not restore|verification failed, and automatic rollback to/i.test(
			combinedText
		)
	) {
		return "AUTOMATIC_ROLLBACK_FAILED";
	}

	if (/rollback failed|rollback could not|could not restore the selected release|selected deployment history entry/i.test(combinedText)) {
		return "MANUAL_ROLLBACK_FAILED";
	}

	if (/docker image build failed|codebuild failed: docker image build did not succeed/i.test(combinedText)) {
		return "CODEBUILD_DOCKER_IMAGE_BUILD_FAILED";
	}

	if (/verification failed after all retry attempts|verification deadline reached before a healthy response was observed/i.test(combinedText)) {
		return rolledBack ? "DEPLOYMENT_VERIFICATION_FAILED" : "DEPLOYMENT_VERIFICATION_FAILED";
	}

	if (
		/deployment verification could not start because no reachable url was available|server is not responding on any known ports|server is not responding\. check/i.test(
			combinedText
		)
	) {
		return "DEPLOYMENT_FAILED_GENERIC";
	}

	if (AUTH_FAILURE_RE.test(combinedText) || failedStepId === "auth") {
		return "AUTHENTICATION_FAILED";
	}

	if (NETWORK_FAILURE_RE.test(combinedText) && failedStepId !== "verify") {
		return "INFRASTRUCTURE_NETWORK_FAILURE";
	}

	return "DEPLOYMENT_FAILED_GENERIC";
}

export function classifyDeploymentFailure(args: ClassificationArgs): DeploymentFailureRecord | null {
	const failedStep = getFailedStep(args.steps);
	const failedStepId = failedStep?.id ?? null;
	const combinedText = [
		args.errorMessage ?? "",
		...args.steps.flatMap((step) => step.logs ?? []),
	]
		.join("\n")
		.trim();

	if (!combinedText && !failedStepId && args.finalStatus && args.finalStatus !== "failed") {
		return null;
	}

	const code = findFailureCode({
		combinedText,
		failedStepId,
		errorMessage: args.errorMessage,
		rolledBack: args.rolledBack,
	});
	const definition = FAILURE_DEFINITIONS[code];
	const evidence = collectEvidence(args.steps, failedStep, args.errorMessage);
	const stage = definition.stage === "unknown" ? inferStageFromStepId(failedStepId) : definition.stage;
	const autoRollbackTriggered =
		Boolean(args.rolledBack) ||
		/automatic rollback|rolled back automatically/i.test(combinedText) ||
		(args.finalStatus != null && args.finalStatus !== "failed" && stage === "rollback");

	return {
		code,
		classification: {
			stage,
			category: definition.category,
			retryable: definition.retryable,
			summary: definition.summary,
			likelyCause: definition.likelyCause,
			evidence,
			failedStep: failedStepId,
			autoRollbackTriggered,
		},
	};
}

export const __testing = {
	collectEvidence,
	findFailureCode,
	inferStageFromStepId,
};
