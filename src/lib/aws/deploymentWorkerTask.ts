import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import config from "@/config";
import { getAwsClientConfig } from "@/lib/aws/sdkClients";

function parseCommaList(raw: string | undefined): string[] {
	if (!raw?.trim()) return [];
	return raw.split(",").flatMap((value) => {
		const trimmed = value.trim();
		return trimmed ? [trimmed] : [];
	});
}

type DeploymentWorkerTaskConfig = {
	cluster: string;
	taskDefinitionArn: string;
	containerName: string;
	subnets: string[];
	securityGroups: string[];
	assignPublicIp: "ENABLED" | "DISABLED";
};

function resolveDeploymentWorkerTaskConfig(): DeploymentWorkerTaskConfig {
	const cluster = (config.DEPLOYMENT_WORKER_CLUSTER_NAME || config.ECS_CLUSTER_NAME || "").trim();
	const taskDefinitionArn = config.DEPLOYMENT_WORKER_TASK_DEFINITION_ARN.trim();
	const containerName = config.DEPLOYMENT_WORKER_CONTAINER_NAME.trim();
	const subnets = parseCommaList(config.DEPLOYMENT_WORKER_SUBNET_IDS || config.ECS_SUBNET_IDS);
	const securityGroups = parseCommaList(
		config.DEPLOYMENT_WORKER_SECURITY_GROUP_IDS || config.ECS_SECURITY_GROUP_IDS
	);
	const assignPublicIp = (
		config.DEPLOYMENT_WORKER_ASSIGN_PUBLIC_IP || config.ECS_ASSIGN_PUBLIC_IP || "DISABLED"
	)
		.trim()
		.toUpperCase() === "ENABLED"
		? "ENABLED"
		: "DISABLED";

	if (!cluster) {
		throw new Error("DEPLOYMENT_WORKER_CLUSTER_NAME or ECS_CLUSTER_NAME must be configured.");
	}
	if (!taskDefinitionArn) {
		throw new Error("DEPLOYMENT_WORKER_TASK_DEFINITION_ARN must be configured.");
	}
	if (!containerName) {
		throw new Error("DEPLOYMENT_WORKER_CONTAINER_NAME must be configured.");
	}
	if (subnets.length === 0 || securityGroups.length === 0) {
		throw new Error(
			"Deployment worker task networking is incomplete. Set DEPLOYMENT_WORKER_SUBNET_IDS/SECURITY_GROUP_IDS or reuse ECS_SUBNET_IDS/ECS_SECURITY_GROUP_IDS."
		);
	}

	return {
		cluster,
		taskDefinitionArn,
		containerName,
		subnets,
		securityGroups,
		assignPublicIp,
	};
}

export async function launchDeploymentWorkerTask(args: {
	runId: string;
	userId: string;
}): Promise<{ taskArn: string }> {
	const resolved = resolveDeploymentWorkerTaskConfig();
	const ecs = new ECSClient(getAwsClientConfig(config.AWS_REGION));
	const command = new RunTaskCommand({
		cluster: resolved.cluster,
		taskDefinition: resolved.taskDefinitionArn,
		launchType: "FARGATE",
		clientToken: args.runId,
		networkConfiguration: {
			awsvpcConfiguration: {
				subnets: resolved.subnets,
				securityGroups: resolved.securityGroups,
				assignPublicIp: resolved.assignPublicIp,
			},
		},
		overrides: {
			containerOverrides: [
				{
					name: resolved.containerName,
					command: ["node", "dist/deployment-runner.js"],
					environment: [
						{ name: "DEPLOYMENT_RUN_ID", value: args.runId },
						{ name: "DEPLOYMENT_USER_ID", value: args.userId },
					],
				},
			],
		},
	});

	const response = await ecs.send(command);
	const taskArn = response.tasks?.[0]?.taskArn?.trim();
	if (!taskArn) {
		const failureReason =
			response.failures?.map((failure) => `${failure.arn ?? "task"}:${failure.reason ?? "unknown"}`).join(" | ") ||
			"ECS RunTask did not return a task ARN.";
		throw new Error(failureReason);
	}

	return { taskArn };
}
