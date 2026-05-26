export const deploymentStatuses = [
	"didnt_deploy",
	"deploying",
	"verifying",
	"running",
	"retrying",
	"rolling_back",
	"paused",
	"failed",
	"stopped",
] as const;

export type DeploymentStatus = (typeof deploymentStatuses)[number];

export type DeploymentStatusEvent =
	| "deploy_requested"
	| "verification_requested"
	| "deployment_succeeded"
	| "deployment_failed"
	| "rollback_requested"
	| "rollback_succeeded"
	| "pause_requested"
	| "resume_requested"
	| "stop_requested";

const deploymentStatusSet = new Set<string>(deploymentStatuses);

const deploymentStatusAliases: Record<string, DeploymentStatus> = {
	draft: "didnt_deploy",
	error: "failed",
};

const transitionMap: Record<DeploymentStatus, Partial<Record<DeploymentStatusEvent, DeploymentStatus>>> = {
	didnt_deploy: {
		deploy_requested: "deploying",
		stop_requested: "stopped",
	},
	deploying: {
		verification_requested: "verifying",
		deployment_succeeded: "running",
		deployment_failed: "failed",
		stop_requested: "stopped",
	},
	verifying: {
		deployment_succeeded: "running",
		deployment_failed: "failed",
		rollback_requested: "rolling_back",
		stop_requested: "stopped",
	},
	running: {
		deploy_requested: "deploying",
		pause_requested: "paused",
		rollback_requested: "rolling_back",
		stop_requested: "stopped",
	},
	retrying: {
		verification_requested: "verifying",
		deployment_succeeded: "running",
		deployment_failed: "failed",
		stop_requested: "stopped",
	},
	rolling_back: {
		rollback_succeeded: "running",
		deployment_failed: "failed",
		stop_requested: "stopped",
	},
	paused: {
		deploy_requested: "deploying",
		resume_requested: "running",
		rollback_requested: "rolling_back",
		stop_requested: "stopped",
	},
	failed: {
		deploy_requested: "retrying",
		rollback_requested: "rolling_back",
		stop_requested: "stopped",
	},
	stopped: {
		deploy_requested: "deploying",
	},
};

export function normalizeDeploymentStatus(
	value: string | null | undefined,
	fallback: DeploymentStatus = "didnt_deploy"
): DeploymentStatus {
	const normalized = String(value ?? "").trim().toLowerCase().replace(/-/g, "_");
	if (!normalized) return fallback;
	if (deploymentStatusSet.has(normalized)) {
		return normalized as DeploymentStatus;
	}
	return deploymentStatusAliases[normalized] ?? fallback;
}

export function resolveDeploymentStatus(args: {
	status: string | null | undefined;
	liveUrl?: string | null;
	screenshotUrl?: string | null;
}): DeploymentStatus {
	const normalized = normalizeDeploymentStatus(args.status);
	const hasStoredLiveUrl = Boolean(args.liveUrl?.trim());
	const hasPreviewEvidence = Boolean(args.screenshotUrl?.trim());

	if (normalized === "running" && !hasStoredLiveUrl && !hasPreviewEvidence) {
		return "didnt_deploy";
	}

	if (normalized === "didnt_deploy" && hasPreviewEvidence) {
		return "running";
	}

	return normalized;
}

export function transitionDeploymentStatus(
	current: string | null | undefined,
	event: DeploymentStatusEvent
): DeploymentStatus {
	const normalizedCurrent = normalizeDeploymentStatus(current);
	const next = transitionMap[normalizedCurrent][event];
	if (!next) {
		throw new Error(`Invalid deployment status transition: ${normalizedCurrent} -> ${event}`);
	}
	return next;
}

export function isDraftDeploymentStatus(status: string | null | undefined): boolean {
	return normalizeDeploymentStatus(status) === "didnt_deploy";
}

export function isLiveDeploymentStatus(status: string | null | undefined): boolean {
	return normalizeDeploymentStatus(status) === "running";
}

export function isInProgressDeploymentStatus(status: string | null | undefined): boolean {
	const normalized = normalizeDeploymentStatus(status);
	return (
		normalized === "deploying" ||
		normalized === "verifying" ||
		normalized === "retrying" ||
		normalized === "rolling_back"
	);
}

export function isProblemDeploymentStatus(status: string | null | undefined): boolean {
	const normalized = normalizeDeploymentStatus(status);
	return normalized === "failed" || normalized === "paused" || normalized === "stopped";
}

export function canManageRuntimeDeploymentStatus(status: string | null | undefined): boolean {
	const normalized = normalizeDeploymentStatus(status);
	return normalized === "running" || normalized === "paused";
}

export function getDeploymentStatusRank(status: string | null | undefined): number {
	const normalized = normalizeDeploymentStatus(status);
	if (normalized === "running") return 5;
	if (isInProgressDeploymentStatus(normalized)) return 4;
	if (normalized === "paused" || normalized === "stopped") return 3;
	if (normalized === "didnt_deploy") return 1;
	return 0;
}
