/**
 * POST /api/deployment-preview-screenshot
 * 
 * Generates a screenshot of a deployed application on-demand.
 * Called from the frontend when user clicks "New Preview" button.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/authOptions";
import { dbHelper } from "@/db-helper";
import { captureDeploymentScreenshotAndUpload } from "@/lib/deploymentScreenshot";
import { getDeploymentDisplayUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RequestBody {
	repoName: string;
	serviceName: string;
	force?: boolean;
}

export async function POST(request: NextRequest) {
	const start = Date.now();
	try {
		const session = await getServerSession(authOptions);
		const userID = (session as { userID?: string })?.userID;
		if (!userID) {
			return NextResponse.json(
				{ error: "Unauthorized" },
				{ status: 401 }
			);
		}

		const body: RequestBody = await request.json();
		const { repoName, serviceName, force = false } = body;

		if (!repoName || !serviceName) {
			return NextResponse.json(
				{ error: "Missing repoName or serviceName" },
				{ status: 400 }
			);
		}

		// Fetch the deployment from database
		const { deployments, error: fetchError } = await dbHelper.getDeploymentsByRepo(userID, repoName);
		if (fetchError || !deployments) {
			return NextResponse.json(
				{ error: fetchError || "Failed to fetch deployment" },
				{ status: 500 }
			);
		}

		// Find the specific service deployment
		const deployment = deployments.find((d: any) => d.serviceName === serviceName);
		if (!deployment) {
			return NextResponse.json(
				{ error: "Deployment not found" },
				{ status: 404 }
			);
		}

		// Determine the URL to screenshot
		const displayUrl = getDeploymentDisplayUrl(deployment);
		if (!displayUrl) {
			return NextResponse.json(
				{
					status: "skipped",
					error: "No live URL available for this deployment",
				}
			);
		}

		// Capture and upload screenshot
		console.debug(
			`[Screenshot] Starting capture for ${repoName}/${serviceName} at ${displayUrl}`
		);

		const screenshotUrl = await captureDeploymentScreenshotAndUpload({
			url: displayUrl,
			ownerID: userID,
			repoName: repoName,
			serviceName: serviceName,
		});

		// Update deployment with new screenshot URL
		const { error: updateError } = await dbHelper.updateDeployments(
			{
				...deployment,
				screenshotUrl: screenshotUrl,
			},
			userID
		);

		if (updateError) {
			console.error("Failed to update deployment with screenshot URL:", updateError);
			// Still return success since screenshot was captured, just couldn't save it
			// The frontend will refresh deployments anyway
		}

		console.debug(
			`[Screenshot] Completed for ${repoName}/${serviceName} in ${Date.now() - start}ms`
		);

		return NextResponse.json({
			status: "success",
			screenshotUrl: screenshotUrl,
		});
	} catch (err) {
		console.error("[Screenshot] Error:", err);
		const errorMessage = err instanceof Error ? err.message : "Unknown error";

		// Check if it's a gateway timeout or similar error (501, 502, 503, 504)
		if (
			errorMessage.includes("502") ||
			errorMessage.includes("503") ||
			errorMessage.includes("504") ||
			errorMessage.includes("gateway") ||
			errorMessage.includes("timeout")
		) {
			return NextResponse.json(
				{
					status: "skipped",
					error: "Gateway error - screenshot service temporarily unavailable",
				}
			);
		}

		return NextResponse.json(
			{ error: errorMessage || "Failed to generate screenshot" },
			{ status: 500 }
		);
	}
}
