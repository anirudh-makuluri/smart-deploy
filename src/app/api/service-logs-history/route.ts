import { NextRequest, NextResponse } from "next/server";
import { dbHelper } from "@/db-helper";
import { getInitialLogs } from "@/gcloud-logs/getInitialLogs";
import { getInitialEc2ServiceLogs } from "@/lib/aws/ec2ServiceLogs";
import config from "@/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LogEntry = { timestamp?: string; message?: string };

function parseLimit(raw: string | null): number {
	const n = Number.parseInt(raw ?? "", 10);
	if (!Number.isFinite(n) || n <= 0) return 50;
	return Math.min(n, 5000);
}

// GET ?repoName=xxx&serviceName=yyy&limit=200
// Returns the most recent `limit` logs in chronological order (oldest -> newest).
export async function GET(req: NextRequest) {
	const repoName = (req.nextUrl.searchParams.get("repoName") ?? "").trim();
	const serviceName = (req.nextUrl.searchParams.get("serviceName") ?? "").trim();
	const limit = parseLimit(req.nextUrl.searchParams.get("limit"));

	if (!serviceName) {
		return NextResponse.json({ error: "serviceName is required" }, { status: 400 });
	}

	try {
		// If this deployment is backed by EC2, use docker-compose logs via SSM.
		if (repoName) {
			const deploymentRes = await dbHelper.getDeployment(repoName, serviceName);
			const deployConfig = deploymentRes.deployment;
			const instanceId = deployConfig?.ec2?.instanceId;

			if (instanceId) {
				const region = deployConfig.awsRegion || config.AWS_REGION;
				const logs = await getInitialEc2ServiceLogs({
					instanceId,
					region,
					serviceName,
					limit,
				});
				return NextResponse.json({ logs });
			}
		}

		// Otherwise treat it as a Cloud Run-style service and query GCP logs.
		const logs = await getInitialLogs(serviceName, limit) as LogEntry[];
		return NextResponse.json({ logs });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return NextResponse.json({ error: message }, { status: 500 });
	}
}

