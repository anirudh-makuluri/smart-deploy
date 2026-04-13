"use client";

import type { DeployMetricsSummary } from "@/lib/metrics/deployMetricsCore";

function formatDurationMs(ms: number | null): string {
	if (ms === null) return "—";
	if (ms < 1000) return `${ms} ms`;
	const s = ms / 1000;
	if (s < 60) return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
	const m = Math.floor(s / 60);
	const sec = Math.round(s % 60);
	return `${m}m ${sec}s`;
}

type StatProps = { label: string; value: string };
function Stat({ label, value }: StatProps) {
	return (
		<div className="min-w-0">
			<p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
			<p className="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground sm:text-3xl">
				{value}
			</p>
		</div>
	);
}

type LandingMetricsStripProps = {
	metrics: DeployMetricsSummary;
};

export function LandingMetricsStrip({ metrics }: LandingMetricsStripProps) {
	const rate =
		metrics.successRatePercent === null ? "—" : `${metrics.successRatePercent}%`;

	return (
		<div
			className="landing-panel landing-shell relative overflow-hidden p-5 sm:p-6"
			aria-label="All-time deployment statistics"
		>
			<div className="landing-grid-overlay absolute inset-0 opacity-20" aria-hidden />
			<div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<p className="text-xs font-medium text-muted-foreground">
					All-time deploy stats
					<span className="mx-2 text-border">·</span>
					<span className="font-mono text-[0.7rem] opacity-90">
						updated {new Date(metrics.computedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
					</span>
				</p>
			</div>
			<div className="relative z-10 mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
				<Stat label="Deployments" value={String(metrics.totalCount)} />
				<Stat label="Success rate" value={rate} />
				<Stat label="Median time" value={formatDurationMs(metrics.medianDurationMs)} />
				<Stat label="P95 time" value={formatDurationMs(metrics.p95DurationMs)} />
			</div>
		</div>
	);
}
