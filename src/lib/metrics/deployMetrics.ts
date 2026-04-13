import { unstable_cache } from "next/cache";
import config from "@/config";
import { getSupabaseServer } from "@/lib/supabaseServer";
import {
	aggregateRowsToSummary,
	mapRpcToSummary,
	type DeployMetricsSummary,
} from "@/lib/metrics/deployMetricsCore";

export type { DeployMetricsSummary } from "@/lib/metrics/deployMetricsCore";

const PAGE_SIZE = 1000;

async function fetchDeploymentHistoryRows(filterUserId: string | null): Promise<
	{ success: boolean; duration_ms: number | null }[]
> {
	const supabase = getSupabaseServer();
	const rows: { success: boolean; duration_ms: number | null }[] = [];
	let from = 0;
	for (;;) {
		let q = supabase.from("deployment_history").select("success, duration_ms").range(from, from + PAGE_SIZE - 1);
		if (filterUserId !== null) {
			q = q.eq("user_id", filterUserId);
		}
		const { data, error } = await q;
		if (error) throw new Error(error.message);
		const batch = data ?? [];
		rows.push(
			...batch.map((r) => ({
				success: Boolean(r.success),
				duration_ms: r.duration_ms === null || r.duration_ms === undefined ? null : Number(r.duration_ms),
			}))
		);
		if (batch.length < PAGE_SIZE) break;
		from += PAGE_SIZE;
	}
	return rows;
}

async function getDeployMetricsSummaryUncached(filterUserId: string | null): Promise<DeployMetricsSummary> {
	const computedAt = new Date().toISOString();
	const supabase = getSupabaseServer();
	const { data, error } = await supabase.rpc("get_deploy_metrics", { p_user_id: filterUserId });
	if (!error && data !== null && data !== undefined) {
		const payload = typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
		return mapRpcToSummary(payload, computedAt);
	}
	const rows = await fetchDeploymentHistoryRows(filterUserId);
	return aggregateRowsToSummary(rows, computedAt);
}

const getCachedGlobalDeployMetricsSummary = unstable_cache(
	async () => getDeployMetricsSummaryUncached(null),
	["deploy-metrics-global-v1"],
	{ revalidate: 300 }
);

/**
 * All-time aggregate across all users. Respects `PUBLIC_DEPLOY_METRICS_ENABLED`.
 */
export async function getGlobalDeployMetricsForPublic(): Promise<DeployMetricsSummary | null> {
	if (!config.PUBLIC_DEPLOY_METRICS_ENABLED) {
		return null;
	}
	return getCachedGlobalDeployMetricsSummary();
}

/**
 * All-time metrics for a single user (does not check PUBLIC_DEPLOY_METRICS_ENABLED).
 */
export async function getDeployMetricsForUser(userId: string): Promise<DeployMetricsSummary> {
	return getDeployMetricsSummaryUncached(userId);
}
