import { NextResponse } from "next/server";
import { getArtifactMetricsPublic } from "@/lib/metrics/artifactMetrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	const metrics = await getArtifactMetricsPublic();
	return NextResponse.json(metrics, {
		status: 200,
		headers: {
			"Cache-Control": "s-maxage=300, stale-while-revalidate=600",
		},
	});
}

