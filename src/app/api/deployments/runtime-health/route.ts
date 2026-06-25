import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { dbHelper } from "@/db-helper";
import { listRuntimeHealthSamples } from "@/lib/runtimeHealthStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
	const session = await auth.api.getSession({ headers: await headers() });
	const userID = session?.user?.id;
	if (!userID) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const repoName = request.nextUrl.searchParams.get("repoName")?.trim() ?? "";
	const serviceName = request.nextUrl.searchParams.get("serviceName")?.trim() ?? "";
	if (!repoName || !serviceName) {
		return NextResponse.json({ error: "Missing repoName or serviceName" }, { status: 400 });
	}

	const owned = await dbHelper.getDeploymentForUser(repoName, serviceName, userID);
	if (owned.error || !owned.deployment) {
		return NextResponse.json({ error: owned.error || "Deployment not found" }, { status: 404 });
	}

	try {
		const entries = await listRuntimeHealthSamples({
			userID,
			repoName,
			serviceName,
		});
		return NextResponse.json({ entries });
	} catch (error) {
		console.error("[runtime-health] failed to read runtime health:", error);
		const message = error instanceof Error ? error.message : "Failed to load runtime health";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
