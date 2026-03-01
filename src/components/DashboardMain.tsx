"use client";

import Link from "next/link";
import DeploymentHistoryTable from "./DeploymentHistoryTable";
import { useAppData } from "@/store/useAppData";
import { Boxes, Github, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";

function normalizeUrl(url: string): string {
	return url.replace(/\.git$/, "").toLowerCase().trim();
}

type DashboardMainProps = {
	onNewDeploy: () => void;
	activeView: "overview" | "deployments";
};

export default function DashboardMain({ onNewDeploy, activeView }: DashboardMainProps) {
	const { data: session } = useSession();
	const { deployments, repoList, repoServices, isLoading } = useAppData();

	// Overview: one deployment per repo (all services on one instance)
	const repoCards = repoServices.map((record) => {
		const repoUrlNorm = normalizeUrl(record.repo_url);
		const repoId = `https://github.com/${record.repo_owner}/${record.repo_name}`;
		const repoName = record.repo_name;
		const deployment = deployments.find(
			(d) => normalizeUrl(d.url ?? "") === repoUrlNorm && (d.id === repoId || d.service_name === repoName)
		);
		const totalServices = record.services?.length ?? 0;
		const isDeployed = !!deployment;
		const isCrashed = deployment?.status === "stopped" || deployment?.status === "paused";

		const subtitle = isCrashed ? "Crashed" : isDeployed ? "Deployed" : "Not deployed";
		if (totalServices > 0) {
			// e.g. "Deployed · 2 services"
			return {
				owner: record.repo_owner,
				name: record.repo_name,
				subtitle: `${subtitle} · ${totalServices} service${totalServices !== 1 ? "s" : ""}`,
				hasCrashed: isCrashed,
			};
		}
		return {
			owner: record.repo_owner,
			name: record.repo_name,
			subtitle,
			hasCrashed: isCrashed,
		};
	});

	return (
		<main className="flex-1 min-h-0 flex flex-col overflow-hidden">
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
					<Button
						onClick={onNewDeploy}
						className="landing-build-blue hidden hover:opacity-95 text-primary-foreground"
					>
						+ Deploy
					</Button>
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
								{repoCards.map(({ owner, name, subtitle, hasCrashed }) => (
									<Link
										key={`${owner}/${name}`}
										href={`/${owner}/${name}`}
										className={`block rounded-xl border p-4 bg-card hover:border-primary/40 transition-colors text-left ${
											hasCrashed ? "border-destructive/50" : "border-border"
										}`}
									>
										<div className="flex items-center justify-between gap-3">
											<div className="flex items-center gap-3 min-w-0">
												<Github className="size-6 shrink-0 text-muted-foreground" />
												<div className="min-w-0">
													<p className="font-semibold text-foreground truncate">
														{owner} / {name}
													</p>
													<p className="text-sm text-muted-foreground">
														{subtitle}
													</p>
												</div>
											</div>
											<ChevronRight className="size-5 shrink-0 text-muted-foreground" />
										</div>
									</Link>
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
		</main>
	);
}

