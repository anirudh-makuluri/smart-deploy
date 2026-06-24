import { deleteAWSDeployment } from "@/lib/aws/deleteAWSDeployment";
import { deleteRoute53DnsRecord } from "@/lib/route53Dns";
import { dbHelper } from "@/db-helper";
import { DeployConfig } from "@/app/types";
import { hostedUrlFromSubdomain } from "@/lib/hostedUrl";

export type DeleteDeploymentArgs = {
	repoName: string;
	serviceName: string;
	userID: string;
};

export type DeleteDeploymentResult = {
	status: "success" | "error";
	message?: string;
	details?: string;
	dnsRecordsDeleted?: number;
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

function sanitizeName(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

async function requireDeployment(repoName: string, serviceName: string, userID: string) {
	const { deployment, error } = await dbHelper.getDeploymentForUser(repoName, serviceName, userID);
	if (error || !deployment) {
		return { error: "Deployment not found" };
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
	const deploymentTarget = deployConfig.deploymentTarget || "ecs";

	try {
		await deleteAWSDeployment(deployConfig, deploymentTarget);
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
		const dnsResult = await deleteRoute53DnsRecord({
			customUrl: hostedUrlFromSubdomain(deployConfig.hostedSubdomain!),
			serviceName: deployConfig.serviceName || validServiceName || null,
		});
		if (!dnsResult.success) {
			return {
				status: "error",
				message: "Failed to delete Route 53 DNS record",
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
			dnsRecordsDeleted: dnsResult.deletedCount,
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

	if (!repoName || !serviceName) {
		return { status: "error", message: "repoName and serviceName are required" };
	}

	const validRepoName = sanitizeName(repoName);
	const validServiceName = sanitizeName(serviceName);
	if (!validRepoName || !validServiceName) {
		return { status: "error", message: "repoName and serviceName are required together" };
	}

	const { deployment, error } = await requireDeployment(validRepoName, validServiceName, userID);
	if (error) {
		return { status: "error", message: error };
	}

	if (!deployment) {
		return { status: "error", message: "Deployment not found" };
	}

	if (action === "stop") {
		return {
			status: "error",
			message: "Stopping deployments is not supported. Delete the deployment instead.",
		};
	}

	return {
		status: "error",
		message: `AWS ${deployment.deploymentTarget || "ecs"} deployments do not support ${action} yet.`,
	};
}
