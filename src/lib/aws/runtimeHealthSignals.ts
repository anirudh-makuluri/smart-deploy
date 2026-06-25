import { DescribeTargetHealthCommand, ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { DescribeServicesCommand, ECSClient } from "@aws-sdk/client-ecs";
import type { EcsCloudResources, RuntimeHealthAlbEntry, RuntimeHealthEcsEntry } from "@/app/types";
import config from "@/config";
import { getAwsClientConfig } from "@/lib/aws/sdkClients";

function resolveRegion(region: string | undefined): string {
	return region?.trim() || config.AWS_REGION;
}

export async function getRuntimeEcsHealth(ecs: EcsCloudResources): Promise<RuntimeHealthEcsEntry | null> {
	const cluster = ecs.cluster?.trim();
	const service = ecs.service?.trim();
	if (!cluster || !service) return null;

	const client = new ECSClient(getAwsClientConfig(resolveRegion(ecs.region)));
	const response = await client.send(
		new DescribeServicesCommand({
			cluster,
			services: [service],
		})
	);
	const serviceResponse = response.services?.[0];
	if (!serviceResponse) return null;

	const primaryDeployment =
		serviceResponse.deployments?.find((deployment) => deployment.status === "PRIMARY") ??
		serviceResponse.deployments?.[0];

	return {
		status: serviceResponse.status ?? null,
		rolloutState: primaryDeployment?.rolloutState ?? null,
		desiredCount: serviceResponse.desiredCount ?? null,
		runningCount: serviceResponse.runningCount ?? null,
		pendingCount: serviceResponse.pendingCount ?? null,
	};
}

export async function getRuntimeAlbHealth(ecs: EcsCloudResources): Promise<RuntimeHealthAlbEntry | null> {
	const targetGroupArn = ecs.targetGroupArn?.trim();
	if (!targetGroupArn) return null;

	const client = new ElasticLoadBalancingV2Client(getAwsClientConfig(resolveRegion(ecs.region)));
	const response = await client.send(
		new DescribeTargetHealthCommand({
			TargetGroupArn: targetGroupArn,
		})
	);

	const counts: RuntimeHealthAlbEntry = {
		healthyTargetCount: 0,
		unhealthyTargetCount: 0,
		initialTargetCount: 0,
		drainingTargetCount: 0,
		unusedTargetCount: 0,
		unavailableTargetCount: 0,
	};

	for (const description of response.TargetHealthDescriptions ?? []) {
		const state = description.TargetHealth?.State;
		if (state === "healthy") counts.healthyTargetCount += 1;
		else if (state === "unhealthy") counts.unhealthyTargetCount += 1;
		else if (state === "initial") counts.initialTargetCount += 1;
		else if (state === "draining") counts.drainingTargetCount += 1;
		else if (state === "unused") counts.unusedTargetCount += 1;
		else if (state === "unavailable") counts.unavailableTargetCount += 1;
	}

	return counts;
}
