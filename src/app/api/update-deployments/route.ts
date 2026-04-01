import { NextRequest, NextResponse } from "next/server";
import { DeployConfig } from "@/app/types";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { dbHelper } from "@/db-helper";
import { getDemoDeploymentDefaults } from "../../../lib/demoDeployment";

// Force dynamic rendering - prevents Next.js from analyzing this route during build
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
	try {
		const deployConfig  = await req.json();
		const session = await getServerSession(authOptions)

		const token = session?.accessToken
		const userID = session?.userID
		const accountMode = session?.accountMode ?? "demo";

		if (!token) {
			return NextResponse.json({ error: "Missing access token" }, { status: 401 });
		}

		if (!userID) {
			return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
		}

		const normalizedConfig: DeployConfig = accountMode === "demo"
			? await getDemoDeploymentDefaults(deployConfig as DeployConfig)
			: {
				...(deployConfig as DeployConfig),
				accountMode: "internal" as const,
				demoExpiresAt: undefined,
				demoCleanupStatus: undefined,
				demoRepoKey: undefined,
				demoCommitSha: undefined,
				demoLocked: false,
			};

		const response = await dbHelper.updateDeployments(normalizedConfig, userID);

		if(response.success) {
			return NextResponse.json({ status: "success", message : response.success});
		} else {
			return NextResponse.json({ status: "error", message : response.error});
		}
	} catch (error: any) {
		console.error("Deployment error:", error);
		return NextResponse.json({ error: error.message }, { status: 500 });
	}
}

