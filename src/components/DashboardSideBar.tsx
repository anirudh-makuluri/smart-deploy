"use client";

import { useSession } from "next-auth/react";
import { FolderGit2, LayoutGrid, History } from "lucide-react";
import { useAppData } from "@/store/useAppData";

type DashboardSideBarProps = {
	activeView: "overview" | "deployments" | "repositories";
	onViewChange: (view: "overview" | "deployments" | "repositories") => void;
};

export default function DashboardSideBar({ activeView, onViewChange }: DashboardSideBarProps) {
	const { data: session } = useSession();
	const { repoList, deployments } = useAppData();
	const activeDeployments = deployments.filter((d) => {
		const hasStoredLiveUrl = Boolean((d.liveUrl ?? "").trim());
		return d.status === "running" && hasStoredLiveUrl;
	}).length;
	const unhealthyDeployments = deployments.filter((d) => d.status === "failed" || d.status === "stopped" || d.status === "paused").length;

	return (
		<aside className="shrink-0 w-80 lg:w-96 flex flex-col min-h-0 border-r border-border bg-card">
			<div className="shrink-0 p-4 border-b border-border">
				<p className="text-muted-foreground text-xs uppercase tracking-wider font-medium">Signed in as</p>
				<p className="text-foreground font-semibold truncate mt-0.5">{session?.user?.name ?? session?.user?.email}</p>
			</div>
			<div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden">
				<div className="shrink-0 space-y-2">
					<button
						type="button"
						onClick={() => onViewChange("overview")}
						className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${activeView === "overview"
								? "border-primary/40 bg-primary/10 text-primary"
								: "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"
							}`}
					>
						<LayoutGrid className="size-4" />
						Deployments
					</button>
					<button
						type="button"
						onClick={() => onViewChange("deployments")}
						className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${activeView === "deployments"
								? "border-primary/40 bg-primary/10 text-primary"
								: "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"
							}`}
					>
						<History className="size-4" />
						History
					</button>
					<button
						type="button"
						onClick={() => onViewChange("repositories")}
						className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${activeView === "repositories"
								? "border-primary/40 bg-primary/10 text-primary"
								: "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"
							}`}
					>
						<FolderGit2 className="size-4" />
						Repositories
					</button>
				</div>
				<div className="mt-auto rounded-lg border border-border bg-background/70 p-3">
					<p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Workspace Stats</p>
					<div className="grid grid-cols-3 gap-2">
						<div className="rounded-md border border-border/70 bg-card px-2 py-2">
							<p className="text-[11px] text-muted-foreground">Repos</p>
							<p className="text-sm font-semibold text-foreground">{repoList.length}</p>
						</div>
						<div className="rounded-md border border-border/70 bg-card px-2 py-2">
							<p className="text-[11px] text-muted-foreground">Active</p>
							<p className="text-sm font-semibold text-foreground">{activeDeployments}</p>
						</div>
						<div className="rounded-md border border-border/70 bg-card px-2 py-2">
							<p className="text-[11px] text-muted-foreground">Issues</p>
							<p className="text-sm font-semibold text-foreground">{unhealthyDeployments}</p>
						</div>
					</div>
				</div>
			</div>
		</aside>
	);
}

