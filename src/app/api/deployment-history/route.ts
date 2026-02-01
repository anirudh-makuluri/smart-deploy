import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { dbHelper } from "@/db-helper";
import type { DeployStep } from "@/app/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET ?deploymentId=xxx - list history for a deployment */
export async function GET(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const userID = session?.userID;
		if (!userID) {
			return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
		}

		const deploymentId = req.nextUrl.searchParams.get("deploymentId");
		if (!deploymentId) {
			return NextResponse.json({ error: "deploymentId required" }, { status: 400 });
		}

		const response = await dbHelper.getDeploymentHistory(deploymentId, userID);
		if (response.error) {
			const isNotFound = response.error === "Deployment not found";
			return NextResponse.json(
				{ status: "error", message: response.error },
				{ status: isNotFound ? 404 : 400 }
			);
		}
		return NextResponse.json({ status: "success", history: response.history });
	} catch (error) {
		return NextResponse.json({ status: "error", message: error }, { status: 500 });
	}
}

/** POST - add a history entry (after deploy complete) */
export async function POST(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const userID = session?.userID;
		if (!userID) {
			return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
		}

		const body = await req.json();
		console.log("body", body);
		const {
			deploymentId,
			success,
			steps,
			configSnapshot,
			deployUrl,
		}: {
			deploymentId: string;
			success: boolean;
			steps: DeployStep[];
			configSnapshot: Record<string, unknown>;
			deployUrl?: string;
		} = body;

		if (!deploymentId || typeof success !== "boolean" || !Array.isArray(steps)) {
			return NextResponse.json(
				{ error: "deploymentId, success, and steps required" },
				{ status: 400 }
			);
		}

		const entry = {
			timestamp: new Date().toISOString(),
			success,
			steps,
			configSnapshot: configSnapshot || {},
			deployUrl,
		};

		const response = await dbHelper.addDeploymentHistory(deploymentId, userID, entry);
		console.log("response", response);
		if (response.error) {
			const isNotFound = response.error === "Deployment not found";
			return NextResponse.json(
				{ status: "error", message: response.error },
				{ status: isNotFound ? 404 : 400 }
			);
		}
		return NextResponse.json({ status: "success", id: response.id });
	} catch (error) {
		console.error("addDeploymentHistory error:", error);
		return NextResponse.json({ status: "error", message: error }, { status: 500 });
	}
}
