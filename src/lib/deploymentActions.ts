import { EC2Client, StartInstancesCommand, StopInstancesCommand } from "@aws-sdk/client-ec2";
import { deleteAWSDeployment } from "@/lib/aws/deleteAWSDeployment";
import { deleteVercelDnsRecord } from "@/lib/vercelDns";
import { dbHelper } from "@/db-helper";
import config from "@/config";
import { DeployConfig, EC2Details } from "@/app/types";
import { runCommandLiveWithOutput } from "@/server-helper";

export type DeleteDeploymentArgs = {
	repoName: string;
	serviceName: string;
	userID: string;
};

export type DeleteDeploymentResult = {
	status: "success" | "error";
	message?: string;
	details?: string;
	vercelDnsDeleted?: number;
};

export type DeploymentControlArgs = {
	repoName?: string;
	serviceName?: string;
	action: "pause" | "resume" | "stop";
	userID: string;
};

export type DeploymentControlResult = {
	status: "success" | "error";
	message?: string;
	details?: string;
};

const GCP_REGION = "us-central1";

function sanitizeName(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

async function requireDeployment(repoName: string, serviceName: string, userID: string) {
	const { deployment, error } = await dbHelper.getDeployment(repoName, serviceName);
	if (error || !deployment) {
		return { error: "Deployment not found" };
	}
	if (deployment.ownerID !== userID) {
		return { error: "Forbidden: deployment does not belong to user" };
	}
	return { deployment };
}

export async function deleteDeploymentForUser({ repoName, serviceName, userID }: DeleteDeploymentArgs): Promise<DeleteDeploymentResult> {
	const validRepoName = sanitizeName(repoName);
	const validServiceName = sanitizeName(serviceName);
	if (!validRepoName || !validServiceName) {
		return { status: "error", message: "Missing or invalid repoName or serviceName. Both must be non-empty strings." };
	}

	const { deployment, error: ownershipError } = await requireDeployment(validRepoName, validServiceName, userID);
	if (ownershipError) {
		return { status: "error", message: ownershipError };
	}

	const deployConfig = deployment as DeployConfig;
	const cloudProvider = deployConfig.cloudProvider || "aws";
	const ec2Casted = (deployConfig.ec2 || {}) as EC2Details;
	const deploymentTarget =
		deployConfig.deploymentTarget ||
		(ec2Casted?.instanceId ? "ec2" : undefined);

	try {
		if (cloudProvider === "aws" && deploymentTarget) {
			await deleteAWSDeployment(deployConfig, deploymentTarget);
		} else {
			const projectId = config.GCP_PROJECT_ID;
			const deleteArgs = [
				"run",
				"services",
				"delete",
				validServiceName,
				"--project",
				projectId,
				"--region",
				GCP_REGION,
				"--platform=managed",
				"--quiet",
			];
			await runCommandLiveWithOutput("gcloud", deleteArgs);
		}
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		const alreadyGone =
			message.includes("could not be found") ||
			message.includes("NOT_FOUND") ||
			message.includes("does not exist") ||
			message.includes("NotFoundException") ||
			message.includes("No Environment found") ||
			message.includes("No Application found") ||
			message.includes("InvalidParameterValue");
		if (!alreadyGone) {
			return { status: "error", message: "Failed to delete cloud service", details: message };
		}
	}

	try {
		const dnsResult = await deleteVercelDnsRecord({
		customUrl: deployConfig.liveUrl || null,
		serviceName: deployConfig.serviceName || validServiceName || null,
		});
		if (!dnsResult.success) {
			return {
				status: "error",
				message: "Failed to delete Vercel DNS record",
				details: dnsResult.error,
			};
		}

		const result = await dbHelper.deleteDeployment(validRepoName, validServiceName, userID);
		if (result.error) {
			const details =
				typeof result.error === "string" ? result.error : JSON.stringify(result.error);
			return {
				status: "error",
				message: "Failed to delete deployment record",
				details,
			};
		}

		return {
			status: "success",
			message: "Deployment deleted; no traces left.",
			vercelDnsDeleted: dnsResult.deletedCount,
		};
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return { status: "error", message: message };
	}
}

export async function controlDeploymentForUser({ repoName, serviceName, action, userID }: DeploymentControlArgs): Promise<DeploymentControlResult> {
	if (!action) {
		return { status: "error", message: "Missing action" };
	}

	if (repoName && serviceName) {
		const validRepoName = sanitizeName(repoName);
		const validServiceName = sanitizeName(serviceName);
		if (!validRepoName || !validServiceName) {
			return { status: "error", message: "repoName and serviceName are required together" };
		}

		const { deployment, error } = await requireDeployment(validRepoName, validServiceName, userID);
		if (error) {
			return { status: "error", message: error };
		}
		const deployConfig = deployment as DeployConfig;
		const cloudProvider = deployConfig.cloudProvider || "aws";

		if (cloudProvider === "aws" && deployConfig.deploymentTarget === "ec2") {
		const ec2ConfigPause = (deployConfig.ec2 || {}) as EC2Details;
		const instanceId = ec2ConfigPause?.instanceId;
		if (!instanceId) {
			return { status: "error", message: "No EC2 instanceId stored for this deployment" };
		}

		const region = deployConfig.awsRegion || config.AWS_REGION || "us-west-2";
		const clientConfig: ConstructorParameters<typeof EC2Client>[0] = { region };
			if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
				clientConfig.credentials = {
					accessKeyId: config.AWS_ACCESS_KEY_ID,
					secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
				};
			}
			const ec2 = new EC2Client(clientConfig);

			if (action === "pause") {
				await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
				return { status: "success", message: "EC2 instance stopping" };
			}
			if (action === "resume") {
				await ec2.send(new StartInstancesCommand({ InstanceIds: [instanceId] }));
				return { status: "success", message: "EC2 instance starting" };
			}
			return { status: "error", message: "Invalid action for AWS EC2. Must be pause or resume." };
		}
	}

	if (!serviceName) {
		return { status: "error", message: "Missing service name for legacy Cloud Run control" };
	}

	const region = GCP_REGION;
	const projectId = config.GCP_PROJECT_ID;
	const commands: Record<string, string[]> = {
		pause: ["run", "services", "update-traffic", serviceName, "--project", projectId, "--to-zero", "--region", region, "--platform=managed"],
		resume: ["run", "services", "update-traffic", serviceName, "--project", projectId, "--to-latest", "--region", region, "--platform=managed"],
		stop: ["run", "services", "delete", serviceName, "--project", projectId, "--region", region, "--platform=managed", "--quiet"],
	};

	const args = commands[action];

	if (!args) {
		return { status: "error", message: "Invalid action. Must be pause, resume, or stop" };
	}

	try {
		const output = await runCommandLiveWithOutput("gcloud", args);
		return { status: "success", message: output };
	} catch (cmdErr: any) {
		if (action === "stop" && cmdErr.message?.includes("could not be found")) {
			return { status: "success", message: "Service already deleted or not found" };
		}
		const message = cmdErr instanceof Error ? cmdErr.message : String(cmdErr);
		return { status: "error", message };
	}
}
