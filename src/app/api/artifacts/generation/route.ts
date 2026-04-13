import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/app/api/auth/authOptions";
import { dbHelper } from "@/db-helper";
import { captureServerEvent } from "@/lib/analytics/posthogServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
	repoName?: string;
	serviceName?: string;
	source?: "scan" | "feedback" | "manual";
	dockerfilesCount?: number;
	hasExistingDockerfiles?: boolean;
	hasExistingCompose?: boolean;
	hasCompose?: boolean;
	hasNginx?: boolean;
};

export async function POST(req: Request) {
	const session = await getServerSession(authOptions);
	const userID = session?.userID;
	if (!userID) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	let body: Body;
	try {
		body = (await req.json()) as Body;
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const repoName = String(body.repoName ?? "").trim();
	const serviceName = String(body.serviceName ?? "").trim();
	const source = body.source ?? "scan";
	if (!repoName || !serviceName) return NextResponse.json({ error: "Missing repoName or serviceName" }, { status: 400 });

	const dockerfilesCount = Math.max(0, Math.floor(Number(body.dockerfilesCount ?? 0)));
	const hasExistingDockerfiles = Boolean(body.hasExistingDockerfiles);
	const hasExistingCompose = Boolean(body.hasExistingCompose);
	const hasCompose = Boolean(body.hasCompose);
	const hasNginx = Boolean(body.hasNginx);

	// Heuristic for "generated" based on SDArtifacts flags:
	// - Dockerfiles are considered generated when there were no existing dockerfiles.
	// - Compose is considered generated when compose exists and there was no existing compose.
	// - Nginx doesn't currently expose an "existing" flag; treat it as generated when present.
	const dockerfilesGeneratedCount = hasExistingDockerfiles ? 0 : dockerfilesCount;
	const composeGenerated = hasCompose && !hasExistingCompose;
	const nginxGenerated = hasNginx;

	const res = await dbHelper.recordArtifactGeneration({
		userID,
		repoName,
		serviceName,
		source,
		dockerfilesGeneratedCount,
		composeGenerated,
		nginxGenerated,
	});

	// Mirror into PostHog (server-side) for funnels and dashboards.
	captureServerEvent({
		distinctId: userID,
		event: "artifact_generated",
		properties: {
			repo_name: repoName,
			service_name: serviceName,
			source,
			dockerfiles_generated_count: dockerfilesGeneratedCount,
			compose_generated: composeGenerated,
			nginx_generated: nginxGenerated,
		},
	});

	if ("error" in res && res.error) {
		return NextResponse.json({ error: res.error }, { status: 500 });
	}
	return NextResponse.json({ success: true, inserted: (res as any).inserted ?? 0 });
}

