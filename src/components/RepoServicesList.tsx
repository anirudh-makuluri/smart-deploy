"use client";

import * as React from "react";
import { Github, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetectedServiceInfo, DeployConfig, repoType } from "@/app/types";
import { getDeploymentForService } from "@/lib/utils";

type RepoServicesListProps = {
	owner: string;
	repoName: string;
	repoUrl: string;
	services: DetectedServiceInfo[];
	loading: boolean;
	error: string | null;
	repoDeployments: DeployConfig[];
	resolvedRepo: repoType;
	setActiveService: (svc: DetectedServiceInfo) => void;
	handleDeleteAllDeployments: () => void;
	openWorkspaceForService: (svc: DetectedServiceInfo) => void;
};

export default function RepoServicesList({
	owner,
	repoName,
	repoUrl,
	services,
	loading,
	error,
	repoDeployments,
	resolvedRepo,
	setActiveService,
	handleDeleteAllDeployments,
	openWorkspaceForService,
}: RepoServicesListProps) {
	return (
		<>
			<div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div>
					<h1 className="text-xl font-semibold text-foreground">
						{owner} / {repoName}
					</h1>
					<p className="text-sm text-muted-foreground mt-0.5">
						{services.length} service{services.length !== 1 ? "s" : ""}
					</p>
				</div>
				{!loading && !error && services.length > 0 && (
					<div className="flex items-center gap-2">
						<Button
							onClick={() => openWorkspaceForService({ name: ".", path: ".", language: "unknown" })}
							className="shrink-0"
						>
							Deploy all on one instance
						</Button>
						{repoDeployments.length > 0 && (
							<Button
								variant="outline"
								size="sm"
								onClick={handleDeleteAllDeployments}
							>
								Delete all deployments
							</Button>
						)}
					</div>
				)}
			</div>

			{loading && (
				<div className="text-muted-foreground py-8 text-center">Loading services…</div>
			)}
			{error && (
				<div className="rounded-xl border border-destructive/50 bg-destructive/10 text-destructive px-4 py-3">
					{error}
				</div>
			)}
			{!loading && !error && services.length === 0 && (
				<div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center text-muted-foreground">
					No deployable services detected. Add a service or check the repository structure.
				</div>
			)}
			{!loading && !error && services.length > 0 && (
				<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
					{services.map((svc) => {
						console.log(repoDeployments)
						const deployment = getDeploymentForService(
							repoDeployments,
							repoUrl,
							svc.name,
							resolvedRepo.name
						);
						console.log(deployment);
						const status = deployment?.status;
						const isOnline = status === "running";
						const isDraft = status !== "running" && status !== "failed" || !deployment;
						const isFailed = status === "failed";
						const liveUrl = deployment?.liveUrl;

						const handleCardClick = () => {
							openWorkspaceForService(svc);
						};

						const handleLiveUrlClick = (e: React.MouseEvent) => {
							e.stopPropagation();
							if (liveUrl) {
								window.open(liveUrl, "_blank");
							}
						};

						return (
							<button
								key={svc.name}
								type="button"
								onClick={handleCardClick}
								className={`hover:cursor-pointer rounded-xl border p-4 text-left bg-card hover:border-primary/40 transition-colors ${isFailed ? "border-destructive/60" : "border-border"
									}`}
							>
								<div className="flex items-center gap-3">
									<Github className="size-6 shrink-0 text-muted-foreground" />
									<span className="font-semibold text-foreground truncate">
										@{repoName}/{svc.name}
									</span>
								</div>
								<div className="mt-3 flex flex-col gap-2">
									<div className="flex items-center gap-2">
										{isDraft && (
											<span className="text-sm text-muted-foreground">
												Draft (Not deployed)
											</span>
										)}
										{isFailed && (
											<>
												<span className="text-sm text-destructive flex items-center gap-1">
													Failed
												</span>
												<span className="flex items-center gap-0.5 text-destructive/80">
													<AlertTriangle className="size-4" />
												</span>
											</>
										)}
										{isOnline && (
											<span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
												<span className="size-2 rounded-full bg-green-500" />
												Online
											</span>
										)}
									</div>
									{liveUrl && isOnline && (
										<button
											onClick={handleLiveUrlClick}
											className="text-sm text-blue-600 dark:text-blue-400 hover:underline text-left truncate"
										>
											{liveUrl}
										</button>
									)}
								</div>
							</button>
						);
					})}
				</div>
			)}
		</>
	);
}
