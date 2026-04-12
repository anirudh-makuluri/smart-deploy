"use client";

import * as React from "react";
import Link from "next/link";
import DeploymentHistoryTable from "./DeploymentHistoryTable";
import { useAppData } from "@/store/useAppData";
import { Boxes, Github, Plus, RefreshCcw, ExternalLink } from "lucide-react";
import { useSession } from "next-auth/react";
import { countDeployedServicesForRepo, formatTimestamp } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { addPublicRepo } from "@/lib/graphqlClient";
import { toast } from "sonner";
import { RepoServicesRecord } from "@/app/types";

function normalizeUrl(url: string): string {
	return url?.replace(/\.git$/, "").toLowerCase().trim();
}

function getErrorMessage(error?: Error | { message?: string } | null): string {
	if (!error) return "Failed to fetch repository";
	if (error instanceof Error) return error.message;
	return error.message || "Failed to fetch repository";
}

type DashboardMainProps = {
	activeView: "overview" | "deployments" | "repositories";
};

export default function DashboardMain({ activeView }: DashboardMainProps) {
	const router = useRouter();
	const { data: session } = useSession();
	const { deployments, repoServices, repoList, isLoading, setAppData, refreshRepoList } = useAppData();
	const [isRefreshing, setIsRefreshing] = React.useState(false);
	const [showAddRepo, setShowAddRepo] = React.useState(false);
	const [repoUrl, setRepoUrl] = React.useState("");
	const [isLoadingRepo, setIsLoadingRepo] = React.useState(false);

	// Overview: repo is deployed if it has any deployment (repo-level or per-service)
	const repoCards = repoServices
		.filter((record: RepoServicesRecord) => (record.services?.length ?? 0) > 0)
		.map((record : RepoServicesRecord) => {
		const repoUrlNorm = normalizeUrl(record.repo_url);
		const repoDeployments = deployments.filter((d) => normalizeUrl(d.url ?? "") === repoUrlNorm);
		const totalServices = record.services?.length ?? 0;
		const activeRepoDeployments = repoDeployments.filter((d) => d.status !== "didnt_deploy");
		const hasFailed = repoDeployments.some((d) => d.status === "failed");
		const deployedServicesCount = countDeployedServicesForRepo(record, repoDeployments);
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
			hasFailed,
		};
		if (totalServices > 0) {
			return {
				...base,
				subtitle: `${subtitle} · ${deployedServicesCount}/${totalServices} service${totalServices !== 1 ? "s" : ""}`,
			};
		}
		return base;
	});

	async function handleRefresh() {
		setIsRefreshing(true);
		const response = await refreshRepoList();
		setIsRefreshing(false);
		toast(response.message);
	}

	function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
		try {
			let cleanUrl = url.trim();
			cleanUrl = cleanUrl.replace(/\.git$/, "");
			cleanUrl = cleanUrl.replace(/^https?:\/\//, "");
			cleanUrl = cleanUrl.replace(/^github\.com\//, "");
			cleanUrl = cleanUrl.replace(/\/$/, "");
			const parts = cleanUrl.split("/").filter(Boolean);
			if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
			return null;
		} catch {
			return null;
		}
	}

	async function handleAddPublicRepo() {
		if (!repoUrl.trim()) {
			toast.error("Please enter a GitHub URL");
			return;
		}
		const parsed = parseGitHubUrl(repoUrl);
		if (!parsed) {
			toast.error("Invalid GitHub URL. Format: https://github.com/owner/repo");
			return;
		}
		setIsLoadingRepo(true);
		try {
			const repo = await addPublicRepo(parsed.owner, parsed.repo);
			if (!repo) {
				toast.error("Failed to fetch repository");
				return;
			}
			setRepoUrl("");
			setShowAddRepo(false);
			setAppData([repo, ...repoList], deployments, isLoading, repoServices);
			toast.success(`Added ${repo.full_name}`);
			router.push(`/${repo.owner.login}/${repo.name}`);
		} catch (error) {
			toast.error(getErrorMessage(error as Error | { message?: string } | null));
		} finally {
			setIsLoadingRepo(false);
		}
	}

	return (
		<main className="flex-1 min-h-0 flex flex-col overflow-hidden">
			<div className="p-6 border-b border-border/60">
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div>
						<p className="text-xs uppercase tracking-wider text-muted-foreground">
							Workspaces / {session?.user?.name ?? "Workspace"}
						</p>
						<h1 className="font-semibold text-xl text-foreground">
							{activeView === "overview"
								? "Deployments"
								: activeView === "deployments"
									? "History"
									: "Repositories"}
						</h1>
					</div>
				</div>
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto p-6">
				{/* Deployments: repo cards with deployed/undeployed/crashed */}
				<div className={activeView === "overview" ? "" : "hidden"}>
					<div className="space-y-6">
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
								{repoCards.map(({ owner, name, subtitle, hasFailed }) => (
									<div
										key={`${owner}/${name}`}
										className={`rounded-xl border p-4 bg-card hover:border-primary/40 transition-colors text-left ${hasFailed ? "border-destructive/50" : "border-border"
											}`}
									>
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
									</div>
								))}
							</div>
						)}
					</div>
				</div>

				{/* History View */}
				<div className={activeView === "deployments" ? "" : "hidden"}>
					<div className="space-y-4">
						<div>
							<h2 className="text-lg font-semibold text-foreground">Deployment History</h2>
							<p className="text-sm text-muted-foreground">All services, newest first</p>
						</div>
						<DeploymentHistoryTable />
					</div>
				</div>

				{/* Repositories View */}
				<div className={activeView === "repositories" ? "" : "hidden"}>
					<div className="space-y-4">
						<div className="flex items-center justify-between gap-2">
							<h2 className="text-lg font-semibold text-foreground">All Repositories</h2>
							<div className="flex items-center gap-2">
								<Button
									onClick={() => setShowAddRepo((value) => !value)}
									variant="outline"
									size="sm"
									className="border-border bg-transparent text-foreground hover:bg-secondary hover:text-foreground"
									title="Add public repository"
								>
									<Plus className="size-4" />
								</Button>
								<Button
									onClick={handleRefresh}
									variant="outline"
									size="sm"
									disabled={isRefreshing}
									className="border-border bg-transparent text-foreground hover:bg-secondary hover:text-foreground"
								>
									<RefreshCcw className={`size-4 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
									Refresh
								</Button>
							</div>
						</div>
						{showAddRepo && (
							<div className="p-3 rounded-lg border border-border bg-background">
								<p className="text-xs text-muted-foreground mb-2">Add Public Repository</p>
								<div className="flex gap-2">
									<Input
										type="text"
										placeholder="https://github.com/owner/repo"
										value={repoUrl}
										onChange={(e) => setRepoUrl(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") handleAddPublicRepo();
											if (e.key === "Escape") {
												setShowAddRepo(false);
												setRepoUrl("");
											}
										}}
										className="flex-1 border-border bg-background text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary text-sm"
										disabled={isLoadingRepo}
									/>
									<Button
										onClick={handleAddPublicRepo}
										size="sm"
										disabled={isLoadingRepo || !repoUrl.trim()}
										className="landing-build-blue hover:opacity-95 text-primary-foreground shrink-0"
									>
										{isLoadingRepo ? (
											<RefreshCcw className="size-4 animate-spin" />
										) : (
											<ExternalLink className="size-4" />
										)}
									</Button>
								</div>
								<p className="text-xs text-muted-foreground/70 mt-2">
									Enter any public GitHub repository URL
								</p>
							</div>
						)}
						{repoList.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-dashed border-border/60 bg-card/20 text-center">
								<Boxes className="size-12 text-muted-foreground/70 mb-4" />
								<p className="text-foreground font-medium">
									{isLoading ? "Loading…" : "No repositories yet"}
								</p>
							</div>
						) : (
							<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
								{repoList.map((repo) => (
									<Link
										key={repo.id}
										href={`/${repo.full_name}`}
										className="rounded-xl border border-border p-4 bg-card hover:border-primary/40 transition-colors"
									>
										<div className="flex items-center gap-3 min-w-0">
											<Github className="size-6 shrink-0 text-muted-foreground" />
											<div className="min-w-0">
												<p className="font-semibold text-foreground truncate">{repo.full_name}</p>
												{repo.latest_commit && (
													<p className="text-sm text-muted-foreground truncate mt-1">
														{repo.latest_commit.message}
													</p>
												)}
												{repo.latest_commit?.date && (
													<p className="text-xs text-muted-foreground/70 mt-1">
														{formatTimestamp(repo.latest_commit.date)}
													</p>
												)}
											</div>
										</div>
									</Link>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</main>
	);
}
