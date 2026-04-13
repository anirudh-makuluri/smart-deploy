import { unstable_cache } from "next/cache";
import { getSupabaseServer } from "@/lib/supabaseServer";

export type ArtifactMetricsSummary = {
	generatedCounts: {
		dockerfile: number;
		compose: number;
		nginx: number;
	};
	successfulDeploysTotal: number;
	/** Percentage of successful deploys that used generated dockerfiles, or null if no successes. */
	successWithGeneratedDockerfilesPercent: number | null;
	/** Percentage of successful deploys that used generated compose, or null if no successes. */
	successWithGeneratedComposePercent: number | null;
	/** Presence rate for nginx.conf among successful deploys (not "generated" yet), or null if no successes. */
	successWithNginxConfPercent: number | null;
	computedAt: string;
};

type RpcPayload = {
	generated_counts?: { dockerfile?: unknown; compose?: unknown; nginx?: unknown } | null;
	successful_deploys_total?: unknown;
	success_with_generated_dockerfiles?: unknown;
	success_with_generated_compose?: unknown;
	success_with_nginx_conf?: unknown;
};

function toInt(n: unknown): number {
	if (typeof n === "number" && Number.isFinite(n)) return Math.round(n);
	if (typeof n === "string" && n.trim() !== "" && Number.isFinite(Number(n))) return Math.round(Number(n));
	return 0;
}

function percent(numer: number, denom: number): number | null {
	if (denom <= 0) return null;
	return Math.round((100 * numer) / denom);
}

function mapRpc(payload: RpcPayload, computedAt: string): ArtifactMetricsSummary {
	const generated = payload.generated_counts ?? {};
	const successfulTotal = toInt(payload.successful_deploys_total);
	const sDocker = toInt(payload.success_with_generated_dockerfiles);
	const sCompose = toInt(payload.success_with_generated_compose);
	const sNginx = toInt(payload.success_with_nginx_conf);

	return {
		generatedCounts: {
			dockerfile: toInt((generated as any)?.dockerfile),
			compose: toInt((generated as any)?.compose),
			nginx: toInt((generated as any)?.nginx),
		},
		successfulDeploysTotal: successfulTotal,
		successWithGeneratedDockerfilesPercent: percent(sDocker, successfulTotal),
		successWithGeneratedComposePercent: percent(sCompose, successfulTotal),
		successWithNginxConfPercent: percent(sNginx, successfulTotal),
		computedAt,
	};
}

async function getArtifactMetricsUncached(userId: string | null): Promise<ArtifactMetricsSummary> {
	const computedAt = new Date().toISOString();
	const supabase = getSupabaseServer();
	const { data, error } = await supabase.rpc("get_artifact_generation_metrics", { p_user_id: userId });
	if (error || !data || typeof data !== "object" || Array.isArray(data)) {
		throw new Error(error?.message ?? "Failed to compute artifact metrics (missing RPC?)");
	}
	return mapRpc(data as RpcPayload, computedAt);
}

const getCachedPublicArtifactMetrics = unstable_cache(
	async () => getArtifactMetricsUncached(null),
	["artifact-metrics-public-v1"],
	{ revalidate: 300 }
);

export async function getArtifactMetricsPublic(): Promise<ArtifactMetricsSummary> {
	return getCachedPublicArtifactMetrics();
}

export async function getArtifactMetricsForUser(userId: string): Promise<ArtifactMetricsSummary> {
	return getArtifactMetricsUncached(userId);
}

