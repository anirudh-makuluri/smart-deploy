"use client";

import { Boxes, AlertTriangle } from "lucide-react";
import type { DeployConfig, SDArtifactsResponse } from "@/app/types";
import { isSdArtifactsAnalyzeScan } from "@/lib/scanResultNormalization";
import { classifyScanWorkload, workloadProductLabel } from "@/lib/sdArtifactsWorkload";

type Props = {
	scanResults: DeployConfig["scanResults"];
};

export default function WorkloadInsightCard({ scanResults }: Props) {
	if (!scanResults || typeof scanResults !== "object" || Array.isArray(scanResults)) return null;
	if (!isSdArtifactsAnalyzeScan(scanResults)) return null;

	const typed = scanResults as SDArtifactsResponse;
	const cls = classifyScanWorkload(typed);
	if (!cls) return null;

	const hasWarnings = cls.globalWarnings.length > 0;

	return (
		<div className="rounded-xl border border-border bg-card p-4">
			<div className="flex items-start gap-3">
				<div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
					<Boxes className="size-4" aria-hidden />
				</div>
				<div className="min-w-0 flex-1 space-y-3">
					<div>
						<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workload</p>
						<p className="mt-1 text-sm text-foreground">{cls.headline}</p>
						<div className="mt-2 flex flex-wrap gap-2 text-[11px]">
							{cls.deployShape && (
								<span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-muted-foreground">
									shape: {cls.deployShape}
								</span>
							)}
							{cls.buildStatus && (
								<span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-muted-foreground">
									build: {cls.buildStatus}
								</span>
							)}
							<span className="rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 font-medium text-primary">
								{workloadProductLabel(cls.primaryProduct)}
							</span>
						</div>
					</div>

					<div className="space-y-2 border-t border-border/60 pt-3">
						<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Deploy units</p>
						<ul className="space-y-2 text-sm text-muted-foreground">
							{cls.units.map((u) => (
								<li key={u.name} className="rounded-md border border-border/50 bg-background/40 px-3 py-2">
									<div className="flex flex-wrap items-baseline justify-between gap-2">
										<span className="font-medium text-foreground">{u.name}</span>
										<span className="text-[10px] uppercase tracking-wide text-primary/90">
											{workloadProductLabel(u.product)}
										</span>
									</div>
									<div className="mt-1 font-mono text-[11px] text-muted-foreground/90">
										{u.unitType}
										{u.framework ? ` · ${u.framework}` : ""}
										{u.provider ? ` · ${u.provider}` : ""}
										{u.hasStartCommand ? " · start: yes" : " · start: no"}
									</div>
									{u.suggestedRailpackSpaOutputDir && !u.hasStartCommand && (
										<p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
											<span className="font-medium text-foreground/80">SPA build-arg hint:</span>{" "}
											<code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
												RAILPACK_SPA_OUTPUT_DIR={u.suggestedRailpackSpaOutputDir}
											</code>
										</p>
									)}
								</li>
							))}
						</ul>
					</div>

					{hasWarnings && (
						<div className="flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-950 dark:text-amber-100">
							<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
							<ul className="list-inside list-disc space-y-1 text-[13px] leading-snug">
								{cls.globalWarnings.map((w) => (
									<li key={w} className="marker:text-amber-600 dark:marker:text-amber-400">
										{w}
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
