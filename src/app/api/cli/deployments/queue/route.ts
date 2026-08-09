import { NextRequest, NextResponse } from "next/server";
import type { DeployConfig } from "@/app/types";
import { dbHelper } from "@/db-helper";
import { getRequestUserId } from "@/lib/requestUser";
import { deploy } from "@/websocket-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QueueBody = {
	config?: DeployConfig;
};

export async function POST(request: NextRequest) {
	const userID = await getRequestUserId(request.headers);
	if (!userID) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	let body: QueueBody;
	try {
		body = (await request.json()) as QueueBody;
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const config = body.config;
	if (!config?.repoName?.trim() || !config.serviceName?.trim()) {
		return NextResponse.json({ error: "config.repoName and config.serviceName are required" }, { status: 400 });
	}
	if (!config.repoUrl?.trim() || !config.branch?.trim()) {
		return NextResponse.json({ error: "A repository URL and branch are required before deployment" }, { status: 400 });
	}
	if (!config.scanResults || Object.keys(config.scanResults).length === 0) {
		return NextResponse.json({ error: "Run Smart Analysis before deploying" }, { status: 400 });
	}

	const owned = await dbHelper.getDeploymentForUser(config.repoName, config.serviceName, userID);
	if (owned.error || !owned.deployment) {
		return NextResponse.json({ error: "Deployment configuration not found. Run analyze first." }, { status: 404 });
	}

	const deployConfig: DeployConfig = {
		...owned.deployment,
		...config,
		status: "deploying",
	};
	const result = await deploy({ deployConfig, token: "", userID }, undefined);
	return NextResponse.json({ runId: result.runId, status: "queued" }, { status: 202 });
}
