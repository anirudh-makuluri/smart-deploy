import { runCommandLiveWithOutput } from "../server-helper";
import config from "../config";
import { dbHelper } from "../db-helper";
import { deleteAWSDeployment } from "./aws/deleteAWSDeployment";
import { deleteVercelDnsRecord } from "./vercelDns";
import type { DeployConfig } from "../app/types";

const gcpRegion = "us-central1";

export async function deleteDeploymentForOwner(params: {
	repoName: string;
	serviceName: string;
	userID: string;
	skipOwnershipCheck?: boolean;
}) {
	const { repoName, serviceName, userID, skipOwnershipCheck = false } = params;

	const { deployment, error: fetchError } = await dbHelper.getDeployment(
		repoName,
		serviceName,
		skipOwnershipCheck ? undefined : userID
	);
	if (fetchError || !deployment) {
		return { status: 404 as const, body: { error: "Deployment not found" } };
	}

	if (!skipOwnershipCheck && deployment.ownerID !== userID) {
		return {
			status: 403 as const,
			body: { error: "Forbidden: deployment does not belong to user" },
		};
	}

	const deployConfig = deployment as DeployConfig;
	const cloudProvider = deployConfig.cloudProvider || "aws";
	const deploymentTarget =
		deployConfig.deploymentTarget ||
		(deployConfig.ec2?.instanceId ? "ec2" : undefined);

	try {
		if (cloudProvider === "aws" && deploymentTarget) {
			await deleteAWSDeployment(deployConfig, deploymentTarget as string);
		} else {
			const projectId = config.GCP_PROJECT_ID;
			const deleteArgs = [
				"run",
				"services",
				"delete",
				serviceName,
				"--project",
				projectId,
				"--region",
				gcpRegion,
				"--platform=managed",
				"--quiet",
			];

			await runCommandLiveWithOutput("gcloud", deleteArgs);
		}
	} catch (cmdErr: unknown) {
		const message = cmdErr instanceof Error ? cmdErr.message : String(cmdErr);
		const alreadyGone =
			message.includes("could not be found") ||
			message.includes("NOT_FOUND") ||
			message.includes("does not exist") ||
			message.includes("NotFoundException") ||
			message.includes("No Environment found") ||
			message.includes("No Application found") ||
			message.includes("InvalidParameterValue");
		if (!alreadyGone) {
			return {
				status: 500 as const,
				body: { error: "Failed to delete cloud service", details: message },
			};
		}
	}

	const dnsResult = await deleteVercelDnsRecord({
		customUrl: deployConfig.custom_url || null,
		serviceName: deployConfig.service_name || serviceName || null,
	});
	if (!dnsResult.success) {
		return {
			status: 500 as const,
			body: { error: "Failed to delete Vercel DNS record", details: dnsResult.error },
		};
	}

	const result = await dbHelper.deleteDeployment(repoName, serviceName, deployment.ownerID);
	if (result.error) {
		return {
			status: 500 as const,
			body: { error: "Failed to delete deployment record", details: result.error },
		};
	}

	return {
		status: 200 as const,
		body: {
			status: "success",
			message: "Deployment deleted; no traces left.",
			vercelDnsDeleted: dnsResult.success ? dnsResult.deletedCount : 0,
		},
	};
}
