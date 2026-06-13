import { unstable_cache } from "next/cache";
import config from "@/config";
import { getSupabaseServer } from "@/lib/supabaseServer";

export type LandingPublicStats = {
	totalDeployments: number;
	totalAnalyses: number;
	totalArtifacts: number;
};

async function fetchLandingStatsUncached(): Promise<LandingPublicStats> {
	const supabase = getSupabaseServer();

	const [deploymentsResult, analysesResult, artifactsResult] = await Promise.all([
		supabase
			.from("deployment_runs")
			.select("id", { count: "exact", head: true })
			.not("finished_at", "is", null),
		supabase
			.from("analysis_responses")
			.select("id", { count: "exact", head: true }),
		supabase
			.from("artifact_events")
			.select("count")
			.eq("action", "generated"),
	]);

	const totalDeployments = deploymentsResult.count ?? 0;
	const totalAnalyses = analysesResult.count ?? 0;

	let totalArtifacts = 0;
	if (artifactsResult.data) {
		for (const row of artifactsResult.data) {
			totalArtifacts += (row as { count: number }).count ?? 0;
		}
	}

	return { totalDeployments, totalAnalyses, totalArtifacts };
}

const getCachedLandingStats = unstable_cache(
	fetchLandingStatsUncached,
	["landing-public-stats-v1"],
	{ revalidate: 300 }
);

export async function getLandingPublicStats(): Promise<LandingPublicStats | null> {
	if (!config.PUBLIC_DEPLOY_METRICS_ENABLED) {
		return null;
	}
	try {
		return await getCachedLandingStats();
	} catch {
		return null;
	}
}
