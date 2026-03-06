import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { dbHelper } from "@/db-helper";
import type { DeployStep } from "@/app/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET ?repoName=xxx&serviceName=yyy - list history for a deployment */
export async function GET(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const userID = session?.userID;
		if (!userID) {
			return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
		}

		const repoName = req.nextUrl.searchParams.get("repoName");
		const serviceName = req.nextUrl.searchParams.get("serviceName");
		if (!repoName || !serviceName) {
			return NextResponse.json({ error: "repoName and serviceName required" }, { status: 400 });
		}

		const response = await dbHelper.getDeploymentHistory(repoName, serviceName, userID);
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
		const {
			repoName,
			serviceName,
			success,
			steps,
			configSnapshot,
			commitSha,
			commitMessage,
			branch,
			durationMs,
		}: {
			repoName: string;
			serviceName: string;
			success: boolean;
			steps: DeployStep[];
			configSnapshot: Record<string, unknown>;
			commitSha?: string;
			commitMessage?: string;
			branch?: string;
			durationMs?: number;
		} = body;

		if (!repoName || !serviceName || typeof success !== "boolean" || !Array.isArray(steps)) {
			return NextResponse.json(
				{ error: "repoName, serviceName, success, and steps required" },
				{ status: 400 }
			);
		}

		const entry = {
			timestamp: new Date().toISOString(),
			success,
			steps,
			configSnapshot: configSnapshot || {},
			...(commitSha && { commitSha }),
			...(commitMessage && { commitMessage }),
			...(branch && { branch }),
			...(durationMs && { durationMs }),
		};

		const response = await dbHelper.addDeploymentHistory(repoName, serviceName, userID, entry);
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
