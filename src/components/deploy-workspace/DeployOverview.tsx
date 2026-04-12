import Image from "next/image";
import { ExternalLink, Link2, Pause, RefreshCw, Settings, Trash2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeployConfig, EC2Details, repoType } from "@/app/types";
import {
	formatTimestamp,
	formatDeploymentTargetName,
	getDeploymentDisplayUrl,
	isDeploymentDisabled,
} from "@/lib/utils";
import { resolveWorkspaceBranch } from "@/lib/repoBranch";
import DeployOptions from "@/components/DeployOptions";
import { DEFAULT_EC2_INSTANCE_TYPE, formatApproxEc2PriceCompact } from "@/lib/aws/ec2InstanceTypes";

type DeployOverviewProps = {
	deployment: DeployConfig;
	region?: string;
	isDeploying?: boolean;
	isRefreshingPreview?: boolean;
	onRedeploy?: (commitSha?: string) => void;
	onRefreshPreview?: () => void;
	onEditConfiguration?: () => void;
	onPauseResumeDeployment?: () => void;
	onDeleteDeployment?: () => void;
	isChangingDeploymentState?: boolean;
	repo?: repoType;
};

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

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
				<span className="text-sm text-muted-foreground/70">—</span>
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

function DeploymentTargetSummary({
	deployDisabled,
	deploymentTarget,
	showEc2InstanceType,
	ec2TypeDisplay,
}: {
	deployDisabled: boolean;
	deploymentTarget: DeployConfig["deploymentTarget"];
	showEc2InstanceType: boolean;
	ec2TypeDisplay: string;
}) {
	const showService = !deployDisabled;
	if (!showService && !showEc2InstanceType) return null;

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
				{showEc2InstanceType && (
					<div>
						<dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Instance type</dt>
						<dd className="mt-0.5 font-mono text-xs text-foreground">{ec2TypeDisplay}</dd>
					</div>
				)}
			</dl>
		</div>
	);
}

export default function DeployOverview({
	deployment,
	region = "us-west-2",
	isDeploying = false,
	isRefreshingPreview = false,
	onRedeploy,
	onRefreshPreview,
	onEditConfiguration,
	onPauseResumeDeployment,
	onDeleteDeployment,
	isChangingDeploymentState = false,
	repo,
}: DeployOverviewProps) {
	const hasStoredLiveUrl = Boolean(deployment.liveUrl);
	// If a DB row says "running" but we don't have a stored live URL, treat it as not deployed.
	const effectiveStatus =
		deployment.status === "running" && !hasStoredLiveUrl ? "didnt_deploy" : (deployment.status ?? "didnt_deploy");
	const displayUrl = effectiveStatus === "running" ? getDeploymentDisplayUrl(deployment) : undefined;
	const screenshotUrl = deployment.screenshotUrl;
	const customUrlRaw = deployment.liveUrl?.trim();
	const instanceIpRaw = ((deployment.ec2 || {}) as EC2Details)?.publicIp?.trim?.();
	const hasAnyEndpoint = Boolean(customUrlRaw || instanceIpRaw);
	const deployDisabled = isDeploymentDisabled(deployment);
	const ec2Casted = (deployment.ec2 || {}) as EC2Details;
	const showEc2InstanceType =
		deployment.deploymentTarget === "ec2" || !!ec2Casted.instanceId;
	const ec2TypeDisplay =
		ec2Casted.instanceType?.trim() || DEFAULT_EC2_INSTANCE_TYPE;
	const ec2PriceEstimate = showEc2InstanceType
		? formatApproxEc2PriceCompact(ec2TypeDisplay)
		: null;

	const regionDisplay = (deployment.awsRegion || region).trim() || region;
	const canManageDeployment =
		effectiveStatus === "running" || effectiveStatus === "paused";
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
							disabled={isDeploying || deployDisabled}
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
					<div className="rounded-xl border border-border bg-card">
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
									unoptimized
									className="absolute inset-0 h-full w-full pointer-events-none object-cover overflow-hidden rounded-b-lg"
								/>
							</div>
						) : displayUrl ? (
							<div className="relative h-80 md:h-96">
								<iframe
									src={displayUrl}
									title={`Snapshot of ${deployment.serviceName}`}
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
							{ec2PriceEstimate && (
								<div className="flex items-center justify-between px-4 py-3">
									<span>On-demand estimate (Linux, {regionDisplay})</span>
										<span className="text-right text-xs text-muted-foreground max-w-56">
										{ec2PriceEstimate}
									</span>
								</div>
							)}
							<div className="space-y-3 px-4 py-3">
								<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
									<Link2 className="size-3.5 opacity-70" aria-hidden />
									<span>Live URLs & access</span>
								</div>
								{hasAnyEndpoint ? (
									<div className="space-y-3 border-t border-border/60 pt-3">
										<EndpointRow label="Custom URL" value={customUrlRaw} />
										<EndpointRow label="Instance IP" value={instanceIpRaw} />
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
						showEc2InstanceType={showEc2InstanceType}
						ec2TypeDisplay={ec2TypeDisplay}
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
