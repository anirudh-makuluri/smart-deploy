"use client";

import * as React from "react";
import Link from "next/link";
import DeploymentHistoryTable from "./DeploymentHistoryTable";
import { useAppData } from "@/store/useAppData";
import { Boxes, Github, ChevronRight, EllipsisVertical, PauseCircle, PlayCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";

function normalizeUrl(url: string): string {
	return url.replace(/\.git$/, "").toLowerCase().trim();
}

type DashboardMainProps = {
	activeView: "overview" | "deployments";
};

export default function DashboardMain({ activeView }: DashboardMainProps) {
	const { data: session } = useSession();
	const { deployments, repoList, repoServices, isLoading, updateDeploymentById, removeDeployment, removeDeployments, refetchDeployments } = useAppData();
	const [bulkOperation, setBulkOperation] = React.useState<{ label: string } | null>(null);
	const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = React.useState(false);
	const [pendingDeploys, setPendingDeploys] = React.useState<typeof deployments>([]);

	// Overview: repo is deployed if it has any deployment (repo-level or per-service)
	const repoCards = repoServices.map((record) => {
		const repoUrlNorm = normalizeUrl(record.repo_url);
		const repoDeployments = deployments.filter((d) => normalizeUrl(d.url ?? "") === repoUrlNorm);
		const totalServices = record.services?.length ?? 0;
		const activeRepoDeployments = repoDeployments.filter((d) => d.status !== "didnt_deploy");
		const hasFailed = repoDeployments.some((d) => d.status === "failed");
		const hasRepoLevelDeployment = activeRepoDeployments.some(
			(d) => d.service_name === record.repo_name
		);
		const deployedServicesCount = hasRepoLevelDeployment
			? totalServices
			: activeRepoDeployments.filter((d) => {
				const svcName = d.service_name?.trim();
				if (!svcName) return false;
				return svcName.startsWith(`${record.repo_name}-`);
			}).length;
		const isDeployed = deployedServicesCount > 0;
		const isCrashed = activeRepoDeployments.some((d) => d.status === "stopped" || d.status === "paused");

		const subtitle = isCrashed
			? "Crashed"
			: hasFailed
				? "Failed"
				: isDeployed
					? "Deployed"
					: "Not deployed";
		const base = {
			owner: record.repo_owner,
			name: record.repo_name,
			subtitle,
			hasCrashed: isCrashed,
			hasFailed,
			deployments: repoDeployments,
		};
		if (totalServices > 0) {
			return {
				...base,
				subtitle: `${subtitle} · ${deployedServicesCount}/${totalServices} service${totalServices !== 1 ? "s" : ""}`,
			};
		}
		return base;
	});

	async function handleConfirmBulkDelete() {
		if (!pendingDeploys.length) return;
		setShowBulkDeleteConfirm(false);
		setBulkOperation({ label: "Deleting deployments…" });
		const deletedKeys: { repoName: string; serviceName: string }[] = [];
		try {
			for (const dep of pendingDeploys) {
				try {
					const res = await fetch("/api/delete-deployment", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							repoName: dep.repo_name,
							serviceName: dep.service_name,
						}),
					});
					const data = await res.json();
					if (data.status === "success") {
						deletedKeys.push({ repoName: dep.repo_name, serviceName: dep.service_name });
					} else {
						toast.error(data.error || data.details || `Failed to delete ${dep.service_name}`);
					}
				} catch (err: any) {
					toast.error(err?.message || `Failed to delete ${dep.service_name}`);
				}
			}
			if (deletedKeys.length) {
				removeDeployments(deletedKeys);
				await refetchDeployments();
			}
			toast.success("Finished deleting deployments for this repo.");
		} finally {
			setBulkOperation(null);
			setPendingDeploys([]);
		}
	}

	async function bulkDelete(deploys: typeof deployments) {
		if (!deploys.length) return;
		setPendingDeploys(deploys);
		setShowBulkDeleteConfirm(true);
	}

	async function bulkPauseResume(deploys: typeof deployments, action: "pause" | "resume") {
		const target = action === "pause" ? deploys.filter((d) => d.status === "running") : deploys.filter((d) => d.status === "paused");
		if (!target.length) return;

		const loadingId = toast.loading(action === "pause" ? "Pausing deployments…" : "Resuming deployments…");
		try {
			for (const dep of target) {
				try {
					const res = await fetch("/api/deployment-control", {
						method: "PUT",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							repoName: dep.repo_name,
							serviceName: dep.service_name,
							action,
						}),
					});
					const data = await res.json();
					if (data.status === "success") {
						const nextStatus = action === "pause" ? "paused" : "running";
						void updateDeploymentById({ ...dep, status: nextStatus });
					} else {
						toast.error(data.error || data.message || `Failed to ${action} ${dep.service_name}`);
					}
				} catch (err: any) {
					toast.error(err?.message || `Failed to ${action} ${dep.service_name}`);
				}
			}
			toast.success(action === "pause" ? "Deployments paused." : "Deployments resumed.");
		} finally {
			setBulkOperation(null);
		}
	}

	return (
		<main className="flex-1 min-h-0 flex flex-col overflow-hidden">
			{bulkOperation && (
				<div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
					<span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
					<span className="text-sm font-medium text-foreground">{bulkOperation.label}</span>
				</div>
			)}
			<div className="p-6 border-b border-border/60">
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div>
						<p className="text-xs uppercase tracking-wider text-muted-foreground">
							Workspaces / {session?.user?.name ?? "Workspace"}
						</p>
						<h1 className="font-semibold text-xl text-foreground">
							{activeView === "overview" ? "Overview" : "Deployments"}
						</h1>
					</div>
				</div>
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto p-6">
				{/* Overview: repo cards with deployed/undeployed/crashed */}
				<div className={activeView === "overview" ? "" : "hidden"}>
					<div className="space-y-6">
						<div>
							<h2 className="text-lg font-semibold text-foreground">Repositories</h2>
							<p className="text-sm text-muted-foreground">
								Click a repo to see and deploy its services.
							</p>
						</div>
						{repoCards.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-dashed border-border/60 bg-card/20 text-center">
								<Boxes className="size-12 text-muted-foreground/70 mb-4" />
								<p className="text-foreground font-medium">
									{isLoading ? "Loading…" : "No detected repositories yet"}
								</p>
								<p className="text-sm text-muted-foreground mt-1 max-w-sm">
									{isLoading ? "Fetching your data." : "Click a repository in the sidebar to open its page; we'll detect and save its services there."}
								</p>
							</div>
						) : (
							<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
								{repoCards.map(({ owner, name, subtitle, hasCrashed, hasFailed, deployments: repoDeployments }) => (
									<div
										key={`${owner}/${name}`}
										className={`rounded-xl border p-4 bg-card hover:border-primary/40 transition-colors text-left ${hasFailed ? "border-destructive/50" : "border-border"
											}`}
									>
										<div className="flex items-start justify-between gap-3">
											<Link
												href={`/${owner}/${name}`}
												className="flex items-center gap-3 min-w-0"
											>
												<Github className="size-6 shrink-0 text-muted-foreground" />
												<div className="min-w-0">
													<p className="font-semibold text-foreground truncate">
														{owner} / {name}
													</p>
													<p className="text-sm text-muted-foreground">
														{subtitle}
													</p>
												</div>
											</Link>
											{repoDeployments.length > 0 && (
												<DropdownMenu>
													<DropdownMenuTrigger className="p-1.5 rounded-lg border border-transparent hover:bg-secondary hover:border-border text-muted-foreground hover:text-foreground transition-colors">
														<EllipsisVertical className="size-4" />
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end" className="border-border bg-card">
														<DropdownMenuItem
															onClick={() => bulkPauseResume(repoDeployments, "pause")}
															className="text-foreground focus:bg-secondary focus:text-foreground"
														>
															<PauseCircle className="size-4" />
															Pause all
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() => bulkPauseResume(repoDeployments, "resume")}
															className="text-foreground focus:bg-secondary focus:text-foreground"
														>
															<PlayCircle className="size-4" />
															Resume all
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() => bulkDelete(repoDeployments)}
															variant="destructive"
														>
															<Trash2 className="size-4" />
															Delete all deployments
														</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											)}
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</div>

				{/* Deployments View */}
				<div className={activeView === "deployments" ? "" : "hidden"}>
					<div className="space-y-4">
						<div>
							<h2 className="text-lg font-semibold text-foreground">Deployment History</h2>
							<p className="text-sm text-muted-foreground">All services, newest first</p>
						</div>
						<DeploymentHistoryTable />
					</div>
				</div>
			</div>

			<ConfirmDialog
				open={showBulkDeleteConfirm}
				onOpenChange={setShowBulkDeleteConfirm}
				onConfirm={handleConfirmBulkDelete}
				title="Delete All Deployments?"
				description={`This will permanently delete ${pendingDeploys.length} deployments. This action cannot be undone and all associated cloud resources will be terminated.`}
				confirmText="Delete All"
				variant="destructive"
			/>
		</main>
	);
}

