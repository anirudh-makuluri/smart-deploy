import type { DeployConfig } from "@/app/types";
import config from "@/config";
import { DEFAULT_EC2_INSTANCE_TYPE } from "@/lib/aws/ec2InstanceTypes";

export const DEFAULT_AUTO_FIX_RETRIES = 2;
export const DEFAULT_HEALTH_MONITORING_WINDOW_SEC = 300;

function parseBooleanEnv(value: string | undefined): boolean | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return undefined;
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return undefined;
}

/**
 * Global rollout guardrail for Phase 2.
 * If unset, remediation stays enabled by default.
 */
export function defaultAutoFixEnabled(): boolean {
	if (typeof process === "undefined") return true;
	const parsed =
		parseBooleanEnv(process.env.NEXT_PUBLIC_SMARTDEPLOY_PHASE2_AUTOFIX_DEFAULT) ??
		parseBooleanEnv(process.env.SMARTDEPLOY_PHASE2_AUTOFIX_DEFAULT);
	return parsed ?? true;
}

/** Used when `awsRegion` is missing on the deployment record (matches prior client defaults). */
export function defaultAwsRegionForDeploy(): string {
	const fromEnv = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_AWS_REGION?.trim() : "";
	if (fromEnv) return fromEnv;
	return (config.AWS_REGION || "us-west-2").trim() || "us-west-2";
}

function isEc2Target(deployment: DeployConfig) {
	return (deployment.deploymentTarget ?? "ec2") === "ec2";
}

function stableSerializeEc2(value: DeployConfig["ec2"]): string {
	return JSON.stringify(value ?? null);
}

/**
 * Ensures `awsRegion` and (for EC2 targets) `ec2.instanceType` are always set on the deployment object
 * so callers do not rely on scattered `|| "us-west-2"` / `|| t3.micro` fallbacks.
 */
export function withDeployInfraDefaults(deployment: DeployConfig): DeployConfig {
	const region = (deployment.awsRegion || "").trim() || defaultAwsRegionForDeploy();
	const lifecycleState = deployment.lifecycleState ?? "idle";
	const autoFixEnabled = deployment.autoFixEnabled ?? defaultAutoFixEnabled();
	const maxAutoFixRetries =
		typeof deployment.maxAutoFixRetries === "number" && Number.isFinite(deployment.maxAutoFixRetries)
			? Math.max(0, Math.floor(deployment.maxAutoFixRetries))
			: DEFAULT_AUTO_FIX_RETRIES;
	const healthMonitoringWindowSec =
		typeof deployment.healthMonitoringWindowSec === "number" && Number.isFinite(deployment.healthMonitoringWindowSec)
			? Math.max(0, Math.floor(deployment.healthMonitoringWindowSec))
			: DEFAULT_HEALTH_MONITORING_WINDOW_SEC;
	const latestHealthStatus = deployment.latestHealthStatus ?? "unknown";
	const latestHealthCheckAt = deployment.latestHealthCheckAt ?? null;
	const activeRemediationSessionId = deployment.activeRemediationSessionId ?? null;
	const activeRemediationAttemptCount =
		typeof deployment.activeRemediationAttemptCount === "number" && Number.isFinite(deployment.activeRemediationAttemptCount)
			? Math.max(0, Math.floor(deployment.activeRemediationAttemptCount))
			: 0;

	if (!isEc2Target(deployment)) {
		const next = {
			...deployment,
			awsRegion: region,
			lifecycleState,
			autoFixEnabled,
			maxAutoFixRetries,
			healthMonitoringWindowSec,
			latestHealthStatus,
			latestHealthCheckAt,
			activeRemediationSessionId,
			activeRemediationAttemptCount,
		};
		if (
			region === (deployment.awsRegion || "").trim() &&
			lifecycleState === (deployment.lifecycleState ?? "idle") &&
			autoFixEnabled === (deployment.autoFixEnabled ?? defaultAutoFixEnabled()) &&
			maxAutoFixRetries === (deployment.maxAutoFixRetries ?? DEFAULT_AUTO_FIX_RETRIES) &&
			healthMonitoringWindowSec === (deployment.healthMonitoringWindowSec ?? DEFAULT_HEALTH_MONITORING_WINDOW_SEC) &&
			latestHealthStatus === (deployment.latestHealthStatus ?? "unknown") &&
			latestHealthCheckAt === (deployment.latestHealthCheckAt ?? null) &&
			activeRemediationSessionId === (deployment.activeRemediationSessionId ?? null) &&
			activeRemediationAttemptCount === (deployment.activeRemediationAttemptCount ?? 0)
		) {
			return deployment;
		}
		return next;
	}

	const prevObj =
		deployment.ec2 && typeof deployment.ec2 === "object" && !Array.isArray(deployment.ec2)
			? { ...(deployment.ec2 as Record<string, unknown>) }
			: ({} as Record<string, unknown>);
	const nextType = String(prevObj.instanceType ?? "").trim() || DEFAULT_EC2_INSTANCE_TYPE;
	const nextEc2 = { ...prevObj, instanceType: nextType } as DeployConfig["ec2"];
	const next = {
		...deployment,
		awsRegion: region,
		ec2: nextEc2,
		lifecycleState,
		autoFixEnabled,
		maxAutoFixRetries,
		healthMonitoringWindowSec,
		latestHealthStatus,
		latestHealthCheckAt,
		activeRemediationSessionId,
		activeRemediationAttemptCount,
	};

	const ec2Equal = stableSerializeEc2(deployment.ec2) === stableSerializeEc2(nextEc2);
	if (
		region === (deployment.awsRegion || "").trim() &&
		ec2Equal &&
		lifecycleState === (deployment.lifecycleState ?? "idle") &&
		autoFixEnabled === (deployment.autoFixEnabled ?? defaultAutoFixEnabled()) &&
		maxAutoFixRetries === (deployment.maxAutoFixRetries ?? DEFAULT_AUTO_FIX_RETRIES) &&
		healthMonitoringWindowSec === (deployment.healthMonitoringWindowSec ?? DEFAULT_HEALTH_MONITORING_WINDOW_SEC) &&
		latestHealthStatus === (deployment.latestHealthStatus ?? "unknown") &&
		latestHealthCheckAt === (deployment.latestHealthCheckAt ?? null) &&
		activeRemediationSessionId === (deployment.activeRemediationSessionId ?? null) &&
		activeRemediationAttemptCount === (deployment.activeRemediationAttemptCount ?? 0)
	) {
		return deployment;
	}
	return next;
}
