"use client";

import { DeployConfig, repoType } from "@/app/types";
import { EllipsisVertical, ExternalLink, GitBranch } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatTimestamp, getDeploymentDisplayUrl } from "@/lib/utils";
import Link from "next/link";
import { useAppData } from "@/store/useAppData";
import { useState } from "react";
import { toast } from "sonner";

const statusStyles: Record<string, string> = {
	running: "bg-primary/20 text-primary border-primary/40",
	paused: "bg-amber-400/20 text-amber-400 border-amber-400/40",
	stopped: "bg-muted/40 text-muted-foreground border-muted-foreground/30",
};

export default function DashboardDeploymentItem({
	deployConfig,
	repo,
}: {
	deployConfig: DeployConfig;
	repo: repoType | undefined;
}) {
	const { removeDeployment } = useAppData();
	const [isDeleting, setIsDeleting] = useState(false);

	function changeStatus(action: string) {
		// Delete = full remove: Cloud Run + DB, no traces left
		if (action === "stop") {
			setIsDeleting(true);
			const loadingId = toast.loading("Deleting deployment…");
			fetch("/api/delete-deployment", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					deploymentId: deployConfig.id,
					serviceName: deployConfig.service_name,
				}),
			})
				.then((res) => res.json())
				.then((response) => {
					toast.dismiss(loadingId);
					if (response.status === "success") {
						removeDeployment(deployConfig.id);
						toast.success("Deployment deleted.");
					} else {
						toast.error(response.error || response.details || "Failed to delete deployment.");
					}
				})
				.catch((err) => {
					toast.dismiss(loadingId);
					toast.error(err?.message || "Failed to delete deployment.");
				})
				.finally(() => setIsDeleting(false));
			return;
		}

		fetch("/api/deployment-control", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ serviceName: deployConfig.service_name, action }),
		});
	}

	const statusStyle = statusStyles[deployConfig.status ?? "stopped"] ?? statusStyles.stopped;

	return (
		<div className="rounded-xl border border-border bg-card flex flex-col p-4 hover:border-border transition-colors">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<Link
						href={`/services/${deployConfig.service_name}?deploymentId=${encodeURIComponent(deployConfig.id)}`}
						className="font-semibold text-foreground hover:text-primary transition-colors truncate block"
					>
						{deployConfig.service_name}
					</Link>
					<span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border mt-2 ${statusStyle}`}>
						{deployConfig.status ?? "stopped"}
					</span>
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger className="p-1.5 rounded-lg border border-transparent hover:bg-secondary hover:border-border text-muted-foreground hover:text-foreground transition-colors">
						<EllipsisVertical className="size-4" />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="border-border bg-card">
						<DropdownMenuItem
							onClick={() => changeStatus(deployConfig.status === "running" ? "pause" : "resume")}
							className="text-foreground focus:bg-secondary focus:text-foreground"
						>
							{deployConfig.status === "running" ? "Pause" : "Resume"}
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => changeStatus("stop")}
							disabled={isDeleting}
							className="text-foreground focus:bg-destructive/20 focus:text-destructive/80"
						>
							{isDeleting ? "Deleting…" : "Delete"}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{(() => {
				const displayUrl = getDeploymentDisplayUrl(deployConfig);
				return displayUrl ? (
					<a
						href={displayUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-2 truncate"
					>
						<ExternalLink className="size-3.5 shrink-0" />
						<span className="truncate">{displayUrl}</span>
					</a>
				) : null;
			})()}
			{repo && (
				<div className="mt-4 pt-4 border-t border-border">
					<a
						href={repo.html_url}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex truncate items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
					>
						<GitBranch className="size-4 shrink-0" />
						<span className="truncate">{repo.full_name}</span>
					</a>
					{repo.latest_commit && (
						<>
							<p className="text-xs text-muted-foreground/70 mt-2 line-clamp-2" title={repo.latest_commit.message}>
								{repo.latest_commit.message}
							</p>
							<p className="text-xs text-muted-foreground/70 mt-1">
								{formatTimestamp(repo.latest_commit.date)} on <strong className="text-muted-foreground">{repo.default_branch}</strong>
							</p>
						</>
					)}
				</div>
			)}
		</div>
	);
}


