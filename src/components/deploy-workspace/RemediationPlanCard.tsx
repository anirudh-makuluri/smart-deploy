"use client";

import * as React from "react";
import { DeploymentRemediationAttempt } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type RemediationPlanCardProps = {
	attempt: DeploymentRemediationAttempt;
	onApprove?: () => void;
	onReject?: () => void;
	title?: string;
	description?: string;
	approveLabel?: string;
	rejectLabel?: string;
};

function renderDiffPreview(diffPreview: DeploymentRemediationAttempt["diff_preview"]) {
	if (!Array.isArray(diffPreview) || diffPreview.length === 0) {
		return <p className="text-sm text-muted-foreground">Diff preview is not available yet for this remediation attempt.</p>;
	}

	if (typeof diffPreview[0] === "string") {
		return (
			<div className="space-y-3">
				{(diffPreview as string[]).map((entry, index) => (
					<pre key={index} className="rounded-lg border border-border/40 bg-muted/40 p-3 text-xs whitespace-pre-wrap">
						{entry}
					</pre>
				))}
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{(diffPreview as Record<string, unknown>[]).map((entry, index) => (
				<div key={index} className="rounded-lg border border-border/40 bg-muted/30 p-4 space-y-3">
					<div>
						<p className="font-medium text-sm text-foreground">{String(entry.target ?? `Change ${index + 1}`)}</p>
						<p className="text-xs text-muted-foreground">{String(entry.summary ?? "")}</p>
					</div>
					{"before" in entry && typeof entry.before === "string" && (
						<pre className="rounded-md bg-background p-3 text-xs whitespace-pre-wrap border border-border/30">{entry.before}</pre>
					)}
					{"after" in entry && typeof entry.after === "string" && (
						<pre className="rounded-md bg-background p-3 text-xs whitespace-pre-wrap border border-border/30">{entry.after}</pre>
					)}
				</div>
			))}
		</div>
	);
}

export default function RemediationPlanCard({
	attempt,
	onApprove,
	onReject,
	title = "Proposed recovery plan",
	description,
	approveLabel = "Apply recovery plan",
	rejectLabel = "Reject",
}: RemediationPlanCardProps) {
	const [diffOpen, setDiffOpen] = React.useState(false);
	const retryLabel =
		typeof attempt.attempt_number === "number" && attempt.attempt_number > 0
			? `Retry attempt ${attempt.attempt_number}`
			: "Retry attempt";
	const hasDiffPreview = Array.isArray(attempt.diff_preview) && attempt.diff_preview.length > 0;

	return (
		<>
			<Alert className="border-amber-500/30 bg-amber-500/10 text-foreground">
				<AlertTitle className="font-semibold text-amber-600">{title}</AlertTitle>
				<AlertDescription className="space-y-4">
					{description && (
						<p className="text-sm text-muted-foreground">{description}</p>
					)}
					<div className="space-y-2">
						<p className="text-sm">{attempt.summary}</p>
						{attempt.root_cause && (
							<p className="text-sm text-muted-foreground">
								What I think went wrong: {attempt.root_cause}
							</p>
						)}
					</div>

					{(attempt.evidence?.length ?? 0) > 0 && (
						<div className="space-y-2">
							<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What I saw</p>
							<ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
								{attempt.evidence?.map((line, index) => <li key={index}>{line}</li>)}
							</ul>
						</div>
					)}

					{(attempt.changes?.length ?? 0) > 0 && (
						<div className="space-y-2">
							<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What I'll change</p>
							<ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
								{attempt.changes?.map((change, index) => (
									<li key={`${change.title}-${index}`}>
										<span className="font-medium text-foreground">{change.title}</span>
										{`: ${change.description}`}
									</li>
								))}
							</ul>
						</div>
					)}

					<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
						<span className="rounded-full border border-border/50 px-2 py-1">{retryLabel}</span>
						{attempt.risk_level && <span className="rounded-full border border-border/50 px-2 py-1">Risk: {attempt.risk_level}</span>}
						{typeof attempt.confidence === "number" && (
							<span className="rounded-full border border-border/50 px-2 py-1">Confidence: {Math.round(attempt.confidence * 100)}%</span>
						)}
					</div>

					<div className="flex flex-wrap gap-3">
						{hasDiffPreview && (
							<Button variant="outline" size="sm" onClick={() => setDiffOpen(true)}>
								Review diff
							</Button>
						)}
						<Button size="sm" disabled={!onApprove} onClick={onApprove}>
							{approveLabel}
						</Button>
						<Button variant="ghost" size="sm" disabled={!onReject} onClick={onReject}>
							{rejectLabel}
						</Button>
					</div>
				</AlertDescription>
			</Alert>

			<Sheet open={diffOpen} onOpenChange={setDiffOpen}>
				<SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
					<SheetHeader>
						<SheetTitle>Recovery diff</SheetTitle>
						<SheetDescription>
							These are the exact deployment artifact changes Smart Deploy wants to use for the retry.
						</SheetDescription>
					</SheetHeader>
					<div className="mt-6">
						{renderDiffPreview(attempt.diff_preview)}
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}
