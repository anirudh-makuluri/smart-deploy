"use client";

import * as React from "react";
import {
	Activity,
	AlertTriangle,
	Boxes,
	ChevronDown,
	ExternalLink,
	GitBranch,
	Globe,
	History,
} from "lucide-react";
import {
	getDeploymentStatusDisplay,
	getHealthStatusDisplay,
	shortCommitSha,
} from "@/components/deployment-agent-sheet/agentStatusDisplay";
import { Badge } from "@/components/ui/badge";
import type {
	AgentDeploymentDetails,
	AgentDeploymentSummary,
	AgentHistoryEntry,
	AgentRuntimeHealthEntry,
	AgentStructuredData,
	AgentStructuredDataBlock,
} from "@/lib/deploymentAgent/structuredData";
import { formatTimestamp } from "@/lib/utils";
import { cn } from "@/lib/utils";

type AgentStructuredDataBlocksProps = {
	data: AgentStructuredData;
};

function StatusBadge({ status, variant }: { status: string; variant: "deployment" | "health" }) {
	const display =
		variant === "health" ? getHealthStatusDisplay(status) : getDeploymentStatusDisplay(status);

	return (
		<Badge
			variant="outline"
			className={cn(
				"shrink-0 gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]",
				display.badgeClassName
			)}
		>
			<span className={cn("size-1.5 rounded-full", display.dotClassName)} />
			{display.label}
		</Badge>
	);
}

function MetaItem({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="min-w-0">
			<div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
			<div className="truncate text-xs text-foreground">{value}</div>
		</div>
	);
}

function OpenAppLink({ href }: { href: string }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
		>
			Open app
			<ExternalLink className="size-3" />
		</a>
	);
}

function DeploymentSummaryCard({ deployment }: { deployment: AgentDeploymentSummary }) {
	return (
		<div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-muted/20 p-4">
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium text-foreground">
						{deployment.repoName}
						<span className="text-muted-foreground"> / </span>
						{deployment.serviceName}
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
						<span className="inline-flex min-w-0 items-center gap-1">
							<GitBranch className="size-3 shrink-0" />
							<span className="truncate">{deployment.branch}</span>
						</span>
						<span className="shrink-0">{deployment.deploymentTarget.toUpperCase()}</span>
					</div>
				</div>
				<StatusBadge status={deployment.status} variant="deployment" />
			</div>
			<div className="mt-3 flex flex-wrap items-center justify-between gap-2">
				<span className="min-w-0 text-[11px] text-muted-foreground">
					{deployment.lastDeployment
						? `Last deployed ${formatTimestamp(deployment.lastDeployment)}`
						: "Never deployed"}
				</span>
				{(deployment.hostedUrl && deployment.status === "running") ? <OpenAppLink href={deployment.hostedUrl} /> : null}
			</div>
		</div>
	);
}

function DeploymentListBlock({ deployments }: { deployments: AgentDeploymentSummary[] }) {
	return (
		<section className="min-w-0 space-y-2">
			<div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
				<Boxes className="size-3.5 shrink-0" />
				<span className="truncate">Deployments ({deployments.length})</span>
			</div>
			<div className="space-y-2">
				{deployments.map((deployment) => (
					<DeploymentSummaryCard
						key={`${deployment.repoName}:${deployment.serviceName}`}
						deployment={deployment}
					/>
				))}
			</div>
		</section>
	);
}

function DeploymentDetailsBlock({ deployment }: { deployment: AgentDeploymentDetails }) {
	return (
		<section className="min-w-0 space-y-2">
			<div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
				<Globe className="size-3.5 shrink-0" />
				Deployment details
			</div>
			<div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-muted/20 p-4">
				<div className="flex items-start gap-2">
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-medium text-foreground">
							{deployment.repoName}
							<span className="text-muted-foreground"> / </span>
							{deployment.serviceName}
						</div>
						<div className="mt-1 truncate text-[11px] text-muted-foreground">
							{deployment.region} · {deployment.deploymentTarget.toUpperCase()}
						</div>
					</div>
					<StatusBadge status={deployment.status} variant="deployment" />
				</div>

				<div className="mt-3 grid grid-cols-2 gap-3">
					<MetaItem label="Branch" value={deployment.branch} />
					<MetaItem label="Commit" value={shortCommitSha(deployment.commitSha)} />
					<MetaItem label="Revision" value={deployment.revision ?? "—"} />
					<MetaItem
						label="Last deployed"
						value={deployment.lastDeployment ? formatTimestamp(deployment.lastDeployment) : "Never"}
					/>
					{deployment.scanResults.deployShape ? (
						<MetaItem label="Shape" value={deployment.scanResults.deployShape} />
					) : null}
					{deployment.scanResults.buildStatus ? (
						<MetaItem label="Build" value={deployment.scanResults.buildStatus} />
					) : null}
				</div>

				{deployment.scanResults.deployUnits.length > 0 ? (
					<div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
						<div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							Deploy units
						</div>
						{deployment.scanResults.deployUnits.map((unit) => (
							<div
								key={unit.name}
								className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md border border-border/50 bg-background/50 px-2 py-1.5 text-xs"
							>
								<span className="min-w-0 truncate font-medium">{unit.name}</span>
								<span className="min-w-0 truncate text-muted-foreground">
									{unit.framework ?? unit.type} · {unit.provider} · :{unit.port}
								</span>
							</div>
						))}
					</div>
				) : null}

				{(deployment.hostedUrl && deployment.status === "running") ? (
					<div className="mt-3 flex justify-end">
						<OpenAppLink href={deployment.hostedUrl} />
					</div>
				) : null}
			</div>
		</section>
	);
}

function HealthMetric({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="rounded-md border border-border/50 bg-background/50 px-2.5 py-2">
			<div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
			<div className="mt-0.5 text-sm font-medium text-foreground">{value}</div>
		</div>
	);
}

function RuntimeHealthBlock({
	repoName,
	serviceName,
	entries,
}: {
	repoName: string;
	serviceName: string;
	entries: AgentRuntimeHealthEntry[];
}) {
	const latest = entries[0];
	if (!latest) return null;

	return (
		<section className="min-w-0 space-y-2">
			<div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
				<Activity className="size-3.5 shrink-0" />
				<span className="truncate">
					Runtime health · {repoName}/{serviceName}
				</span>
			</div>
			<div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-muted/20 p-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<StatusBadge status={latest.appStatus} variant="health" />
					<span className="min-w-0 text-[11px] text-muted-foreground">
						Checked {formatTimestamp(latest.checkedAt)}
					</span>
				</div>

				<div className="mt-3 grid grid-cols-2 gap-2">
					<HealthMetric label="HTTP status" value={latest.httpStatus ?? "—"} />
					<HealthMetric
						label="Latency"
						value={latest.latencyMs !== null ? `${latest.latencyMs} ms` : "—"}
					/>
					<HealthMetric label="ECS status" value={latest.ecsStatus ?? "—"} />
					<HealthMetric label="Rollout" value={latest.rolloutState ?? "—"} />
					<HealthMetric
						label="Healthy targets"
						value={
							latest.healthyTargets !== null && latest.unhealthyTargets !== null
								? `${latest.healthyTargets} / ${latest.healthyTargets + latest.unhealthyTargets}`
								: "—"
						}
					/>
				</div>

				{entries.length > 1 ? (
					<div className="mt-3 border-t border-border/50 pt-2">
						<div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							Recent checks
						</div>
						<ul className="mt-1.5 space-y-1">
							{entries.slice(1, 4).map((entry) => (
								<li
									key={entry.checkedAt}
									className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground"
								>
									<span className="min-w-0 truncate">{formatTimestamp(entry.checkedAt)}</span>
									<span className="inline-flex items-center gap-1.5">
										<span
											className={cn(
												"size-1.5 rounded-full",
												getHealthStatusDisplay(entry.appStatus).dotClassName
											)}
										/>
										{entry.latencyMs !== null ? `${entry.latencyMs} ms` : entry.appStatus}
									</span>
								</li>
							))}
						</ul>
					</div>
				) : null}
			</div>
		</section>
	);
}

function HistoryEntryRow({ entry }: { entry: AgentHistoryEntry }) {
	const [logsExpanded, setLogsExpanded] = React.useState(false);

	return (
		<div
			className={cn(
				"min-w-0 overflow-hidden rounded-lg border px-4 py-3",
				entry.success
					? "border-border/70 bg-muted/10"
					: "border-destructive/30 bg-destructive/5"
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<Badge
							variant="outline"
							className={cn(
								"rounded-full px-2 py-0.5 text-[10px]",
								entry.success
									? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
									: "border-destructive/40 bg-destructive/10 text-destructive"
							)}
						>
							{entry.success ? "Success" : "Failed"}
						</Badge>
						<span className="text-[11px] text-muted-foreground">{formatTimestamp(entry.timestamp)}</span>
					</div>
					<div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-foreground">
						{entry.branch ? (
							<span className="inline-flex items-center gap-1 text-muted-foreground">
								<GitBranch className="size-3" />
								{entry.branch}
							</span>
						) : null}
						<span className="font-mono text-[11px]">{shortCommitSha(entry.commitSha)}</span>
					</div>
				</div>
			</div>

			{!entry.success && (entry.failedStep || entry.failureSummary) ? (
				<div className="mt-2.5 rounded-md border border-destructive/20 bg-background/60 p-2.5">
					<div className="flex items-start gap-2">
						<AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
						<div className="min-w-0 space-y-1">
							{entry.failedStep ? (
								<div className="text-xs font-medium text-destructive">Failed at: {entry.failedStep}</div>
							) : null}
							{entry.failureSummary ? (
								<div className="break-words text-xs leading-relaxed text-muted-foreground">
									{entry.failureSummary}
								</div>
							) : null}
						</div>
					</div>
				</div>
			) : null}

			{entry.recentLogs.length > 0 ? (
				<div className="mt-2">
					<button
						type="button"
						onClick={() => setLogsExpanded((value) => !value)}
						className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
						aria-expanded={logsExpanded}
					>
						<ChevronDown className={cn("size-3 transition-transform", logsExpanded && "rotate-180")} />
						{logsExpanded ? "Hide logs" : `Show ${entry.recentLogs.length} log lines`}
					</button>
					{logsExpanded ? (
						<pre className="mt-2 max-h-40 overflow-x-auto overflow-y-auto rounded-md border border-border/60 bg-background/80 p-2 text-[10px] leading-relaxed break-all text-muted-foreground">
							{entry.recentLogs.join("\n")}
						</pre>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function DeploymentHistoryBlock({
	repoName,
	serviceName,
	history,
}: {
	repoName: string;
	serviceName: string;
	history: AgentHistoryEntry[];
}) {
	return (
		<section className="min-w-0 space-y-2">
			<div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
				<History className="size-3.5 shrink-0" />
				<span className="truncate">
					Deployment history · {repoName}/{serviceName}
				</span>
			</div>
			<div className="space-y-2">
				{history.map((entry) => (
					<HistoryEntryRow key={entry.id} entry={entry} />
				))}
			</div>
		</section>
	);
}

function StructuredDataBlock({ block }: { block: AgentStructuredDataBlock }) {
	switch (block.kind) {
		case "deployment_list":
			return <DeploymentListBlock deployments={block.deployments} />;
		case "deployment_details":
			return <DeploymentDetailsBlock deployment={block.deployment} />;
		case "runtime_health":
			return (
				<RuntimeHealthBlock
					repoName={block.repoName}
					serviceName={block.serviceName}
					entries={block.entries}
				/>
			);
		case "deployment_history":
			return (
				<DeploymentHistoryBlock
					repoName={block.repoName}
					serviceName={block.serviceName}
					history={block.history}
				/>
			);
		default:
			return null;
	}
}

export function AgentStructuredDataBlocks({ data }: AgentStructuredDataBlocksProps) {
	if (data.blocks.length === 0) {
		return null;
	}

	return (
		<div className="min-w-0 w-full max-w-full space-y-3">
			{data.blocks.map((block, index) => (
				<StructuredDataBlock key={`${block.kind}-${index}`} block={block} />
			))}
		</div>
	);
}
