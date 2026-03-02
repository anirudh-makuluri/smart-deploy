import { DeployConfig } from "../../app/types";
import config from "../../config";
import {
	EC2Client,
	TerminateInstancesCommand,
} from "@aws-sdk/client-ec2";
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
		msg.includes("InvalidInstanceID")
	);
}



/**
 * Deletes an AWS EC2 instance using stored instanceId.
 * When shared ALB is enabled, also removes target group and listener rules.
 */
export async function deleteEC2Instance(
	deployConfig: DeployConfig
): Promise<void> {
	const region = deployConfig.awsRegion || config.AWS_REGION || "us-west-2";
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";
	const sharedAlbEnabled = !!config.EC2_ACM_CERTIFICATE_ARN && !!config.NEXT_PUBLIC_DEPLOYMENT_DOMAIN;

	const ec2Client = new EC2Client(getClientConfig(region));

	if (sharedAlbEnabled) {
		const elbClient = new ElasticLoadBalancingV2Client(getClientConfig(region));
		const stsClient = new STSClient(getClientConfig(region));
		const targetGroupName = `${repoName}-tg`
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 32) || "smartdeploy-tg";

		try {
			const tgResult = await elbClient.send(
				new DescribeTargetGroupsCommand({ Names: [targetGroupName] })
			);
			const targetGroups = tgResult.TargetGroups || [];
			const targetGroupArn = targetGroups[0]?.TargetGroupArn;

			if (targetGroupArn) {
				let albName = "";
				let albArn: string | undefined = undefined;

				try {
					const identity = await stsClient.send(new GetCallerIdentityCommand({}));
					const accountId = identity.Account || "";
					const suffix = accountId ? accountId.slice(-6) : "shared";
					albName = `smartdeploy-${suffix}-alb`.slice(0, 32);

					const albResult = await elbClient.send(
						new DescribeLoadBalancersCommand({ Names: [albName] })
					);
					const loadBalancers = albResult.LoadBalancers || [];
					albArn = loadBalancers[0]?.LoadBalancerArn;

					if (albArn) {
						const listenersResult = await elbClient.send(
							new DescribeListenersCommand({ LoadBalancerArn: albArn })
						);
						const listeners = listenersResult.Listeners || [];

						for (const listener of listeners) {
							const listenerArn = listener.ListenerArn;
							if (!listenerArn) continue;

							const rulesResult = await elbClient.send(
								new DescribeRulesCommand({ ListenerArn: listenerArn })
							);
							const rules = rulesResult.Rules || [];

							for (const rule of rules) {
								const forwardsTarget = (rule.Actions || []).some(
									(action) =>
										action.Type === "forward" &&
										action.TargetGroupArn === targetGroupArn
								);
								if (forwardsTarget && rule.RuleArn) {
									try {
										await elbClient.send(
											new DeleteRuleCommand({ RuleArn: rule.RuleArn })
										);
									} catch {
										// Ignore rule delete errors
									}
								}
							}
						}
					}
				} catch {
					// Ignore listener/rule cleanup errors
				}

				try {
					await elbClient.send(
						new DeleteTargetGroupCommand({ TargetGroupArn: targetGroupArn })
					);

					// Check if there are any other target groups connected to the ALB
					if (albArn) {
						const remainingListeners = await elbClient.send(
							new DescribeListenersCommand({ LoadBalancerArn: albArn })
						);
						let hasOtherRoutes = false;
						for (const listener of remainingListeners.Listeners || []) {
							if (!listener.ListenerArn) continue;
							const rulesResult = await elbClient.send(
								new DescribeRulesCommand({ ListenerArn: listener.ListenerArn })
							);
							const rules: any[] = (rulesResult as any).Rules || [];
							// If any rule forwards to a different target group, there are still active apps
							hasOtherRoutes = hasOtherRoutes || rules.some((r: any) =>
								(r.Actions || []).some((a: any) => a.Type === "forward" && a.TargetGroupArn !== targetGroupArn)
							);
						}

						// Also ensure we check other target groups that might be attached to this ALB
						if (!hasOtherRoutes) {
							console.log(`No other routes on ALB ${albName}. Deleting ALB...`);
							await elbClient.send(
								new DeleteLoadBalancerCommand({ LoadBalancerArn: albArn })
							);
						}
					}
				} catch (err) {
					console.error("Error during target group/ALB cleanup", err);
				}
			}
		} catch {
			// Ignore missing or in-use target groups
		}
	}

	const instanceId = deployConfig.ec2?.instanceId;
	if (instanceId) {
		try {
			await ec2Client.send(
				new TerminateInstancesCommand({ InstanceIds: [instanceId] })
			);
		} catch (err) {
			if (!isNotFoundError(err)) throw err;
		}
	} else {
		console.warn("deleteEC2Instance: no instanceId found in deployConfig.ec2 — nothing to delete");
	}

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
	} else {
		throw new Error(`Unsupported AWS deployment target: ${deploymentTarget}`);
	}
}
