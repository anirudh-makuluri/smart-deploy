"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { repoType } from "@/app/types";
import { useAppData } from "@/store/useAppData";
import { RefreshCcw, FolderGit2, Plus, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { formatTimestamp } from "@/lib/utils";

type DashboardSideBarProps = {
	onOpenDeploySheet: (repo?: repoType) => void;
};

export default function DashboardSideBar({ onOpenDeploySheet }: DashboardSideBarProps) {
	const { data: session } = useSession();
	const { repoList, deployments, refreshRepoList } = useAppData();
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [showAddRepo, setShowAddRepo] = useState(false);
	const [repoUrl, setRepoUrl] = useState("");
	const [isLoadingRepo, setIsLoadingRepo] = useState(false);

	// Filter out repos that already have deployments/services
	const availableRepos = repoList.filter((repo) => {
		return !deployments.some((dep) => dep.url === repo.html_url);
	});

	async function handleRefresh() {
		setIsRefreshing(true);
		const response = await refreshRepoList();
		setIsRefreshing(false);
		toast(response.message);
	}

	function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
		try {
			// Handle various GitHub URL formats:
			// https://github.com/owner/repo
			// https://github.com/owner/repo.git
			// github.com/owner/repo
			// owner/repo
			let cleanUrl = url.trim();
			
			// Remove .git suffix if present
			cleanUrl = cleanUrl.replace(/\.git$/, "");
			
			// Remove protocol if present
			cleanUrl = cleanUrl.replace(/^https?:\/\//, "");
			
			// Remove github.com/ prefix if present
			cleanUrl = cleanUrl.replace(/^github\.com\//, "");
			
			// Remove trailing slash
			cleanUrl = cleanUrl.replace(/\/$/, "");
			
			const parts = cleanUrl.split("/");
			if (parts.length === 2) {
				return { owner: parts[0], repo: parts[1] };
			}
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
			const response = await fetch("/api/repos/public", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					owner: parsed.owner,
					repo: parsed.repo,
				}),
			});

			const data = await response.json();
			
			if (!response.ok) {
				toast.error(data.error || "Failed to fetch repository");
				return;
			}

			const repo: repoType = data.repo;
			setRepoUrl("");
			setShowAddRepo(false);
			toast.success(`Added ${repo.full_name}`);
		} catch (error: any) {
			toast.error(error.message || "Failed to fetch repository");
		} finally {
			setIsLoadingRepo(false);
		}
	}

	return (
		<aside className="shrink-0 w-80 lg:w-96 flex flex-col min-h-0 border-r border-border bg-card">
			<div className="shrink-0 p-4 border-b border-border">
				<p className="text-muted-foreground text-xs uppercase tracking-wider font-medium">Signed in as</p>
				<p className="text-foreground font-semibold truncate mt-0.5">{session?.user?.name ?? session?.user?.email}</p>
			</div>
			<div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden">
				<div className="shrink-0 flex items-center justify-between gap-2 mb-4">
					<div className="flex items-center gap-2">
						<FolderGit2 className="size-5 text-primary" />
						<h2 className="font-semibold text-foreground">Repositories</h2>
					</div>
					<div className="flex items-center gap-2">
						<Button
							onClick={() => setShowAddRepo(!showAddRepo)}
							variant="outline"
							size="sm"
							className="border-border bg-transparent text-foreground hover:bg-secondary hover:text-foreground shrink-0"
							title="Add public repository"
						>
							<Plus className="size-4" />
						</Button>
						<Button
							onClick={handleRefresh}
							variant="outline"
							size="sm"
							disabled={isRefreshing}
							className="border-border bg-transparent text-foreground hover:bg-secondary hover:text-foreground shrink-0"
						>
							<RefreshCcw className={`size-4 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
							Refresh
						</Button>
					</div>
				</div>
				{showAddRepo && (
					<div className="shrink-0 mb-4 p-3 rounded-lg border border-border bg-background">
						<p className="text-xs text-muted-foreground mb-2">Add Public Repository</p>
						<div className="flex gap-2">
							<Input
								type="text"
								placeholder="https://github.com/owner/repo"
								value={repoUrl}
								onChange={(e) => setRepoUrl(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										handleAddPublicRepo();
									}
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
				<ul className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
					{availableRepos.length === 0 ? (
						<li className="text-muted-foreground text-sm py-4 px-3 rounded-lg border border-dashed border-border">
							{repoList.length === 0 
								? "No repositories yet. Connect a repo from a service to see it here."
								: "All repositories have been deployed. Add a new repository to deploy."}
						</li>
					) : (
						availableRepos.map((repo: repoType) => (
							<li key={repo.id}>
									<button
										type="button"
										onClick={() => onOpenDeploySheet(repo)}
										className="w-full text-left rounded-lg border border-border bg-background hover:bg-secondary hover:border-border p-3 transition-colors"
									>
									<p className="font-medium text-foreground truncate">{repo.full_name.split("/")[1]}</p>
									<p className="text-xs text-muted-foreground truncate mt-1">{repo.full_name}</p>
									{repo.latest_commit && (
										<p className="text-xs text-muted-foreground/70 mt-2 truncate" title={repo.latest_commit.message}>
											{repo.latest_commit.message}
										</p>
									)}
									{repo.latest_commit?.date && (
										<p className="text-xs text-muted-foreground/70 mt-0.5">{formatTimestamp(repo.latest_commit.date)}</p>
									)}
								</button>
							</li>
						))
					)}
				</ul>
			</div>
		</aside>
	);
}

