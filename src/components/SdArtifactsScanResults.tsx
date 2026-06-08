"use client";

import { useMemo, useState } from "react";
import type { DeployConfig, SDArtifactsResponse } from "@/app/types";
import { BuildConfigurationSection } from "@/components/sd-artifacts-scan-results/BuildConfigurationSection";
import { BuildVerificationPanel } from "@/components/sd-artifacts-scan-results/BuildVerificationPanel";
import { ImproveScanDialog } from "@/components/sd-artifacts-scan-results/ImproveScanDialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Copy, RefreshCw, Rocket } from "lucide-react";
import { toast } from "sonner";
import { DocsMarkdown } from "@/components/public/DocsMarkdown";
import { classifyScanWorkload } from "@/lib/sdArtifactsWorkload";
import { shouldShowBuildVerificationPanel } from "@/lib/buildVerificationLogs";

type SdArtifactsScanResultsProps = {
	results: SDArtifactsResponse;
	deployment: DeployConfig;
	packagePath?: string;
	scanTime?: number;
	onStartDeployment: () => void;
	onCancel: () => void;
	onUpdateResults?: (results: SDArtifactsResponse) => Promise<void> | void;
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
	onUpdateResults,
	onStartImproveScan,
}: SdArtifactsScanResultsProps) {
	const [improveDialogOpen, setImproveDialogOpen] = useState(false);

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

	return (
		<div className="w-full flex-1 flex flex-col min-h-[600px] animate-in fade-in slide-in-from-bottom-4 duration-700">
			<div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 pb-6 border-b border-border">
				<div>
					<div className="flex items-center gap-3 mb-2">
						<span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
							<CheckCircle2 className="size-3" />
							Analysis complete
						</span>
						{scanTime != null && scanTime > 0 ? (
							<span className="text-[10px] text-muted-foreground font-mono">
								{Math.round(scanTime / 1000)}s
							</span>
						) : null}
					</div>
					<h2 className="text-3xl font-bold tracking-tight text-foreground">Build Analysis</h2>
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
					{onStartImproveScan ? (
						<Button variant="outline" onClick={() => setImproveDialogOpen(true)} className="gap-2">
							<RefreshCw className="size-4" />
							Improve
						</Button>
					) : null}
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

			{hasErrors ? (
				<div className="mb-6 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
					<AlertTriangle className="size-5 shrink-0 text-amber-600" />
					<ul className="list-disc list-inside space-y-1 text-amber-950 dark:text-amber-100">
						{results.errors.map((err) => (
							<li key={err}>{err}</li>
						))}
					</ul>
				</div>
			) : null}

			<BuildConfigurationSection
				results={results}
				workload={workload}
				buildOk={buildOk}
				onUpdateResults={onUpdateResults}
			/>

			{shouldShowBuildVerificationPanel(results) ? (
				<BuildVerificationPanel
					buildStatus={results.build_status}
					buildVerification={results.build_verification}
					repairHistory={results.repair_history}
					railpackVersion={results.railpack_version}
					repoName={deployment.repoName}
					serviceName={deployment.serviceName}
				/>
			) : null}

			{results.deploy_briefing?.trim() ? (
				<div className="mb-6 rounded-xl border border-border bg-card p-5">
					<div className="max-h-128 overflow-auto pr-1">
						<DocsMarkdown source={results.deploy_briefing} />
					</div>
				</div>
			) : null}

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
					<pre className="text-[11px] whitespace-pre-wrap wrap-break-word max-h-112 overflow-auto font-mono text-muted-foreground">
						{fullPayloadJson}
					</pre>
				</div>
			</details>

			<ImproveScanDialog
				open={improveDialogOpen}
				onOpenChange={setImproveDialogOpen}
				results={results}
				deployment={deployment}
				packagePath={packagePath}
				onStartImproveScan={onStartImproveScan}
			/>
		</div>
	);
}
