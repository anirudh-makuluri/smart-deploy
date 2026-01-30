import { DeployConfig } from "../../app/types";
import { generateResourceName } from "./awsHelpers";
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
 * Deletes an AWS Amplify app
 */
export async function deleteAmplifyApp(
	deployConfig: DeployConfig
): Promise<void> {
	const region = deployConfig.awsRegion || config.AWS_REGION || "us-west-2";
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";
	const appName = generateResourceName(repoName, "amplify").slice(0, 255);

	await setupAWSCredentialsSilent();

	// List apps to find appId
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
		// If parsing fails, try to find JSON in output
		const jsonMatch = listOut.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			list = JSON.parse(jsonMatch[0]);
		}
	}
	const app = (list.apps || []).find((a: { name?: string }) => a.name === appName);

	if (app?.appId) {
		await runCommandLiveWithOutput("aws", [
			"amplify", "delete-app",
			"--app-id", app.appId,
			"--region", region
		]);
	}
}

/**
 * Deletes an AWS Elastic Beanstalk environment and application
 */
export async function deleteElasticBeanstalk(
	deployConfig: DeployConfig
): Promise<void> {
	const region = deployConfig.awsRegion || config.AWS_REGION || "us-west-2";
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";
	const appName = generateResourceName(repoName, "eb");
	const envName = `${appName}-env`;

	await setupAWSCredentialsSilent();

	// Delete environment first
	try {
		await runCommandLiveWithOutput("aws", [
			"elasticbeanstalk", "terminate-environment",
			"--environment-name", envName,
			"--region", region
		]);
	} catch (err: any) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("does not exist") && !msg.includes("NotFound")) {
			throw err;
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
		if (!msg.includes("does not exist") && !msg.includes("NotFound")) {
			throw err;
		}
	}
}

/**
 * Deletes AWS ECS services, cluster, and related resources
 */
export async function deleteECSDeployment(
	deployConfig: DeployConfig
): Promise<void> {
	const region = deployConfig.awsRegion || config.AWS_REGION || "us-west-2";
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";
	const clusterName = generateResourceName(repoName, "cluster");

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
 * Deletes an AWS EC2 instance
 */
export async function deleteEC2Instance(
	deployConfig: DeployConfig
): Promise<void> {
	const region = deployConfig.awsRegion || config.AWS_REGION || "us-west-2";
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";
	const instanceName = generateResourceName(repoName, "instance");

	await setupAWSCredentialsSilent();

	// Find instance by name tag
	try {
		const describeOut = await runCommandLiveWithOutput("aws", [
			"ec2", "describe-instances",
			"--filters", `Name=tag:Name,Values=${instanceName}`,
			"--query", "Reservations[*].Instances[*].InstanceId",
			"--output", "text",
			"--region", region
		]);

		const instanceIds = describeOut.trim().split(/\s+/).filter(Boolean);
		
		if (instanceIds.length > 0) {
			// Terminate instances
			await runCommandLiveWithOutput("aws", [
				"ec2", "terminate-instances",
				"--instance-ids", ...instanceIds,
				"--region", region
			]);
		}
	} catch (err: any) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("does not exist") && !msg.includes("NotFound")) {
			throw err;
		}
	}

	// Note: Security Groups, Key Pairs, and other resources are not automatically deleted
	// They may be reused or cleaned up manually.
}

/**
 * Main function to delete AWS deployment based on deployed-service or deploymentTarget
 * @param deployConfig - The deployment configuration
 * @param deploymentTarget - The target service type (from deployed-service field or deploymentTarget fallback)
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
