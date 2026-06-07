import type { DeployConfig } from "@/app/types";
import config from "@/config";

/** Used when `region` is missing on the deployment record (matches prior client defaults). */
export function defaultRegionForDeploy(): string {
	const fromEnv = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_AWS_REGION?.trim() : "";
	if (fromEnv) return fromEnv;
	return (config.AWS_REGION || "us-west-2").trim() || "us-west-2";
}

/** Ensures `region` is always set on the deployment object. */
export function withDeployInfraDefaults(deployment: DeployConfig): DeployConfig {
	const region = (deployment.region || "").trim() || defaultRegionForDeploy();
	if (region === (deployment.region || "").trim()) return deployment;
	return { ...deployment, region };
}
