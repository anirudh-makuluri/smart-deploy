"use client";

import { useMemo, useState } from "react";
import ServiceLogs from "@/components/ServiceLogs";
import type {
	SDAnalyzeBuildStatus,
	SDArtifactsResponse,
	SDBuildVerification,
	SDRepairAttempt,
} from "@/app/types";
import {
	collectBuildLogSources,
	formatBuildVerificationDuration,
	parseBuildLogExcerpt,
	resolveBuildVerificationUiStatus,
} from "@/lib/buildVerificationLogs";
import { AlertTriangle, CheckCircle2, Clock, Hammer, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type BuildVerificationPanelProps = {
	buildStatus: SDAnalyzeBuildStatus;
	buildVerification?: SDBuildVerification | null;
	repairHistory?: SDRepairAttempt[] | null;
	railpackVersion?: string | null;
	repoName?: string;
	serviceName?: string;
};

function statusMeta(status: ReturnType<typeof resolveBuildVerificationUiStatus>) {
	switch (status) {
		case "passed":
			return {
				title: "Build verification passed",
				subtitle: "Railpack build completed successfully on sd-artifacts",
				icon: CheckCircle2,
				iconClass: "bg-emerald-500/10 text-emerald-500",
				barClass: "bg-emerald-500",
			};
		case "failed":
			return {
				title: "Build verification failed",
				subtitle: "Railpack could not verify the build on sd-artifacts",
				icon: XCircle,
				iconClass: "bg-destructive/10 text-destructive",
				barClass: "bg-destructive",
			};
		case "skipped":
			return {
				title: "Build verification skipped",
				subtitle: "Railpack build was not run during analysis",
				icon: AlertTriangle,
				iconClass: "bg-amber-500/10 text-amber-600",
				barClass: "bg-amber-500",
			};
		default:
			return {
				title: "Build verification",
				subtitle: "Build outcome from sd-artifacts analyze",
				icon: Clock,
				iconClass: "bg-muted text-muted-foreground",
				barClass: "bg-primary",
			};
	}
}

export function BuildVerificationPanel({
	buildStatus,
	buildVerification,
	repairHistory,
	railpackVersion,
	repoName,
	serviceName,
}: BuildVerificationPanelProps) {
	const uiStatus = resolveBuildVerificationUiStatus(buildStatus, buildVerification);
	const meta = statusMeta(uiStatus);
	const StatusIcon = meta.icon;

	const logSources = useMemo(
		() => collectBuildLogSources(buildVerification, repairHistory),
		[buildVerification, repairHistory],
	);

	const [selectedLogSourceId, setSelectedLogSourceId] = useState<string | null>(null);

	const activeSource = useMemo(() => {
		if (selectedLogSourceId) {
			const selected = logSources.find((s) => s.id === selectedLogSourceId);
			if (selected) return selected;
		}
		return logSources.at(-1) ?? null;
	}, [logSources, selectedLogSourceId]);

	const logEntries = useMemo(
		() => parseBuildLogExcerpt(activeSource?.excerpt ?? buildVerification?.log_excerpt ?? ""),
		[activeSource, buildVerification?.log_excerpt],
	);

	const durationLabel = formatBuildVerificationDuration(buildVerification?.duration_seconds);
	const attempts = buildVerification?.attempts;
	const backend = buildVerification?.backend?.trim();
	const message = buildVerification?.message?.trim();
	const showPanel = Boolean(message || logSources.length > 0 || buildVerification);

	if (!showPanel) return null;

	const serviceLogsStatus =
		uiStatus === "passed" ? "success" : uiStatus === "failed" ? "error" : "not-started";

	return (
		<div className="mb-6 flex flex-col gap-4">
			<div className="rounded-2xl border border-white/5 bg-white/2 p-6 shadow-xl backdrop-blur-sm overflow-hidden relative">
				<div className="absolute top-0 left-0 w-full h-[2px] bg-white/5">
					<div
						className={`h-full transition-all duration-700 ease-out ${meta.barClass}`}
						style={{ width: uiStatus === "passed" ? "100%" : uiStatus === "failed" ? "100%" : "35%" }}
					/>
				</div>

				<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
					<div className="flex items-start gap-3 min-w-0">
						<div className={`p-2 rounded-xl shrink-0 ${meta.iconClass}`}>
							<StatusIcon className="size-6" />
						</div>
						<div className="min-w-0 space-y-1">
							<h3 className="text-lg font-bold text-foreground">{meta.title}</h3>
							<p className="text-sm text-muted-foreground/80">{meta.subtitle}</p>
							{message ? <p className="text-sm text-muted-foreground pt-1">{message}</p> : null}
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2 shrink-0">
						{backend ? (
							<span className="inline-flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs font-medium text-muted-foreground">
								<Hammer className="size-3.5 text-primary" />
								{backend}
							</span>
						) : null}
						{attempts != null && attempts > 0 ? (
							<span className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs font-medium text-muted-foreground">
								{attempts} attempt{attempts === 1 ? "" : "s"}
							</span>
						) : null}
						{durationLabel ? (
							<span className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs font-medium text-muted-foreground">
								{durationLabel}
							</span>
						) : null}
						{railpackVersion ? (
							<span className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs font-mono text-muted-foreground">
								{railpackVersion.replace(/^railpack version\s*/i, "v")}
							</span>
						) : null}
					</div>
				</div>

				{logSources.length > 1 ? (
					<div className="mt-4 flex flex-wrap gap-2">
						{logSources.map((source) => (
							<Button
								key={source.id}
								type="button"
								size="sm"
								variant={activeSource?.id === source.id ? "default" : "outline"}
								className="h-8 font-mono text-xs"
								onClick={() => setSelectedLogSourceId(source.id)}
							>
								{source.label}
								{source.result ? ` · ${source.result}` : ""}
							</Button>
						))}
					</div>
				) : null}
			</div>

			<div className="flex min-h-[280px] flex-col overflow-hidden rounded-2xl border border-white/5 bg-[#0A0A0F] shadow-2xl">
				{logEntries.length > 0 ? (
					<ServiceLogs
						key={`${repoName ?? ""}:${serviceName ?? ""}:${activeSource?.id ?? "verification"}`}
						logs={logEntries}
						repoName={repoName}
						serviceName={serviceName}
						deployStatus={serviceLogsStatus}
						displayLimit={5}
						scrollable={true}
					/>
				) : (
					<div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
						<p className="text-sm font-medium text-muted-foreground/80">No build log output captured</p>
						<p className="mt-1 max-w-md text-xs text-muted-foreground/60">
							{uiStatus === "skipped"
								? "Verification was skipped on sd-artifacts for this analyze run."
								: "Run Improve or re-analyze to produce a fresh build log."}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

export function shouldShowBuildVerificationPanel(results: SDArtifactsResponse): boolean {
	return Boolean(
		results.build_verification ||
			(results.repair_history?.length ?? 0) > 0 ||
			results.build_status === "passed" ||
			results.build_status === "failed" ||
			results.build_status === "skipped" ||
			results.build_status === "partial",
	);
}
