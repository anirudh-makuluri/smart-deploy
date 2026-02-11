import { DeployConfig } from "../../app/types";
import { runCommandLiveWithOutput } from "../../server-helper";
import config from "../../config";

/**
 * Sets up AWS credentials for CLI commands (without websocket)
 */
async function setupAWSCredentialsSilent(): Promise<void> {
	if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
		process.env.AWS_ACCESS_KEY_ID = config.AWS_ACCESS_KEY_ID;
		process.env.AWS_SECRET_ACCESS_KEY = config.AWS_SECRET_ACCESS_KEY;
	}
	process.env.AWS_DEFAULT_REGION = config.AWS_REGION;
}

/**
 * Deletes an AWS Amplify app using stored appId.
 * Falls back to listing all apps by appName if appId is not stored.
 */
export async function deleteAmplifyApp(
	deployConfig: DeployConfig
): Promise<void> {
	const region = deployConfig.awsRegion || config.AWS_REGION || "us-west-2";

	await setupAWSCredentialsSilent();

	let appId = deployConfig.amplify?.appId;

	if (!appId && deployConfig.amplify?.appName) {
		// Fallback: find appId by searching for the stored appName
		const listOut = await runCommandLiveWithOutput("aws", [
			"amplify", "list-apps",
			"--output", "json",
			"--region", region
		]);

		let list: any = {};
		try {
			const output = listOut.trim();
			const lastLine = output.split('\n').pop() || output;
			list = JSON.parse(lastLine);
		} catch {
			const jsonMatch = listOut.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				list = JSON.parse(jsonMatch[0]);
			}
		}
		const app = (list.apps || []).find(
			(a: { name?: string }) => a.name === deployConfig.amplify?.appName
		);
		appId = app?.appId;
	}

	if (!appId) {
		console.warn("deleteAmplifyApp: no appId found in deployConfig.amplify — nothing to delete");
		return;
	}

	await runCommandLiveWithOutput("aws", [
		"amplify", "delete-app",
		"--app-id", appId,
		"--region", region
	]);
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

	await setupAWSCredentialsSilent();

	// Delete environment first
	if (envName) {
		try {
			await runCommandLiveWithOutput("aws", [
				"elasticbeanstalk", "terminate-environment",
				"--environment-name", envName,
				"--region", region
			]);
		} catch (err: any) {
			const msg = err instanceof Error ? err.message : String(err);
			const alreadyGone =
				msg.includes("does not exist") ||
				msg.includes("NotFound") ||
				msg.includes("No Environment found") ||
				msg.includes("InvalidParameterValue");
			if (!alreadyGone) throw err;
		}
	}

	// Delete application (this also deletes all versions)
	try {
		await runCommandLiveWithOutput("aws", [
			"elasticbeanstalk", "delete-application",
			"--application-name", appName,
			"--terminate-env-by-force",
			"--region", region
		]);
	} catch (err: any) {
		const msg = err instanceof Error ? err.message : String(err);
		const alreadyGone =
			msg.includes("does not exist") ||
			msg.includes("NotFound") ||
			msg.includes("No Environment found") ||
			msg.includes("No Application found") ||
			msg.includes("InvalidParameterValue");
		if (!alreadyGone) throw err;
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

	await setupAWSCredentialsSilent();

	// List services in the cluster
	let services: string[] = [];
	try {
		const listOut = await runCommandLiveWithOutput("aws", [
			"ecs", "list-services",
			"--cluster", clusterName,
			"--region", region,
			"--output", "json"
		]);
		let list: any = {};
		try {
			const output = listOut.trim();
			const lastLine = output.split('\n').pop() || output;
			list = JSON.parse(lastLine);
		} catch {
			const jsonMatch = listOut.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				list = JSON.parse(jsonMatch[0]);
			}
		}
		services = list.serviceArns || [];
	} catch (err: any) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("does not exist") && !msg.includes("ClusterNotFoundException")) {
			throw err;
		}
	}

	// Delete all services
	for (const serviceArn of services) {
		const serviceName = serviceArn.split('/').pop();
		if (serviceName) {
			try {
				// Scale down to 0 first
				await runCommandLiveWithOutput("aws", [
					"ecs", "update-service",
					"--cluster", clusterName,
					"--service", serviceName,
					"--desired-count", "0",
					"--region", region
				]);

				// Delete service
				await runCommandLiveWithOutput("aws", [
					"ecs", "delete-service",
					"--cluster", clusterName,
					"--service", serviceName,
					"--force",
					"--region", region
				]);
			} catch (err: any) {
				const msg = err instanceof Error ? err.message : String(err);
				if (!msg.includes("does not exist") && !msg.includes("NotFoundException")) {
					console.error(`Failed to delete ECS service ${serviceName}:`, msg);
				}
			}
		}
	}

	// Delete cluster
	try {
		await runCommandLiveWithOutput("aws", [
			"ecs", "delete-cluster",
			"--cluster", clusterName,
			"--region", region
		]);
	} catch (err: any) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("does not exist") && !msg.includes("NotFoundException")) {
			throw err;
		}
	}

	// Note: ALBs, Target Groups, Security Groups, and ECR repos are not automatically deleted
	// They may be reused or cleaned up manually. This is intentional to avoid breaking other deployments.
}

/**
 * Deletes an AWS EC2 instance using stored instanceId.
 * Falls back to searching by name tag if instanceId is not stored.
 */
export async function deleteEC2Instance(
	deployConfig: DeployConfig
): Promise<void> {
	const region = deployConfig.awsRegion || config.AWS_REGION || "us-west-2";

	await setupAWSCredentialsSilent();

	const instanceId = deployConfig.ec2?.instanceId;

	if (instanceId) {
		// Direct termination using stored instance ID
		try {
			await runCommandLiveWithOutput("aws", [
				"ec2", "terminate-instances",
				"--instance-ids", instanceId,
				"--region", region
			]);
		} catch (err: any) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!msg.includes("does not exist") && !msg.includes("NotFound") && !msg.includes("InvalidInstanceID")) {
				throw err;
			}
		}
	} else {
		console.warn("deleteEC2Instance: no instanceId found in deployConfig.ec2 — nothing to delete");
	}

	// Note: Security Groups, Key Pairs, and other resources are not automatically deleted
	// They may be reused or cleaned up manually.
}

/**
 * Main function to delete AWS deployment based on deploymentTarget.
 * Uses stored service details (ec2, ecs, amplify, elasticBeanstalk) from DeployConfig
 * to identify the exact resources to delete.
 * @param deployConfig - The deployment configuration with stored service details
 * @param deploymentTarget - The target service type (from deploymentTarget)
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
