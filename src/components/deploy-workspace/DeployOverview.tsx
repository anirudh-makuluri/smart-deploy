import Image from "next/image";
import { ExternalLink, Link2, Pause, RefreshCw, Settings, Trash2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeployConfig, repoType, type RuntimeHealthSample } from "@/app/types";
import { isEcsCloudResources, isStaticS3CloudResources } from "@/lib/cloudResources";
import { getDeploymentHostedUrl } from "@/lib/hostedUrl";
import { canManageRuntimeDeploymentStatus, isLiveDeploymentStatus, resolveDeploymentStatus } from "@/lib/deploymentStatus";
import {
	formatTimestamp,
	formatDeploymentTargetName,
	getDeploymentDisplayUrl,
	isDeploymentDisabled,
} from "@/lib/utils";
import { resolveWorkspaceBranch } from "@/lib/repoBranch";
import DeployOptions from "@/components/DeployOptions";

type DeployOverviewProps = {
	deployment: DeployConfig;
	region?: string;
	deployDisabled?: boolean;
	deployDisabledReason?: string;
	runtimeHealthEntries?: RuntimeHealthSample[];
	viewState?: DeployOverviewViewState;
	onRedeploy?: (commitSha?: string) => void;
	onRefreshPreview?: () => void;
	onEditConfiguration?: () => void;
	onPauseResumeDeployment?: () => void;
	onDeleteDeployment?: () => void;
	repo?: repoType;
};

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const EMPTY_RUNTIME_HEALTH_ENTRIES: RuntimeHealthSample[] = [];

type DeployOverviewViewState = {
	isDeploying: boolean;
	isRefreshingPreview: boolean;
	isLoadingRuntimeHealth: boolean;
	isChangingDeploymentState: boolean;
};

const DEFAULT_DEPLOY_OVERVIEW_VIEW_STATE: DeployOverviewViewState = {
	isDeploying: false,
	isRefreshingPreview: false,
	isLoadingRuntimeHealth: false,
	isChangingDeploymentState: false,
};

function hrefForEndpoint(raw: string): string | undefined {
	const t = raw.trim();
	if (!t) return undefined;
	if (/^https?:\/\//i.test(t)) return t;
	if (IPV4_RE.test(t)) return `http://${t}`;
	return undefined;
}

function EndpointRow({ label, value }: { label: string; value: string | undefined }) {
	const v = value?.trim();
	if (!v) {
		return (
			<div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
				<span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
				<span className="text-sm text-muted-foreground/70">-</span>
			</div>
		);
	}
	const href = hrefForEndpoint(v);
	return (
		<div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
			<span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
			{href ? (
				<a
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					className="min-w-0 break-all text-right text-sm font-medium text-primary hover:underline sm:text-left"
				>
					<span className="inline-flex items-start justify-end gap-1 sm:justify-start">
						<span className="min-w-0">{v}</span>
						<ExternalLink className="mt-0.5 size-3.5 shrink-0 opacity-70" aria-hidden />
					</span>
				</a>
			) : (
				<span className="break-all text-sm text-foreground">{v}</span>
			)}
		</div>
	);
}

function healthToneClasses(status: RuntimeHealthSample["app"]["overallStatus"]): string {
	if (status === "healthy") return "bg-emerald-500";
	if (status === "degraded") return "bg-amber-500";
	if (status === "unreachable") return "bg-destructive";
	return "bg-muted-foreground";
}

function statusLabel(status: RuntimeHealthSample["app"]["overallStatus"]): string {
	if (status === "healthy") return "Healthy";
	if (status === "degraded") return "Degraded";
	if (status === "unreachable") return "Unreachable";
	return "Unknown";
}

function RuntimeHealthCard({
	entries,
	isLoading,
}: {
	entries: RuntimeHealthSample[];
	isLoading: boolean;
}) {
	const latest = entries[entries.length - 1] ?? null;

	return (
		<div className="rounded-xl border border-border bg-card p-4">
			<div className="flex items-start justify-between gap-4">
				<div>
					<p className="text-xs uppercase tracking-wider text-muted-foreground">Runtime Health</p>
					<p className="mt-2 text-lg font-semibold text-foreground">
						{latest ? statusLabel(latest.app.overallStatus) : "No samples yet"}
					</p>
				</div>
				{latest ? (
					<span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-wide text-foreground">
						<span className={`h-2 w-2 rounded-full ${healthToneClasses(latest.app.overallStatus)}`} />
						{statusLabel(latest.app.overallStatus)}
					</span>
				) : null}
			</div>

			{isLoading ? (
				<p className="mt-4 text-sm text-muted-foreground">Loading monitoring samples...</p>
			) : latest ? (
				<div className="mt-4 space-y-4">
					<div className="grid gap-3 md:grid-cols-3">
						<div className="rounded-lg border border-border/70 p-3">
							<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">App</p>
							<p className="mt-2 text-sm font-medium text-foreground">
								HTTP {latest.app.httpStatus ?? "-"} · {latest.app.latencyMs ?? "-"}ms
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{latest.app.probeResults.filter(Boolean).length}/{latest.app.probeResults.length} probes passed
							</p>
						</div>
						<div className="rounded-lg border border-border/70 p-3">
							<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">ECS</p>
							<p className="mt-2 text-sm font-medium text-foreground">
								{latest.ecs
									? `${latest.ecs.runningCount ?? "-"} / ${latest.ecs.desiredCount ?? "-"} running`
									: "Not available"}
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{latest.ecs?.rolloutState || latest.ecs?.status || "No ECS signal"}
							</p>
						</div>
						<div className="rounded-lg border border-border/70 p-3">
							<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">ALB</p>
							<p className="mt-2 text-sm font-medium text-foreground">
								{latest.alb
									? `${latest.alb.healthyTargetCount} healthy / ${latest.alb.unhealthyTargetCount} unhealthy`
									: "Not available"}
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{latest.alb
									? `${latest.alb.initialTargetCount} initial · ${latest.alb.drainingTargetCount} draining`
									: "No target group signal"}
							</p>
						</div>
					</div>
					<div>
						<div className="flex items-center justify-between gap-3">
							<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recent Checks</p>
							<p className="text-xs text-muted-foreground">{formatTimestamp(latest.checkedAt)}</p>
						</div>
						<div className="mt-3 flex flex-wrap gap-2">
							{entries.map((entry) => (
								<span
									key={entry.checkedAt}
									title={`${statusLabel(entry.app.overallStatus)} at ${entry.checkedAt}`}
									className={`h-2.5 flex-1 basis-8 rounded-full ${healthToneClasses(entry.app.overallStatus)}`}
								/>
							))}
						</div>
					</div>
				</div>
			) : (
				<p className="mt-4 text-sm text-muted-foreground">
					Monitoring samples will appear after the health reconciler runs.
				</p>
			)}
		</div>
	);
}

function DeploymentTargetSummary({
	deployDisabled,
	deploymentTarget,
}: {
	deployDisabled: boolean;
	deploymentTarget: DeployConfig["deploymentTarget"];
}) {
	const showService = !deployDisabled;
	if (!showService) return null;

	return (
		<div className="rounded-xl border border-border bg-card p-4">
			<p className="text-xs uppercase tracking-wider text-muted-foreground">Platform</p>
			<dl className="mt-3 space-y-3 text-sm">
				{showService && (
					<div>
						<dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Deployed service</dt>
						<dd className="mt-0.5 font-medium text-foreground">
							{deploymentTarget ? formatDeploymentTargetName(deploymentTarget) : "Pending"}
						</dd>
					</div>
				)}
			</dl>
		</div>
	);
}

export default function DeployOverview({
	deployment,
	region = "us-west-2",
	deployDisabled: deployDisabledProp,
	deployDisabledReason,
	runtimeHealthEntries = EMPTY_RUNTIME_HEALTH_ENTRIES,
	viewState = DEFAULT_DEPLOY_OVERVIEW_VIEW_STATE,
	onRedeploy,
	onRefreshPreview,
	onEditConfiguration,
	onPauseResumeDeployment,
	onDeleteDeployment,
	repo,
}: DeployOverviewProps) {
	const { isDeploying, isRefreshingPreview, isLoadingRuntimeHealth, isChangingDeploymentState } = viewState;
	const hasHostedSubdomain = Boolean(deployment.hostedSubdomain?.trim());
	const effectiveStatus =
		resolveDeploymentStatus({
			status: deployment.status,
			hostedSubdomain: hasHostedSubdomain ? deployment.hostedSubdomain : null,
			screenshotUrl: deployment.screenshotUrl,
		});
	const displayUrl = isLiveDeploymentStatus(effectiveStatus) ? getDeploymentDisplayUrl(deployment) : undefined;
	const screenshotUrl = deployment.screenshotUrl;
	const hostedUrl = getDeploymentHostedUrl(deployment) ?? "";
	const ecsResources = isEcsCloudResources(deployment.cloudResources) ? deployment.cloudResources : null;
	const staticResources = isStaticS3CloudResources(deployment.cloudResources) ? deployment.cloudResources : null;
	const hasAnyEndpoint = Boolean(
		hostedUrl ||
			ecsResources?.baseUrl ||
			staticResources?.publicBaseUrl ||
			ecsResources?.service
	);
	const deployDisabled = deployDisabledProp ?? isDeploymentDisabled(deployment);
	const showEc2InstanceType = false;
	const isStaticS3Target = deployment.deploymentTarget === "static_s3" || Boolean(staticResources);
	const secondaryAccessLabel = isStaticS3Target
		? "S3 location"
		: ecsResources
			? "ECS service"
			: "Infrastructure";
	const secondaryAccessValue = isStaticS3Target
		? staticResources
			? `s3://${staticResources.bucket}/${staticResources.keyPrefix}`
			: undefined
		: ecsResources
			? `${ecsResources.cluster}/${ecsResources.service}`
			: undefined;

	const regionDisplay = (deployment.region || ecsResources?.region || staticResources?.region || region).trim() || region;
	const canManageDeployment = canManageRuntimeDeploymentStatus(effectiveStatus);
	const pauseResumeLabel = effectiveStatus === "paused" ? "Resume Deployment" : "Pause Deployment";
	const PauseResumeIcon = effectiveStatus === "paused" ? Play : Pause;

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<p className="text-2xl font-semibold text-foreground">{deployment.serviceName}</p>
					<span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
						<span className="h-2 w-2 rounded-full bg-primary" />
						{effectiveStatus}
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
							disabled={isDeploying || (deployDisabled && !canManageDeployment)}
							title={deployDisabled && !canManageDeployment ? deployDisabledReason : undefined}
							repo={repo}
							branch={resolveWorkspaceBranch(repo, deployment.branch) || ""}
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

					<RuntimeHealthCard entries={runtimeHealthEntries} isLoading={isLoadingRuntimeHealth} />

					{/** Safely remove the entire screenshot code */}
					<div className="rounded-xl hidden border border-border bg-card">
						<div className="flex items-center justify-between border-b border-border px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">
							<span>Front page preview</span>
							<div className="flex items-center gap-2">
								<span className="text-muted-foreground/70">Live topology</span>
								{onRefreshPreview && displayUrl && (
									<Button
										variant="outline"
										size="sm"
										onClick={onRefreshPreview}
										disabled={isRefreshingPreview}
										className="h-7 gap-1.5 px-2 text-[10px] font-semibold tracking-normal normal-case"
									>
										<RefreshCw className={`size-3 ${isRefreshingPreview ? "animate-spin" : ""}`} />
										{isRefreshingPreview ? "Creating..." : "New Preview"}
									</Button>
								)}
							</div>
						</div>
						{screenshotUrl ? (
							<div className="relative h-80 md:h-96">
								<Image
									src={screenshotUrl}
									alt={`Screenshot of ${deployment.serviceName}`}
									fill
									sizes="(max-width: 768px) 100vw, 768px"
									unoptimized
									className="absolute inset-0 h-full w-full pointer-events-none object-cover overflow-hidden rounded-b-lg"
								/>
							</div>
						) : displayUrl ? (
							<div className="relative h-80 md:h-96">
								<iframe
									src={displayUrl}
									title={`Snapshot of ${deployment.serviceName}`}
									sandbox=""
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
							<div className="space-y-3 px-4 py-3">
								<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
									<Link2 className="size-3.5 opacity-70" aria-hidden />
									<span>Live URLs & access</span>
								</div>
								{hasAnyEndpoint ? (
									<div className="space-y-3 border-t border-border/60 pt-3">
										<EndpointRow label="Hosted URL" value={hostedUrl} />
										<EndpointRow label={secondaryAccessLabel} value={secondaryAccessValue} />
									</div>
								) : (
									<p className="border-t border-border/60 pt-3 text-sm text-muted-foreground/70">Not available</p>
								)}
							</div>
						</div>
					</div>

					{canManageDeployment && (onPauseResumeDeployment || onDeleteDeployment) ? (
						<div className="rounded-xl border border-destructive/20 bg-card p-5">
							<div className="space-y-1">
								<p className="text-xs uppercase tracking-wider text-muted-foreground">Deployment Controls</p>
								<p className="text-sm text-muted-foreground">
									Manage runtime state for this deployment. These actions affect the live service.
								</p>
							</div>
							<div className="mt-4 space-y-3">
								{onPauseResumeDeployment ? (
									<div className="flex flex-col gap-3 rounded-lg border border-border/70 p-4 md:flex-row md:items-center md:justify-between">
										<div className="space-y-1">
											<p className="font-medium text-foreground">{pauseResumeLabel}</p>
											<p className="text-sm text-muted-foreground">
												{effectiveStatus === "paused"
													? "Bring the deployment back online without changing configuration."
													: "Temporarily stop the deployment while keeping its configuration intact."}
											</p>
										</div>
										<Button
											variant="outline"
											onClick={onPauseResumeDeployment}
											disabled={isChangingDeploymentState}
											className="gap-2"
										>
											<PauseResumeIcon className="size-4" />
											{pauseResumeLabel}
										</Button>
									</div>
								) : null}
								{onDeleteDeployment ? (
									<div className="flex flex-col gap-3 rounded-lg border border-destructive/20 p-4 md:flex-row md:items-center md:justify-between">
										<div className="space-y-1">
											<p className="font-medium text-foreground">Delete Deployment</p>
											<p className="text-sm text-muted-foreground">
												Permanently remove this deployment record and its runtime association.
											</p>
										</div>
										<Button
											variant="destructive"
											onClick={onDeleteDeployment}
											disabled={isChangingDeploymentState}
											className="gap-2"
										>
											<Trash2 className="size-4" />
											Delete Deployment
										</Button>
									</div>
								) : null}
							</div>
						</div>
					) : null}
				</div>

				<div className="space-y-4">
					<DeploymentTargetSummary
						deployDisabled={deployDisabled}
						deploymentTarget={deployment.deploymentTarget}
					/>
					<div className="rounded-xl border border-border bg-card p-4">
						<p className="text-xs uppercase tracking-wider text-muted-foreground">Last Deployment</p>
						<p className="mt-2 text-lg font-semibold text-foreground">
						{formatTimestamp(deployment.lastDeployment || undefined)}
						</p>
					</div>
					<div className="rounded-xl border border-border bg-card p-4">
						<p className="text-xs uppercase tracking-wider text-muted-foreground">Environment</p>
						<p className="mt-2 text-sm font-semibold text-foreground">Production</p>
					</div>
					<div className="rounded-xl border border-border bg-card p-4">
						<p className="text-xs uppercase tracking-wider text-muted-foreground">Region</p>
						<p className="mt-2 font-mono text-sm font-semibold text-foreground">{regionDisplay}</p>
					</div>
				</div>
			</div>
		</div>
	);
}
