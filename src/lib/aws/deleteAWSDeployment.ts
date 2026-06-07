import { DeployConfig } from "../../app/types";
import { isEcsCloudResources } from "@/lib/cloudResources";
import config from "../../config";
import {
	EC2Client,
	TerminateInstancesCommand,
} from "@aws-sdk/client-ec2";
import {
	ECSClient,
	DeleteServiceCommand,
} from "@aws-sdk/client-ecs";
import {
	ElasticLoadBalancingV2Client,
	DescribeTargetGroupsCommand,
	DescribeLoadBalancersCommand,
	DescribeListenersCommand,
	DescribeRulesCommand,
	DeleteRuleCommand,
	DeleteTargetGroupCommand,
	DeleteLoadBalancerCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { findTargetGroupArnByName } from "./awsHelpers";

function getClientConfig(region: string) {
	const conf: { region: string; credentials?: { accessKeyId: string; secretAccessKey: string } } = { region };
	if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
		conf.credentials = {
			accessKeyId: config.AWS_ACCESS_KEY_ID,
			secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
		};
	}
	return conf;
}

function isNotFoundError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return (
		msg.includes("does not exist") ||
		msg.includes("NotFound") ||
		msg.includes("No Environment found") ||
		msg.includes("No Application found") ||
		msg.includes("InvalidParameterValue") ||
		msg.includes("ClusterNotFoundException") ||
		msg.includes("ServiceNotFoundException") ||
		msg.includes("InvalidInstanceID")
	);
}

function awsNameChunk(s: string, max: number): string {
	const out = s
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, max);
	return out || "app";
}

function sharedAlbEnabled(): boolean {
	return !!config.EC2_ACM_CERTIFICATE_ARN && !!config.NEXT_PUBLIC_DEPLOYMENT_DOMAIN;
}

function parseEcsInstanceId(instanceId: string): { cluster: string; serviceName: string } | null {
	if (!instanceId.startsWith("ecs:")) return null;
	const rest = instanceId.slice(4).trim();
	const slash = rest.indexOf("/");
	if (slash <= 0 || slash >= rest.length - 1) return null;
	return {
		cluster: rest.slice(0, slash).trim(),
		serviceName: rest.slice(slash + 1).trim(),
	};
}

async function resolveSharedAlbArn(region: string): Promise<string | undefined> {
	const elbClient = new ElasticLoadBalancingV2Client(getClientConfig(region));
	const stsClient = new STSClient(getClientConfig(region));
	try {
		const identity = await stsClient.send(new GetCallerIdentityCommand({}));
		const accountId = identity.Account || "";
		const suffix = accountId ? accountId.slice(-6) : "shared";
		const albName = `smartdeploy-${suffix}-alb`.slice(0, 32);
		const albResult = await elbClient.send(new DescribeLoadBalancersCommand({ Names: [albName] }));
		return albResult.LoadBalancers?.[0]?.LoadBalancerArn;
	} catch {
		return undefined;
	}
}

async function cleanupSharedAlbForTargetGroup(targetGroupArn: string, region: string): Promise<void> {
	const elbClient = new ElasticLoadBalancingV2Client(getClientConfig(region));
	const albArn = await resolveSharedAlbArn(region);

	if (albArn) {
		try {
			const listenersResult = await elbClient.send(
				new DescribeListenersCommand({ LoadBalancerArn: albArn })
			);

			const listeners = listenersResult.Listeners || [];
			const ruleArnsToDelete = (
				await Promise.all(
					listeners.map(async (listener) => {
						const listenerArn = listener.ListenerArn;
						if (!listenerArn) return [] as string[];
						const rulesResult = await elbClient.send(
							new DescribeRulesCommand({ ListenerArn: listenerArn })
						);
						return (rulesResult.Rules || []).flatMap((rule) => {
							const forwardsTarget = (rule.Actions || []).some(
								(action) =>
									action.Type === "forward" && action.TargetGroupArn === targetGroupArn
							);
							return forwardsTarget && rule.RuleArn ? [rule.RuleArn] : [];
						});
					})
				)
			).flat();

			await Promise.all(
				ruleArnsToDelete.map(async (ruleArn) => {
					try {
						await elbClient.send(new DeleteRuleCommand({ RuleArn: ruleArn }));
					} catch {
						// Ignore rule delete errors
					}
				})
			);
		} catch {
			// Ignore listener/rule cleanup errors
		}
	}

	try {
		await elbClient.send(new DeleteTargetGroupCommand({ TargetGroupArn: targetGroupArn }));

		if (albArn) {
			const remainingListeners = await elbClient.send(
				new DescribeListenersCommand({ LoadBalancerArn: albArn })
			);
			const routeChecks = await Promise.all(
				(remainingListeners.Listeners || []).map(async (listener) => {
					if (!listener.ListenerArn) return false;
					const rulesResult = await elbClient.send(
						new DescribeRulesCommand({ ListenerArn: listener.ListenerArn })
					);
					return (rulesResult.Rules || []).some((rule) =>
						(rule.Actions || []).some(
							(action) =>
								action.Type === "forward" &&
								!!action.TargetGroupArn &&
								action.TargetGroupArn !== targetGroupArn
						)
					);
				})
			);
			const hasOtherRoutes = routeChecks.some(Boolean);

			if (!hasOtherRoutes) {
				console.log("No other routes on shared ALB. Deleting ALB...");
				await elbClient.send(new DeleteLoadBalancerCommand({ LoadBalancerArn: albArn }));
			}
		}
	} catch (err) {
		console.error("Error during target group/ALB cleanup", err);
	}
}

async function resolveEcsTargetGroupArn(deployConfig: DeployConfig, region: string): Promise<string | null> {
	const ecsResources = isEcsCloudResources(deployConfig.cloudResources) ? deployConfig.cloudResources : null;
	const stored = ecsResources?.targetGroupArn?.trim();
	if (stored) return stored;

	const repoName = String(deployConfig.repoName || deployConfig.repoUrl.split("/").pop()?.replace(".git", "") || "app").trim();
	const serviceName = String(deployConfig.serviceName || repoName || "app").trim();
	const candidates = [
		awsNameChunk(`sd-${repoName}-${serviceName}-tg`, 32),
		awsNameChunk(`sd-${repoName}-app-tg`, 32),
	];
	const uniqueCandidates = [...new Set(candidates)];
	const arns = await Promise.all(
		uniqueCandidates.map((name) => findTargetGroupArnByName(name, region, null))
	);
	return arns.find((arn) => arn) ?? null;
}

async function deleteEcsDeployment(deployConfig: DeployConfig): Promise<void> {
	const region = deployConfig.region || config.AWS_REGION || "us-west-2";
	const ecsResources = isEcsCloudResources(deployConfig.cloudResources) ? deployConfig.cloudResources : null;

	const repoName = deployConfig.repoName?.trim() || deployConfig.repoUrl.split("/").pop()?.replace(".git", "") || "app";
	const unitName = deployConfig.serviceName?.trim() || "app";
	const cluster = ecsResources?.cluster?.trim() || config.ECS_CLUSTER_NAME?.trim() || "";
	const serviceName = ecsResources?.service?.trim() || awsNameChunk(`sd-${repoName}-${unitName}`, 255);

	if (!cluster) {
		console.warn("deleteEcsDeployment: no ECS cluster name found; skipping service delete");
	} else if (!serviceName) {
		console.warn("deleteEcsDeployment: no ECS service name found; skipping service delete");
	} else {
		const ecs = new ECSClient(getClientConfig(region));
		try {
			await ecs.send(
				new DeleteServiceCommand({
					cluster,
					service: serviceName,
					force: true,
				})
			);
			console.log(`Deleted ECS service ${serviceName} in cluster ${cluster}`);
		} catch (err) {
			if (!isNotFoundError(err)) throw err;
		}
	}

	if (sharedAlbEnabled()) {
		const targetGroupArn = await resolveEcsTargetGroupArn(deployConfig, region);
		if (targetGroupArn) {
			await cleanupSharedAlbForTargetGroup(targetGroupArn, region);
		}
	}
}

/**
 * Deletes an AWS EC2 instance using stored instanceId.
 * When shared ALB is enabled, also removes target group and listener rules.
 */
export async function deleteEC2Instance(deployConfig: DeployConfig): Promise<void> {
	const region = deployConfig.region || config.AWS_REGION || "us-west-2";
	const repoName = deployConfig.repoUrl.split("/").pop()?.replace(".git", "") || "app";

	const ec2Client = new EC2Client(getClientConfig(region));

	if (sharedAlbEnabled()) {
		const elbClient = new ElasticLoadBalancingV2Client(getClientConfig(region));
		const targetGroupName =
			`${repoName}-tg`
				.toLowerCase()
				.replace(/[^a-z0-9-]/g, "-")
				.replace(/-+/g, "-")
				.replace(/^-|-$/g, "")
				.slice(0, 32) || "smartdeploy-tg";

		try {
			const tgResult = await elbClient.send(
				new DescribeTargetGroupsCommand({ Names: [targetGroupName] })
			);
			const targetGroupArn = tgResult.TargetGroups?.[0]?.TargetGroupArn;
			if (targetGroupArn) {
				await cleanupSharedAlbForTargetGroup(targetGroupArn, region);
			}
		} catch {
			// Ignore missing or in-use target groups
		}
	}

	console.warn("deleteEC2Instance: legacy EC2 deployments are no longer supported; skipping instance terminate");

	// Note: Security Groups, Key Pairs, and other resources are not automatically deleted
}

/**
 * Main function to delete AWS deployment based on deploymentTarget.
 * Uses stored service details (ec2) from DeployConfig
 * to identify the exact resources to delete.
 */
export async function deleteAWSDeployment(
	deployConfig: DeployConfig,
	deploymentTarget: string
): Promise<void> {
	if (deploymentTarget === "ec2") {
		await deleteEC2Instance(deployConfig);
		return;
	}
	if (deploymentTarget === "ecs") {
		await deleteEcsDeployment(deployConfig);
		return;
	}
	if (deploymentTarget === "static_s3") {
		// Static sites share one bucket; per-deploy objects are not removed here yet.
		return;
	}
}
