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
	running: "bg-[#14b8a6]/20 text-[#14b8a6] border-[#14b8a6]/40",
	paused: "bg-[#f59e0b]/20 text-[#f59e0b] border-[#f59e0b]/40",
	stopped: "bg-[#64748b]/20 text-[#94a3b8] border-[#64748b]/40",
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
		<div className="rounded-xl border border-[#1e3a5f]/60 bg-[#132f4c]/60 flex flex-col p-4 hover:border-[#1e3a5f] transition-colors">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<Link
						href={`/services/${deployConfig.service_name}`}
						className="font-semibold text-[#e2e8f0] hover:text-[#14b8a6] transition-colors truncate block"
					>
						{deployConfig.service_name}
					</Link>
					<span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border mt-2 ${statusStyle}`}>
						{deployConfig.status ?? "stopped"}
					</span>
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger className="p-1.5 rounded-lg border border-transparent hover:bg-[#1e3a5f]/50 hover:border-[#1e3a5f]/60 text-[#94a3b8] hover:text-[#e2e8f0] transition-colors">
						<EllipsisVertical className="size-4" />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="border-[#1e3a5f] bg-[#132f4c]">
						<DropdownMenuItem
							onClick={() => changeStatus(deployConfig.status === "running" ? "pause" : "resume")}
							className="text-[#e2e8f0] focus:bg-[#1e3a5f]/50 focus:text-[#e2e8f0]"
						>
							{deployConfig.status === "running" ? "Pause" : "Resume"}
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => changeStatus("stop")}
							disabled={isDeleting}
							className="text-[#e2e8f0] focus:bg-[#dc2626]/20 focus:text-[#fca5a5]"
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
						className="flex items-center gap-1.5 text-xs text-[#14b8a6] hover:underline mt-2 truncate"
					>
						<ExternalLink className="size-3.5 shrink-0" />
						<span className="truncate">{displayUrl}</span>
					</a>
				) : null;
			})()}
			{repo && (
				<div className="mt-4 pt-4 border-t border-[#1e3a5f]/60">
					<a
						href={repo.html_url}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex truncate items-center gap-1.5 text-sm text-[#94a3b8] hover:text-[#14b8a6] transition-colors"
					>
						<GitBranch className="size-4 shrink-0" />
						<span className="truncate">{repo.full_name}</span>
					</a>
					{repo.latest_commit && (
						<>
							<p className="text-xs text-[#64748b] mt-2 line-clamp-2" title={repo.latest_commit.message}>
								{repo.latest_commit.message}
							</p>
							<p className="text-xs text-[#64748b] mt-1">
								{formatTimestamp(repo.latest_commit.date)} on <strong className="text-[#94a3b8]">{repo.default_branch}</strong>
							</p>
						</>
					)}
				</div>
			)}
		</div>
	);
}
