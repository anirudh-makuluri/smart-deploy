"use client";

import { useMemo, useState } from "react";
import type { DeployConfig, SDArtifactsResponse } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, CheckCircle2, Copy, RefreshCw, Rocket } from "lucide-react";
import { toast } from "sonner";
import { DocsMarkdown } from "@/components/public/DocsMarkdown";
import { classifyScanWorkload, workloadProductLabel } from "@/lib/sdArtifactsWorkload";

type SdArtifactsScanResultsProps = {
	results: SDArtifactsResponse;
	deployment: DeployConfig;
	packagePath?: string;
	scanTime?: number;
	onStartDeployment: () => void;
	onCancel: () => void;
	onStartImproveScan?: (payload: {
		repoUrl: string;
		commitSha?: string;
		packagePath?: string;
		feedback: string;
		failedArtifactScope?: string;
	}) => void;
};

function copyToClipboard(text: string) {
	void navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard"));
}

export default function SdArtifactsScanResults({
	results,
	packagePath,
	scanTime,
	deployment,
	onCancel,
	onStartDeployment,
	onStartImproveScan,
}: SdArtifactsScanResultsProps) {
	const [improveDialogOpen, setImproveDialogOpen] = useState(false);
	const [userFeedback, setUserFeedback] = useState("");

	const workload = useMemo(() => classifyScanWorkload(results), [results]);
	const fullPayloadJson = useMemo(() => {
		try {
			return JSON.stringify(results, null, 2);
		} catch {
			return String(results);
		}
	}, [results]);

	const buildOk = results.build_status === "passed" || results.build_status === "partial";
	const hasErrors = (results.errors?.length ?? 0) > 0;

	function handleImproveScanResults() {
		if (!deployment?.url || !onStartImproveScan) return;
		const template = [
			`Analyze: shape=${results.deploy_shape}, build=${results.build_status}.`,
			`Units: ${results.deploy_units.map((u) => u.name).join(", ") || "none"}.`,
			results.deploy_briefing ? `Briefing excerpt: ${results.deploy_briefing.slice(0, 400)}` : "",
			"Please improve the Railpack plan or build outcome.",
		]
			.filter(Boolean)
			.join("\n");
		const feedback = userFeedback.trim() ? `${template}\n\nAdditional feedback: ${userFeedback.trim()}` : template;
		onStartImproveScan({
			repoUrl: deployment.url,
			commitSha: results.commit_sha || (deployment.commitSha ?? undefined),
			packagePath,
			feedback,
			failedArtifactScope: "general",
		});
		setImproveDialogOpen(false);
		setUserFeedback("");
	}

	return (
		<div className="w-full flex-1 flex flex-col min-h-[600px] animate-in fade-in slide-in-from-bottom-4 duration-700">
			<div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 pb-6 border-b border-border">
				<div>
					<div className="flex items-center gap-3 mb-2">
						<span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
							<CheckCircle2 className="size-3" />
							Analysis complete
						</span>
						{scanTime != null && scanTime > 0 && (
							<span className="text-[10px] text-muted-foreground font-mono">
								{Math.round(scanTime / 1000)}s
							</span>
						)}
					</div>
					<h2 className="text-3xl font-bold tracking-tight text-foreground">Deploy briefing</h2>
					<p className="text-sm text-muted-foreground mt-1">
						{deployment.repoName}
						{deployment.serviceName !== "." ? ` / ${deployment.serviceName}` : ""}
						{packagePath && packagePath !== "." ? ` · ${packagePath}` : ""}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button variant="ghost" onClick={onCancel} className="text-muted-foreground">
						Reject
					</Button>
					{onStartImproveScan && (
						<Button variant="outline" onClick={() => setImproveDialogOpen(true)} className="gap-2">
							<RefreshCw className="size-4" />
							Improve
						</Button>
					)}
					<Button onClick={onStartDeployment} disabled={!buildOk} className="gap-2 font-semibold">
						<Rocket className="size-4" />
						Deploy
					</Button>
				</div>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
				<div className="rounded-xl border border-border bg-card p-4">
					<p className="text-[11px] uppercase tracking-wider text-muted-foreground">Shape</p>
					<p className="mt-1 font-mono text-sm font-medium">{results.deploy_shape}</p>
				</div>
				<div className="rounded-xl border border-border bg-card p-4">
					<p className="text-[11px] uppercase tracking-wider text-muted-foreground">Build</p>
					<p className={`mt-1 font-mono text-sm font-medium ${buildOk ? "text-emerald-600" : "text-amber-600"}`}>
						{results.build_status}
					</p>
				</div>
				<div className="rounded-xl border border-border bg-card p-4">
					<p className="text-[11px] uppercase tracking-wider text-muted-foreground">Railpack</p>
					<p className="mt-1 font-mono text-sm">{results.railpack_version ?? "—"}</p>
				</div>
				<div className="rounded-xl border border-border bg-card p-4">
					<p className="text-[11px] uppercase tracking-wider text-muted-foreground">Commit</p>
					<p className="mt-1 font-mono text-sm truncate">{results.commit_sha?.slice(0, 12) || "—"}</p>
				</div>
			</div>

			{hasErrors && (
				<div className="mb-6 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
					<AlertTriangle className="size-5 shrink-0 text-amber-600" />
					<ul className="list-disc list-inside space-y-1 text-amber-950 dark:text-amber-100">
						{results.errors.map((err) => (
							<li key={err}>{err}</li>
						))}
					</ul>
				</div>
			)}

			{results.deploy_briefing?.trim() && (
				<div className="mb-6 rounded-xl border border-border bg-card p-5">
					<div className="max-h-[32rem] overflow-auto pr-1">
						<DocsMarkdown source={results.deploy_briefing} />
					</div>
				</div>
			)}

			<div className="mb-6 rounded-xl border border-border bg-card p-5">
				<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Deploy units</p>
				<ul className="space-y-3">
					{results.deploy_units.map((unit) => {
						const start = unit.artifacts.railpack_plan?.deploy?.startCommand;
						return (
							<li key={unit.name} className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm">
								<div className="flex flex-wrap items-baseline justify-between gap-2">
									<span className="font-semibold text-foreground">{unit.name}</span>
									<span className="text-[10px] uppercase tracking-wide text-primary">
										{workload?.units.find((u) => u.name === unit.name)
											? workloadProductLabel(workload.units.find((u) => u.name === unit.name)!.product)
											: unit.type}
									</span>
								</div>
								<p className="mt-1 font-mono text-xs text-muted-foreground">
									{unit.root} · {unit.provider}
									{unit.framework ? ` · ${unit.framework}` : ""} · port {unit.port}
								</p>
								{start && (
									<p className="mt-2 font-mono text-xs text-muted-foreground break-all">
										start: {start}
									</p>
								)}
							</li>
						);
					})}
				</ul>
			</div>

			{results.build_verification?.message && (
				<div className="mb-6 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
					<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Build verification</p>
					<p>{results.build_verification.message}</p>
					{results.build_verification.log_excerpt && (
						<pre className="mt-3 max-h-40 overflow-auto rounded-md bg-muted/40 p-3 text-xs font-mono">
							{results.build_verification.log_excerpt}
						</pre>
					)}
				</div>
			)}

			<details className="rounded-xl border border-border bg-card">
				<summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					Full analyze payload
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 px-2"
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							copyToClipboard(fullPayloadJson);
						}}
					>
						<Copy className="size-3 mr-1" />
						Copy JSON
					</Button>
				</summary>
				<div className="border-t border-border p-4">
					<pre className="text-[11px] whitespace-pre-wrap break-words max-h-[28rem] overflow-auto font-mono text-muted-foreground">
						{fullPayloadJson}
					</pre>
				</div>
			</details>

			<AlertDialog open={improveDialogOpen} onOpenChange={setImproveDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Improve scan results</AlertDialogTitle>
						<AlertDialogDescription>
							Send feedback to sd-artifacts to refine the Railpack plan and build outcome.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<Textarea
						placeholder="e.g. Pin Node 20, fix monorepo filter, add health check..."
						value={userFeedback}
						onChange={(e) => setUserFeedback(e.target.value)}
						className="min-h-24"
					/>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<Button onClick={handleImproveScanResults} disabled={!onStartImproveScan}>
							Send feedback
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
