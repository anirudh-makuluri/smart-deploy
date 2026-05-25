"use client";

import * as React from "react";
import type { DeploymentHistoryEntry } from "@/app/types";
import { Badge } from "@/components/ui/badge";
import { summarizeDeploymentHistoryPhase2 } from "@/lib/deploymentHistorySummary";

function badgeClassName(tone: "default" | "success" | "warning" | "danger") {
	switch (tone) {
		case "success":
			return "border-emerald-500/60 text-emerald-400 bg-emerald-500/10";
		case "warning":
			return "border-amber-500/60 text-amber-400 bg-amber-500/10";
		case "danger":
			return "border-destructive/60 text-destructive bg-destructive/10";
		default:
			return "border-border/60 text-muted-foreground bg-background/80";
	}
}

type DeploymentHistoryPhase2DetailsProps = {
	entry: DeploymentHistoryEntry;
	compact?: boolean;
};

export default function DeploymentHistoryPhase2Details({
	entry,
	compact = false,
}: DeploymentHistoryPhase2DetailsProps) {
	const summary = summarizeDeploymentHistoryPhase2(entry);
	const remediationAttempts = entry.remediationAttempts ?? [];
	const healthChecks = entry.healthChecks ?? [];

	if (!summary.primaryLabel && remediationAttempts.length === 0 && healthChecks.length === 0) {
		return null;
	}

	if (compact) {
		return (
			<div className="flex flex-wrap items-center gap-2 text-xs">
				{summary.primaryLabel && <span className="text-muted-foreground">{summary.primaryLabel}</span>}
				{summary.badges.map((badge) => (
					<Badge key={badge.label} variant="outline" className={badgeClassName(badge.tone)}>
						{badge.label}
					</Badge>
				))}
			</div>
		);
	}

	return (
		<div className="space-y-4 rounded-lg border border-border/60 bg-background/40 p-4">
			<div className="flex flex-wrap items-center gap-2">
				{summary.primaryLabel && (
					<Badge variant="outline" className={badgeClassName(summary.primaryTone)}>
						{summary.primaryLabel}
					</Badge>
				)}
				{summary.badges.map((badge) => (
					<Badge key={badge.label} variant="outline" className={badgeClassName(badge.tone)}>
						{badge.label}
					</Badge>
				))}
			</div>

			{healthChecks.length > 0 && (
				<div className="space-y-2">
					<p className="text-xs font-medium text-muted-foreground">Health timeline</p>
					<div className="space-y-2">
						{healthChecks.map((check) => (
							<div key={check.id} className="rounded-md border border-border/50 bg-background/70 p-3 text-sm">
								<div className="flex flex-wrap items-center gap-2">
									<Badge
										variant="outline"
										className={badgeClassName(check.status === "healthy" ? "success" : "warning")}
									>
										{check.status.replace(/_/g, " ")}
									</Badge>
									<span className="text-muted-foreground">{new Date(check.checked_at).toLocaleString()}</span>
									{typeof check.http_status === "number" && <span className="text-muted-foreground">HTTP {check.http_status}</span>}
									{typeof check.latency_ms === "number" && <span className="text-muted-foreground">{check.latency_ms}ms</span>}
								</div>
								{check.error_message && <p className="mt-2 text-muted-foreground">{check.error_message}</p>}
							</div>
						))}
					</div>
				</div>
			)}

			{remediationAttempts.length > 0 && (
				<div className="space-y-2">
					<p className="text-xs font-medium text-muted-foreground">Remediation attempts</p>
					<div className="space-y-2">
						{remediationAttempts.map((attempt) => (
							<div key={attempt.id} className="rounded-md border border-border/50 bg-background/70 p-3 text-sm">
								<div className="flex flex-wrap items-center gap-2">
									<Badge
										variant="outline"
										className={badgeClassName(
											attempt.status === "rejected"
												? "warning"
												: attempt.status === "approved" || attempt.applied
													? "success"
													: attempt.status === "failed"
														? "danger"
														: "default"
										)}
									>
										Attempt {attempt.attempt_number}: {attempt.status.replace(/_/g, " ")}
									</Badge>
									<span className="text-muted-foreground">
										{attempt.trigger_type === "post_deploy_unhealthy" ? "Monitoring issue" : "Deploy failure"}
									</span>
								</div>
								<p className="mt-2 text-foreground">{attempt.summary}</p>
								{attempt.expected_outcome && <p className="mt-1 text-muted-foreground">{attempt.expected_outcome}</p>}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
