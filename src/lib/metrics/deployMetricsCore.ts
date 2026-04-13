export type DeployMetricsSummary = {
	totalCount: number;
	successCount: number;
	/** 0–100, or null if there are no deployments */
	successRatePercent: number | null;
	durationSampleCount: number;
	medianDurationMs: number | null;
	p95DurationMs: number | null;
	computedAt: string;
};

type RpcPayload = {
	total_count?: unknown;
	success_count?: unknown;
	duration_sample_count?: unknown;
	median_duration_ms?: unknown;
	p95_duration_ms?: unknown;
};

function toInt(n: unknown): number {
	if (typeof n === "number" && Number.isFinite(n)) return Math.round(n);
	if (typeof n === "string" && n.trim() !== "" && Number.isFinite(Number(n))) return Math.round(Number(n));
	return 0;
}

function toNullableNumber(n: unknown): number | null {
	if (n === null || n === undefined) return null;
	if (typeof n === "number" && Number.isFinite(n)) return n;
	if (typeof n === "string" && n.trim() !== "" && Number.isFinite(Number(n))) return Number(n);
	return null;
}

export function mapRpcToSummary(payload: RpcPayload, computedAt: string): DeployMetricsSummary {
	const totalCount = toInt(payload.total_count);
	const successCount = toInt(payload.success_count);
	const durationSampleCount = toInt(payload.duration_sample_count);
	const medianRaw = toNullableNumber(payload.median_duration_ms);
	const p95Raw = toNullableNumber(payload.p95_duration_ms);
	return {
		totalCount,
		successCount,
		successRatePercent: totalCount === 0 ? null : Math.round((100 * successCount) / totalCount),
		durationSampleCount,
		medianDurationMs: medianRaw !== null ? Math.round(medianRaw) : null,
		p95DurationMs: p95Raw !== null ? Math.round(p95Raw) : null,
		computedAt,
	};
}

/** PostgreSQL-style linear interpolation on sorted values (matches `percentile_cont`). */
export function percentileLinear(sortedAsc: number[], p: number): number | null {
	if (sortedAsc.length === 0) return null;
	const pos = (sortedAsc.length - 1) * p;
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	if (lo === hi) return sortedAsc[lo];
	return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (pos - lo);
}

export function aggregateRowsToSummary(
	rows: { success: boolean; duration_ms: number | null }[],
	computedAt: string
): DeployMetricsSummary {
	const totalCount = rows.length;
	const successCount = rows.filter((r) => r.success).length;
	const durations = rows
		.map((r) => r.duration_ms)
		.filter((ms): ms is number => ms !== null && ms !== undefined && Number.isFinite(ms));
	const sorted = [...durations].sort((a, b) => a - b);
	return {
		totalCount,
		successCount,
		successRatePercent: totalCount === 0 ? null : Math.round((100 * successCount) / totalCount),
		durationSampleCount: sorted.length,
		medianDurationMs:
			sorted.length === 0 ? null : Math.round(percentileLinear(sorted, 0.5)!),
		p95DurationMs: sorted.length === 0 ? null : Math.round(percentileLinear(sorted, 0.95)!),
		computedAt,
	};
}
