import type { CloudResources, EcsCloudResources, StaticS3CloudResources } from "@/app/types";
import type { DeployResult } from "@/lib/deployResult";
import config from "@/config";

export function isEcsCloudResources(
	resources: CloudResources | null | undefined
): resources is EcsCloudResources {
	return Boolean(resources && resources.target === "ecs");
}

export function isStaticS3CloudResources(
	resources: CloudResources | null | undefined
): resources is StaticS3CloudResources {
	return Boolean(resources && resources.target === "static_s3");
}

export function buildEcsCloudResources(params: {
	region: string;
	cluster: string;
	service: string;
	baseUrl: string;
	albDnsName?: string;
	albListenerArn?: string;
	targetGroupArn?: string;
	taskDefinitionArn?: string;
	logGroup?: string;
	vpcId?: string;
}): EcsCloudResources {
	return {
		target: "ecs",
		region: params.region,
		cluster: params.cluster,
		service: params.service,
		baseUrl: params.baseUrl,
		...(params.albDnsName ? { alb: { dnsName: params.albDnsName, listenerArn: params.albListenerArn } } : {}),
		...(params.targetGroupArn ? { targetGroupArn: params.targetGroupArn } : {}),
		...(params.taskDefinitionArn ? { taskDefinitionArn: params.taskDefinitionArn } : {}),
		...(params.logGroup ? { logGroup: params.logGroup } : {}),
		...(params.vpcId ? { vpcId: params.vpcId } : {}),
	};
}

export function buildStaticS3CloudResources(params: {
	region: string;
	bucket: string;
	keyPrefix: string;
	publicBaseUrl: string;
	cloudFrontDistributionId?: string | null;
}): StaticS3CloudResources {
	return {
		target: "static_s3",
		region: params.region,
		bucket: params.bucket,
		keyPrefix: params.keyPrefix,
		publicBaseUrl: params.publicBaseUrl,
		...(params.cloudFrontDistributionId
			? { cloudFrontDistributionId: params.cloudFrontDistributionId }
			: {}),
	};
}

/** Map legacy deploy result shape into cloud_resources. */
export function cloudResourcesFromDeployResult(
	target: "ecs" | "static_s3",
	region: string,
	result: DeployResult,
	opts?: {
		cluster?: string;
		service?: string;
		bucket?: string;
		keyPrefix?: string;
		cloudFrontDistributionId?: string | null;
	}
): CloudResources {
	if (target === "static_s3") {
		const instanceId = result.instanceId || "";
		const fromId = instanceId.startsWith("s3:") ? instanceId.slice(3) : "";
		const [bucket = opts?.bucket ?? "", ...prefixParts] = fromId.split("/");
		return buildStaticS3CloudResources({
			region,
			bucket: bucket || opts?.bucket || "",
			keyPrefix: prefixParts.join("/") || opts?.keyPrefix || "",
			publicBaseUrl: result.baseUrl,
			cloudFrontDistributionId:
				opts?.cloudFrontDistributionId ?? (result.sharedAlbDns?.trim() || null),
		});
	}

	const cluster = opts?.cluster || config.ECS_CLUSTER_NAME?.trim() || "default";
	const serviceFromId = result.instanceId?.startsWith("ecs:")
		? result.instanceId.slice(4).split("/").pop() || ""
		: "";
	const service = opts?.service || serviceFromId || "app";

	return buildEcsCloudResources({
		region,
		cluster,
		service,
		baseUrl: result.baseUrl,
		albDnsName: result.sharedAlbDns,
		albListenerArn: result.albListenerArn,
		targetGroupArn: result.targetGroupArn,
		taskDefinitionArn: result.taskDefinitionArn,
		logGroup: config.ECS_LOG_GROUP?.trim() || undefined,
		vpcId: result.vpcId || undefined,
	});
}

export function isEcsDeployment(deployment: {
	deploymentTarget?: string | null;
	cloudResources?: CloudResources | null;
}): boolean {
	if (isEcsCloudResources(deployment.cloudResources)) return true;
	return deployment.deploymentTarget === "ecs";
}

export function isStaticS3Deployment(deployment: {
	deploymentTarget?: string | null;
	cloudResources?: CloudResources | null;
}): boolean {
	if (isStaticS3CloudResources(deployment.cloudResources)) return true;
	return deployment.deploymentTarget === "static_s3";
}
