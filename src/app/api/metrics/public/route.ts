import { NextResponse } from "next/server";
import { getGlobalDeployMetricsForPublic } from "@/lib/metrics/deployMetrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	const metrics = await getGlobalDeployMetricsForPublic();
	if (metrics === null) {
		return NextResponse.json({ enabled: false as const }, { status: 200 });
	}
	return NextResponse.json(
		{ enabled: true as const, ...metrics },
		{
			status: 200,
			headers: {
				"Cache-Control": "s-maxage=300, stale-while-revalidate=600",
			},
		}
	);
}
