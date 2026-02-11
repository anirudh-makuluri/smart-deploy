import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { runCommandLiveWithOutput } from "@/server-helper";
import config from "@/config";
import { db } from "@/lib/firebaseAdmin";
import { authOptions } from "../auth/authOptions";
import { dbHelper } from "@/db-helper";
import { deleteAWSDeployment } from "@/lib/aws/deleteAWSDeployment";
import { DeployConfig } from "@/app/types";

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

		if (!deploymentId || !serviceName) {
			return NextResponse.json(
				{ error: "Missing deploymentId or serviceName" },
				{ status: 400 }
			);
		}

		// Verify ownership and get deployment config
		const deploymentRef = db.collection("deployments").doc(deploymentId);
		const deploymentDoc = await deploymentRef.get();

		if (!deploymentDoc.exists) {
			return NextResponse.json(
				{ error: "Deployment not found" },
				{ status: 404 }
			);
		}

		const data = deploymentDoc.data();
		if (data && data.ownerID !== userID) {
			return NextResponse.json(
				{ error: "Forbidden: deployment does not belong to user" },
				{ status: 403 }
			);
		}

		const deployConfig = data as DeployConfig;
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

		// 2. Delete from DB (deployment doc + user's deploymentIds)
		const result = await dbHelper.deleteDeployment(deploymentId, userID);

		if (result.error) {
			return NextResponse.json(
				{ error: "Failed to delete deployment record", details: result.error },
				{ status: 500 }
			);
		}

		return NextResponse.json({ status: "success", message: "Deployment deleted; no traces left." });
	} catch (err: unknown) {
		console.error("delete-deployment error:", err);
		const message = err instanceof Error ? err.message : String(err);
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
