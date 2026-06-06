import * as React from "react";
import { Terminal } from "lucide-react";
import { SDArtifactsResponse } from "@/app/types";
import { Button } from "@/components/ui/button";
import { ScanProgressLogsPanel } from "@/components/scan-progress/ScanProgressLogsPanel";
import { ScanProgressNodeList } from "@/components/scan-progress/ScanProgressNodeList";
import { useScanProgress } from "@/components/scan-progress/useScanProgress";

type ScanProgressProps = {
	/** Full GitHub repo URL (e.g. https://github.com/owner/repo). */
	repoUrl: string;
	/** Repo-relative package root for this service (monorepo); forwarded as package_path. */
	packagePath: string;
	/** Branch whose HEAD commit is sent as commit_sha (always fetched from GitHub). */
	branch: string;
	repoName: string;
	serviceName: string;
	onComplete: (data: SDArtifactsResponse) => void;
	onCancel: () => void;
};

export default function ScanProgress({
	repoUrl,
	packagePath,
	branch,
	repoName,
	serviceName,
	onComplete,
	onCancel,
}: ScanProgressProps) {
	const { state, logsEndRef } = useScanProgress({
		repoUrl,
		packagePath,
		branch,
		repoName,
		serviceName,
		onComplete,
	});

	return (
		<div className="w-full flex-1 flex flex-col min-h-[600px] bg-background/50 animate-in fade-in duration-500">
			<div className="flex items-center gap-3 mb-6">
				<div className="p-2 bg-primary/10 rounded-lg">
					<Terminal className="size-5 text-primary" />
				</div>
				<div>
					<h2 className="text-xl font-semibold text-foreground tracking-tight">Analysis in Progress</h2>
					<p className="text-sm text-muted-foreground">
						Progress follows the sd-artifacts pipeline: scan, classify, Railpack prepare, briefing, verified build, finalize
					</p>
				</div>
			</div>

			<div className="flex flex-col lg:flex-row gap-6 h-full">
				<ScanProgressNodeList
					activeNode={state.activeNode}
					completedNodes={state.completedNodes}
					failedNode={state.failedNode}
				/>
				<ScanProgressLogsPanel logs={state.logs} progress={state.progress} logsEndRef={logsEndRef} />
			</div>

			<div className="flex items-center justify-end gap-3 mt-8 pt-6 border-t border-border/30">
				<Button variant="outline" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
					Cancel Analysis
				</Button>
				<Button disabled className="bg-primary/20 text-primary-foreground opacity-50">
					Awaiting Verification
				</Button>
			</div>
		</div>
	);
}
