import * as React from "react";
import { ExternalLink, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeployConfig, repoType } from "@/app/types";
import {
	formatTimestamp,
	formatDeploymentTargetName,
	getDeploymentDisplayUrl,
} from "@/lib/utils";
import DeployOptions from "@/components/DeployOptions";

type DeployOverviewProps = {
	deployment: DeployConfig;
	region?: string;
	successRate?: number;
	isDeploying?: boolean;
	onRedeploy?: (commitSha?: string) => void;
	onEditConfiguration?: () => void;
	repo?: repoType;
};

export default function DeployOverview({
	deployment,
	region = "us-west-2",
	successRate = 98.8,
	isDeploying = false,
	onRedeploy,
	onEditConfiguration,
	repo,
}: DeployOverviewProps) {
	const displayUrl = getDeploymentDisplayUrl(deployment);

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<p className="text-2xl font-semibold text-foreground">{deployment.service_name}</p>
					<span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
						<span className="h-2 w-2 rounded-full bg-primary" />
						{deployment.status ?? "running"}
					</span>
				</div>
				<div className="flex items-center gap-2">
					{onEditConfiguration && (
						<Button
							onClick={onEditConfiguration}
							variant="outline"
							className="inline-flex items-center gap-2 rounded-md border-border bg-transparent text-foreground hover:bg-secondary/50 hover:text-foreground"
						>
							<Settings className="size-4" />
							Edit Configuration
						</Button>
					)}
					{onRedeploy && (
						<DeployOptions
							onDeploy={onRedeploy}
							disabled={isDeploying}
							repo={repo}
							branch={deployment.branch || "main"}
						/>
					)}
					{displayUrl && (
						<a
							href={displayUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
						>
							Visit Site
							<ExternalLink className="size-4" />
						</a>
					)}
				</div>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<div className="space-y-6">
					<div className="rounded-xl border border-border bg-card">
						<div className="flex items-center justify-between border-b border-border px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">
							<span>Front page preview</span>
							<span className="text-muted-foreground/70">Live topology</span>
						</div>
						{displayUrl ? (
							<div className="relative h-80 md:h-96">
								<iframe
									src={displayUrl}
									title={`Snapshot of ${deployment.service_name}`}
									className="absolute inset-0 h-full w-full pointer-events-none overflow-hidden rounded-b-lg"
									loading="lazy"
								/>
							</div>
						) : (
							<div className="p-6 text-sm text-muted-foreground">
								No live URL yet. Deploy to generate a preview snapshot.
							</div>
						)}
					</div>

					<div className="rounded-xl border border-border bg-card">
						<div className="grid grid-cols-1 divide-y divide-border text-sm text-muted-foreground">
							<div className="flex items-center justify-between px-4 py-3">
								<span>Deployed Service</span>
								<span className="text-foreground">
									{deployment.deploymentTarget
										? formatDeploymentTargetName(deployment.deploymentTarget)
										: "Pending"}
								</span>
							</div>
							<div className="flex items-center justify-between px-4 py-3">
								<span>Live URL</span>
								{displayUrl ? (
									<a
										href={displayUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-primary hover:underline"
									>
										{displayUrl}
									</a>
								) : (
									<span className="text-muted-foreground/70">Not available</span>
								)}
							</div>
							<div className="flex items-center justify-between px-4 py-3">
								<span>Revision</span>
								<span className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground">
									{deployment.revision ?? 1}
								</span>
							</div>
						</div>
					</div>
				</div>

				<div className="space-y-4">
					<div className="rounded-xl border border-border bg-card p-4">
						<p className="text-xs uppercase tracking-wider text-muted-foreground">Last Deployment</p>
						<p className="mt-2 text-lg font-semibold text-foreground">
							{formatTimestamp(deployment.last_deployment)}
						</p>
					</div>
					<div className="rounded-xl border border-border bg-card p-4">
						<p className="text-xs uppercase tracking-wider text-muted-foreground">Environment</p>
						<p className="mt-2 text-sm font-semibold text-foreground">Production</p>
					</div>
					<div className="rounded-xl border border-border bg-card p-4">
						<p className="text-xs uppercase tracking-wider text-muted-foreground">Region</p>
						<p className="mt-2 text-sm font-semibold text-foreground">{region}</p>
					</div>
					<div className="rounded-xl border border-border bg-card p-4">
						<div className="flex items-center justify-between">
							<p className="text-xs uppercase tracking-wider text-muted-foreground">Success Rate</p>
							<p className="text-xs font-semibold text-primary">{successRate.toFixed(1)}%</p>
						</div>
						<div className="mt-3 grid grid-cols-7 gap-1">
							{[40, 55, 35, 60, 48, 72, 80].map((value, index) => (
								<div key={index} className="flex h-10 items-end">
									<div
										style={{ height: `${value}%` }}
										className={`w-full rounded-sm ${
											index > 4 ? "bg-primary" : "bg-emerald-950/60"
										}`}
									/>
								</div>
							))}
						</div>
						<div className="mt-2 flex justify-between text-xs text-muted-foreground/70">
							<span>7 days ago</span>
							<span>Today</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
