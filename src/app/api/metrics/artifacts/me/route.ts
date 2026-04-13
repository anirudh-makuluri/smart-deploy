import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/app/api/auth/authOptions";
import { getArtifactMetricsForUser } from "@/lib/metrics/artifactMetrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	const session = await getServerSession(authOptions);
	if (!session?.userID) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	const metrics = await getArtifactMetricsForUser(session.userID);
	return NextResponse.json(metrics);
}

