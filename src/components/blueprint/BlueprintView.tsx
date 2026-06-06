"use client";

import PreviewModeView from "@/components/blueprint/PreviewModeView";
import type { DeployConfig, SDArtifactsResponse } from "@/app/types";
import { isSdArtifactsAnalyzeScan } from "@/lib/scanResultNormalization";
import { Button } from "@/components/ui/button";
import { Boxes, Layers, Rocket, ShieldCheck } from "lucide-react";

type BlueprintViewProps = {
	deployment: DeployConfig;
	scanResults: SDArtifactsResponse | null;
	branchOptions: string[];
	onStartScan?: () => void;
	onUpdateDeployment: (partial: Partial<DeployConfig>) => Promise<void> | void;
	onUpdateScanResults: (updater: (current: SDArtifactsResponse) => SDArtifactsResponse) => Promise<void> | void;
};

function PreviewNeedsAnalysis({ onStartScan }: { onStartScan?: () => void }) {
	return (
		<div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-1 items-center justify-center p-12">
			<div className="w-full space-y-6 rounded-2xl border border-border bg-card p-12 text-center shadow-xl">
				<div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
					<Boxes className="size-8 text-primary" />
				</div>
				<div className="space-y-2">
					<h2 className="text-2xl font-bold">Run Smart Analysis to see the preview</h2>
					<p className="mx-auto max-w-md text-muted-foreground">
						The deploy preview is built from your analyze results — deploy units, build path, and whether
						this workload routes to S3 + CloudFront or ECS Fargate.
					</p>
				</div>
				{onStartScan ? (
					<div className="pt-2">
						<Button type="button" size="lg" onClick={onStartScan} className="gap-2 px-8 font-bold">
							<Rocket className="size-5" />
							Start Smart Analysis
						</Button>
					</div>
				) : null}
				<div className="grid grid-cols-3 gap-4 border-t border-border/50 pt-8">
					<div className="flex flex-col items-center gap-2">
						<ShieldCheck className="size-5 text-emerald-500" />
						<span className="text-xs font-medium">Deploy units</span>
					</div>
					<div className="flex flex-col items-center gap-2">
						<Layers className="size-5 text-blue-500" />
						<span className="text-xs font-medium">Build plan</span>
					</div>
					<div className="flex flex-col items-center gap-2">
						<Boxes className="size-5 text-purple-500" />
						<span className="text-xs font-medium">Routing target</span>
					</div>
				</div>
			</div>
		</div>
	);
}

export default function BlueprintView({ onStartScan, scanResults, ...props }: BlueprintViewProps) {
	if (!isSdArtifactsAnalyzeScan(scanResults)) {
		return <PreviewNeedsAnalysis onStartScan={onStartScan} />;
	}

	return <PreviewModeView {...props} scanResults={scanResults} />;
}
