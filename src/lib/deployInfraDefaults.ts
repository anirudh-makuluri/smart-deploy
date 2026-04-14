import type { DeployConfig } from "@/app/types";
import config from "@/config";
import { DEFAULT_EC2_INSTANCE_TYPE } from "@/lib/aws/ec2InstanceTypes";

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

	if (!isEc2Target(deployment)) {
		if (region === (deployment.awsRegion || "").trim()) return deployment;
		return { ...deployment, awsRegion: region };
	}

	const prevObj =
		deployment.ec2 && typeof deployment.ec2 === "object" && !Array.isArray(deployment.ec2)
			? { ...(deployment.ec2 as Record<string, unknown>) }
			: ({} as Record<string, unknown>);
	const nextType = String(prevObj.instanceType ?? "").trim() || DEFAULT_EC2_INSTANCE_TYPE;
	const nextEc2 = { ...prevObj, instanceType: nextType } as DeployConfig["ec2"];
	const next = { ...deployment, awsRegion: region, ec2: nextEc2 };

	const ec2Equal = stableSerializeEc2(deployment.ec2) === stableSerializeEc2(nextEc2);
	if (region === (deployment.awsRegion || "").trim() && ec2Equal) return deployment;
	return next;
}
