import type { DeploymentHealthCheck, DeploymentHistoryEntry, DeploymentRemediationAttempt } from "@/app/types";

export type DeploymentHistoryPhase2Badge = {
	label: string;
	tone: "default" | "success" | "warning" | "danger";
};

export type DeploymentHistoryPhase2Summary = {
	primaryLabel: string | null;
	primaryTone: DeploymentHistoryPhase2Badge["tone"];
	badges: DeploymentHistoryPhase2Badge[];
	latestAttempt: DeploymentRemediationAttempt | null;
	latestHealthCheck: DeploymentHealthCheck | null;
	retryExhausted: boolean;
	healthCheckCount: number;
};

function hasRetryExhaustedLog(entry: Pick<DeploymentHistoryEntry, "steps">) {
	return (entry.steps ?? []).some((step) =>
		(step.logs ?? []).some((line) => /remediation retry limit reached/i.test(line))
	);
}

function formatHealthStatus(status: string | null | undefined) {
	if (!status) return "unknown";
	return status.replace(/_/g, " ");
}

export function summarizeDeploymentHistoryPhase2(entry: DeploymentHistoryEntry): DeploymentHistoryPhase2Summary {
	const remediationAttempts = entry.remediationAttempts ?? [];
	const healthChecks = entry.healthChecks ?? [];
	const latestAttempt = remediationAttempts.at(-1) ?? null;
	const latestHealthCheck = healthChecks.at(-1) ?? null;
	const retryExhausted = hasRetryExhaustedLog(entry);
	const badges: DeploymentHistoryPhase2Badge[] = [];

	if (healthChecks.length > 0) {
		badges.push({
			label: `${healthChecks.length} health check${healthChecks.length === 1 ? "" : "s"}`,
			tone: latestHealthCheck?.status === "healthy" ? "success" : "warning",
		});
	}

	if (remediationAttempts.length > 0) {
		badges.push({
			label: `${remediationAttempts.length} remediation attempt${remediationAttempts.length === 1 ? "" : "s"}`,
			tone: latestAttempt?.status === "rejected" ? "warning" : "default",
		});
	}

	if (retryExhausted) {
		badges.push({ label: "Retry limit reached", tone: "danger" });
	}

	if (latestAttempt?.status === "rejected") {
		return {
			primaryLabel: "Retry rejected by user",
			primaryTone: "warning",
			badges,
			latestAttempt,
			latestHealthCheck,
			retryExhausted,
			healthCheckCount: healthChecks.length,
		};
	}

	if (retryExhausted) {
		return {
			primaryLabel: "Retry limit reached",
			primaryTone: "danger",
			badges,
			latestAttempt,
			latestHealthCheck,
			retryExhausted,
			healthCheckCount: healthChecks.length,
		};
	}

	if (remediationAttempts.some((attempt) => attempt.trigger_type === "post_deploy_unhealthy")) {
		return {
			primaryLabel: "Monitoring detected a runtime issue",
			primaryTone: latestHealthCheck?.status === "healthy" ? "default" : "warning",
			badges,
			latestAttempt,
			latestHealthCheck,
			retryExhausted,
			healthCheckCount: healthChecks.length,
		};
	}

	if (latestAttempt?.approved_by_user || latestAttempt?.status === "approved" || latestAttempt?.applied) {
		return {
			primaryLabel: "Approved remediation retried this deployment",
			primaryTone: "default",
			badges,
			latestAttempt,
			latestHealthCheck,
			retryExhausted,
			healthCheckCount: healthChecks.length,
		};
	}

	if (latestAttempt) {
		return {
			primaryLabel:
				latestAttempt.trigger_type === "deploy_failure"
					? "Original deploy failure triggered remediation"
					: "Runtime health issue triggered remediation",
			primaryTone: "default",
			badges,
			latestAttempt,
			latestHealthCheck,
			retryExhausted,
			healthCheckCount: healthChecks.length,
		};
	}

	if (latestHealthCheck) {
		return {
			primaryLabel:
				latestHealthCheck.status === "healthy"
					? "Post-deploy monitoring stayed healthy"
					: `Latest health status: ${formatHealthStatus(latestHealthCheck.status)}`,
			primaryTone: latestHealthCheck.status === "healthy" ? "success" : "warning",
			badges,
			latestAttempt,
			latestHealthCheck,
			retryExhausted,
			healthCheckCount: healthChecks.length,
		};
	}

	return {
		primaryLabel: null,
		primaryTone: "default",
		badges,
		latestAttempt,
		latestHealthCheck,
		retryExhausted,
		healthCheckCount: 0,
	};
}
