"use client";

import { useId } from "react";
import { AlertTriangle } from "lucide-react";
import type { DeployConfig, DetectedServiceInfo } from "@/app/types";
import { resolveDeploymentStatus, type DeploymentStatus } from "@/lib/deploymentStatus";
import { getDeploymentDisplayUrl } from "@/lib/utils";
import RepoRecordIcon from "@/components/RepoRecordIcon";

interface StatusPresentation { label: string; className: string }
interface RepoServiceCardProps {
	service: DetectedServiceInfo;
	deployment: DeployConfig | null;
	onOpenWorkspace: (service: DetectedServiceInfo) => void | Promise<void>;
}

const STATUS_VIEWS: Record<DeploymentStatus, StatusPresentation> = {
	didnt_deploy: { label: "Draft (Not Deployed)", className: "text-sm text-muted-foreground" },
	deploying: { label: "Deploying", className: "text-sm text-blue-600 dark:text-blue-400" },
	running: { label: "Online", className: "text-sm text-green-600 dark:text-green-400 flex items-center gap-1" },
	paused: { label: "Paused", className: "text-sm text-amber-600 dark:text-amber-400" },
	failed: { label: "Failed", className: "text-sm text-destructive flex items-center gap-1" },
	stopped: { label: "Stopped", className: "text-sm text-muted-foreground" },
};

function ServiceStatus({ status }: { status: DeploymentStatus | null }) {
	const view = status ? STATUS_VIEWS[status] : { label: "Not Deployed", className: "text-sm text-muted-foreground" };
	return <>
		<span className={view.className}>
			{status === "running" && <span className="size-2 rounded-full bg-green-500" />}
			{view.label}
		</span>
		{status === "failed" && <span className="flex items-center gap-0.5 text-destructive/80"><AlertTriangle className="size-4" aria-hidden="true" /></span>}
	</>;
}

export function RepoServiceCard({ service, deployment, onOpenWorkspace }: RepoServiceCardProps) {
	const id = useId();
	const status = deployment ? resolveDeploymentStatus({
		status: deployment.status, hostedSubdomain: deployment.hostedSubdomain, screenshotUrl: deployment.screenshotUrl,
	}) : null;
	const displayUrl = deployment && status === "running" ? getDeploymentDisplayUrl(deployment) : null;
	return (
		<div className={`relative w-full rounded-xl border p-4 text-left bg-card hover:border-primary/40 transition-colors ${status === "failed" ? "border-destructive/60" : "border-border"}`}>
			<button type="button" aria-labelledby={`${id}-name ${id}-path ${id}-status`}
				onClick={() => { void onOpenWorkspace(service); }}
				className="absolute inset-0 w-full cursor-pointer rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
			<div className="pointer-events-none relative flex items-center gap-3">
				<RepoRecordIcon deployMode={service.deployMode} serviceType={service.serviceType} framework={service.framework} />
				<div className="min-w-0 flex-1">
					<div id={`${id}-name`} className="font-semibold text-foreground truncate">{service.name}</div>
				</div>
			</div>
			<div id={`${id}-path`} className="pointer-events-none relative mt-1 text-xs text-muted-foreground font-mono truncate" title={service.path}>
				{service.path === "." ? "Root directory" : service.path}
			</div>
			<div className="mt-3 flex flex-col gap-2">
				<div id={`${id}-status`} className="pointer-events-none relative flex items-center gap-2"><ServiceStatus status={status} /></div>
				{displayUrl && <a href={displayUrl} target="_blank" rel="noopener noreferrer"
					className="relative text-sm text-blue-600 dark:text-blue-400 hover:underline text-left truncate">{displayUrl}</a>}
			</div>
		</div>
	);
}
