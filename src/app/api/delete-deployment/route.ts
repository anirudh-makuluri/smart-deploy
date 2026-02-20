import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { runCommandLiveWithOutput } from "@/server-helper";
import config from "@/config";
import { authOptions } from "../auth/authOptions";
import { dbHelper } from "@/db-helper";
import { deleteAWSDeployment } from "@/lib/aws/deleteAWSDeployment";
import { DeployConfig } from "@/app/types";
import { deleteVercelDnsRecord } from "@/lib/vercelDns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const gcpRegion = "us-central1";

/**
 * Permanently deletes a deployment: removes the cloud service (GCP Cloud Run or AWS) and all DB records.
 * No traces left.
 */
export async function POST(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const userID = session?.userID;

		if (!userID) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const { deploymentId, serviceName } = await req.json();

		// Validate payload shape before using it in Firestore paths
		const validDeploymentId =
			typeof deploymentId === "string" ? deploymentId.trim() : "";
		const validServiceName =
			typeof serviceName === "string" ? serviceName.trim() : "";

		if (!validDeploymentId || !validServiceName) {
			return NextResponse.json(
				{
					error:
						"Missing or invalid deploymentId or serviceName. Both must be non-empty strings.",
				},
				{ status: 400 }
			);
		}

		// Verify ownership and get deployment config
		const { deployment, error: fetchError } = await dbHelper.getDeployment(validDeploymentId);

		if (fetchError || !deployment) {
			return NextResponse.json(
				{ error: "Deployment not found" },
				{ status: 404 }
			);
		}

		if (deployment.ownerID !== userID) {
			return NextResponse.json(
				{ error: "Forbidden: deployment does not belong to user" },
				{ status: 403 }
			);
		}

		const deployConfig = deployment as DeployConfig;
		const cloudProvider = deployConfig.cloudProvider || "aws";
		
		const deploymentTarget = deployConfig.deploymentTarget;

		// 1. Delete cloud service based on provider and target
		try {
			if (cloudProvider === "aws" && deploymentTarget) {
				// Delete AWS deployment
				await deleteAWSDeployment(deployConfig, deploymentTarget as string);
			} else {
				// Default: GCP Cloud Run
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
			// Allow "not found" errors - service may already be deleted; still delete from DB
			const alreadyGone =
				message.includes("could not be found") ||
				message.includes("NOT_FOUND") ||
				message.includes("does not exist") ||
				message.includes("NotFoundException") ||
				message.includes("No Environment found") ||
				message.includes("No Application found") ||
				message.includes("InvalidParameterValue");
			if (!alreadyGone) {
				console.error("Failed to delete cloud service:", message);
				return NextResponse.json(
					{ error: "Failed to delete cloud service", details: message },
					{ status: 500 }
				);
			}
		}

		// 2. Delete Vercel DNS record (best effort; block on failure to avoid orphaned DNS)
		const dnsResult = await deleteVercelDnsRecord({
			customUrl: deployConfig.custom_url || null,
			serviceName: deployConfig.service_name || serviceName || null,
		});
		if (!dnsResult.success) {
			return NextResponse.json(
				{ error: "Failed to delete Vercel DNS record", details: dnsResult.error },
				{ status: 500 }
			);
		}

		// 3. Delete from DB (deployment doc + user's deploymentIds)
		const result = await dbHelper.deleteDeployment(validDeploymentId, userID);

		if (result.error) {
			return NextResponse.json(
				{ error: "Failed to delete deployment record", details: result.error },
				{ status: 500 }
			);
		}

		return NextResponse.json({
			status: "success",
			message: "Deployment deleted; no traces left.",
			vercelDnsDeleted: dnsResult.success ? dnsResult.deletedCount : 0,
		});
	} catch (err: unknown) {
		console.error("delete-deployment error:", err);
		const message = err instanceof Error ? err.message : String(err);
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
