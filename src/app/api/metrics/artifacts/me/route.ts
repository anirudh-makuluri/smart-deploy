import { NextResponse } from "next/server";
import { getArtifactMetricsForUser } from "@/lib/metrics/artifactMetrics";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	const session = await auth.api.getSession({ headers: await headers() });
	const userId = session?.user?.id;
	if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	const metrics = await getArtifactMetricsForUser(userId);
	return NextResponse.json(metrics);
}

