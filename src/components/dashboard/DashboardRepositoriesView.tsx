"use client";

import * as React from "react";
import Link from "next/link";
import { Boxes, ExternalLink, Plus, RefreshCcw } from "lucide-react";
import LanguageIcon from "@/components/LanguageIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTimestamp } from "@/lib/utils";
import type { repoType } from "@/app/types";

type DashboardRepositoriesViewProps = {
	repoList: repoType[];
	visibleRepositories: repoType[];
	repoSearch: string;
	onRepoSearchChange: (value: string) => void;
	showAddRepo: boolean;
	onToggleAddRepo: () => void;
	repoUrl: string;
	onRepoUrlChange: (value: string) => void;
	isLoadingRepo: boolean;
	isRefreshing: boolean;
	isLoading: boolean;
	onAddPublicRepo: () => void;
	onRefresh: () => void;
	onCancelAddRepo: () => void;
};

export default function DashboardRepositoriesView({
	repoList,
	visibleRepositories,
	repoSearch,
	onRepoSearchChange,
	showAddRepo,
	onToggleAddRepo,
	repoUrl,
	onRepoUrlChange,
	isLoadingRepo,
	isRefreshing,
	isLoading,
	onAddPublicRepo,
	onRefresh,
	onCancelAddRepo,
}: DashboardRepositoriesViewProps) {
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-2">
				<h2 className="text-lg font-semibold text-foreground">All Repositories</h2>
				<div className="flex items-center gap-2">
					<Button
						type="button"
						onClick={onToggleAddRepo}
						variant="outline"
						size="sm"
						className="border-border bg-transparent text-foreground hover:bg-secondary hover:text-foreground"
						title="Add public repository"
					>
						<Plus className="size-4" />
					</Button>
					<Button
						type="button"
						onClick={onRefresh}
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
			{showAddRepo ? (
				<div className="p-3 rounded-lg border border-border bg-background">
					<p className="text-xs text-muted-foreground mb-2">Add Public Repository</p>
					<div className="flex gap-2">
						<Input
							type="text"
							placeholder="https://github.com/owner/repo"
							value={repoUrl}
							onChange={(e) => onRepoUrlChange(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") onAddPublicRepo();
								if (e.key === "Escape") onCancelAddRepo();
							}}
							className="flex-1 border-border bg-background text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary text-sm"
							disabled={isLoadingRepo}
						/>
						<Button
							type="button"
							onClick={onAddPublicRepo}
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
					<p className="text-xs text-muted-foreground/70 mt-2">Enter any public GitHub repository URL</p>
				</div>
			) : null}
			<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
				<Input
					type="text"
					placeholder="Search repositories..."
					value={repoSearch}
					onChange={(e) => onRepoSearchChange(e.target.value)}
					className="max-w-md border-border bg-background text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary text-sm"
				/>
				<p className="text-xs text-muted-foreground">
					{repoSearch.trim()
						? `${visibleRepositories.length} result${visibleRepositories.length !== 1 ? "s" : ""}`
						: `Showing latest ${Math.min(10, repoList.length)} of ${repoList.length} repositories`}
				</p>
			</div>
			{repoList.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-dashed border-border/60 bg-card/20 text-center">
					<Boxes className="size-12 text-muted-foreground/70 mb-4" />
					<p className="text-foreground font-medium">{isLoading ? "Loading…" : "No repositories yet"}</p>
				</div>
			) : visibleRepositories.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-dashed border-border/60 bg-card/20 text-center">
					<Boxes className="size-12 text-muted-foreground/70 mb-4" />
					<p className="text-foreground font-medium">No repositories match your search</p>
					<p className="text-sm text-muted-foreground mt-1">Try a different owner, name, or commit keyword.</p>
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
					{visibleRepositories.map((repo) => (
						<Link
							key={repo.id}
							href={`/${repo.full_name}`}
							className="rounded-xl border border-border p-4 bg-card hover:border-primary/40 transition-colors"
						>
							<div className="flex items-center gap-3 min-w-0">
								<LanguageIcon language={repo.language} />
								<div className="min-w-0">
									<p className="font-semibold text-foreground truncate">{repo.name}</p>
									{repo.latest_commit ? (
										<p className="text-sm text-muted-foreground truncate mt-1">{repo.latest_commit.message}</p>
									) : null}
									{repo.latest_commit?.date ? (
										<p className="text-xs text-muted-foreground/70 mt-1">
											{formatTimestamp(repo.latest_commit.date)}
										</p>
									) : null}
								</div>
							</div>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
