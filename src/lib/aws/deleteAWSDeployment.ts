import { DeployConfig } from "../../app/types";
import config from "../../config";
import {
	AmplifyClient,
	ListAppsCommand,
	DeleteAppCommand,
} from "@aws-sdk/client-amplify";
import {
	ElasticBeanstalkClient,
	TerminateEnvironmentCommand,
	DeleteApplicationCommand,
} from "@aws-sdk/client-elastic-beanstalk";
import {
	ECSClient,
	ListServicesCommand,
	UpdateServiceCommand,
	DeleteServiceCommand,
	DeleteClusterCommand,
} from "@aws-sdk/client-ecs";
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
 * Deletes an AWS Amplify app using stored appId.
 * Falls back to listing all apps by appName if appId is not stored.
 */
export async function deleteAmplifyApp(
	deployConfig: DeployConfig
): Promise<void> {
	const region = deployConfig.awsRegion || config.AWS_REGION || "us-west-2";
	const client = new AmplifyClient(getClientConfig(region));

	let appId = deployConfig.amplify?.appId;

	if (!appId && deployConfig.amplify?.appName) {
		const listResult = await client.send(new ListAppsCommand({}));
		const app = (listResult.apps || []).find(
			(a) => a.name === deployConfig.amplify?.appName
		);
		appId = app?.appId;
	}

	if (!appId) {
		console.warn("deleteAmplifyApp: no appId found in deployConfig.amplify — nothing to delete");
		return;
	}

	try {
		await client.send(new DeleteAppCommand({ appId }));
	} catch (err) {
		if (!isNotFoundError(err)) throw err;
	}
}

/**
 * Deletes an AWS Elastic Beanstalk environment and application using stored names.
 */
export async function deleteElasticBeanstalk(
	deployConfig: DeployConfig
): Promise<void> {
	const region = deployConfig.awsRegion || config.AWS_REGION || "us-west-2";
	const appName = deployConfig.elasticBeanstalk?.appName;
	const envName = deployConfig.elasticBeanstalk?.envName;

	if (!appName) {
		console.warn("deleteElasticBeanstalk: no appName found in deployConfig.elasticBeanstalk — nothing to delete");
		return;
	}

	const client = new ElasticBeanstalkClient(getClientConfig(region));

	if (envName) {
		try {
			await client.send(
				new TerminateEnvironmentCommand({ EnvironmentName: envName })
			);
		} catch (err) {
			if (!isNotFoundError(err)) throw err;
		}
	}

	try {
		await client.send(
			new DeleteApplicationCommand({
				ApplicationName: appName,
				TerminateEnvByForce: true,
			})
		);
	} catch (err) {
		if (!isNotFoundError(err)) throw err;
	}
}

/**
 * Deletes AWS ECS services, cluster, and related resources using stored clusterName.
 */
export async function deleteECSDeployment(
	deployConfig: DeployConfig
): Promise<void> {
	const region = deployConfig.awsRegion || config.AWS_REGION || "us-west-2";
	const clusterName = deployConfig.ecs?.clusterName;

	if (!clusterName) {
		console.warn("deleteECSDeployment: no clusterName found in deployConfig.ecs — nothing to delete");
		return;
	}

	const client = new ECSClient(getClientConfig(region));

	let serviceArns: string[] = [];
	try {
		const listResult = await client.send(
			new ListServicesCommand({ cluster: clusterName })
		);
		serviceArns = listResult.serviceArns || [];
	} catch (err) {
		if (!isNotFoundError(err)) throw err;
		return;
	}

	for (const serviceArn of serviceArns) {
		const serviceName = serviceArn.split("/").pop();
		if (!serviceName) continue;
		try {
			await client.send(
				new UpdateServiceCommand({
					cluster: clusterName,
					service: serviceName,
					desiredCount: 0,
				})
			);
			await client.send(
				new DeleteServiceCommand({
					cluster: clusterName,
					service: serviceName,
					force: true,
				})
			);
		} catch (err) {
			if (!isNotFoundError(err)) {
				console.error(`Failed to delete ECS service ${serviceName}:`, err);
			}
		}
	}

	try {
		await client.send(
			new DeleteClusterCommand({ cluster: clusterName })
		);
	} catch (err) {
		if (!isNotFoundError(err)) throw err;
	}

	// Note: ALBs, Target Groups, Security Groups, and ECR repos are not automatically deleted
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
	const sharedAlbEnabled = !!config.ECS_ACM_CERTIFICATE_ARN && !!config.NEXT_PUBLIC_DEPLOYMENT_DOMAIN;

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
				try {
					const identity = await stsClient.send(new GetCallerIdentityCommand({}));
					const accountId = identity.Account || "";
					const suffix = accountId ? accountId.slice(-6) : "shared";
					const albName = `smartdeploy-${suffix}-alb`.slice(0, 32);

					const albResult = await elbClient.send(
						new DescribeLoadBalancersCommand({ Names: [albName] })
					);
					const loadBalancers = albResult.LoadBalancers || [];
					const albArn = loadBalancers[0]?.LoadBalancerArn;

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
				} catch {
					// Ignore missing or in-use target groups
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
 * Uses stored service details (ec2, ecs, amplify, elasticBeanstalk) from DeployConfig
 * to identify the exact resources to delete.
 */
export async function deleteAWSDeployment(
	deployConfig: DeployConfig,
	deploymentTarget: string
): Promise<void> {
	switch (deploymentTarget) {
		case "amplify":
			await deleteAmplifyApp(deployConfig);
			break;
		case "elastic-beanstalk":
			await deleteElasticBeanstalk(deployConfig);
			break;
		case "ecs":
			await deleteECSDeployment(deployConfig);
			break;
		case "ec2":
			await deleteEC2Instance(deployConfig);
			break;
		default:
			throw new Error(`Unsupported AWS deployment target: ${deploymentTarget}`);
	}
}
