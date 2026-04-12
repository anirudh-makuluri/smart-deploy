"use client";

import { useSession } from "next-auth/react";
import { FolderGit2, LayoutGrid, History, User } from "lucide-react";
import { SidebarCollapseToggle } from "@/components/SidebarCollapseToggle";
import { useAppData } from "@/store/useAppData";
import { cn } from "@/lib/utils";

type DashboardSideBarProps = {
	activeView: "overview" | "deployments" | "repositories";
	onViewChange: (view: "overview" | "deployments" | "repositories") => void;
	/** Narrow icon rail (desktop only; mobile sheet always expanded). */
	collapsed?: boolean;
	/** When set (desktop rail only), shows the same collapse control row as `DeployWorkspaceMenu`. */
	onToggleCollapsed?: () => void;
};

const navButtonBase =
	"w-full flex items-center rounded-lg border transition-colors text-left";

export default function DashboardSideBar({
	activeView,
	onViewChange,
	collapsed = false,
	onToggleCollapsed,
}: DashboardSideBarProps) {
	const { data: session } = useSession();
	const { repoList, deployments } = useAppData();
	const activeDeployments = deployments.filter((d) => {
		const hasStoredLiveUrl = Boolean((d.liveUrl ?? "").trim());
		return d.status === "running" && hasStoredLiveUrl;
	}).length;
	const unhealthyDeployments = deployments.filter(
		(d) => d.status === "failed" || d.status === "stopped" || d.status === "paused",
	).length;

	const userLabel = session?.user?.name ?? session?.user?.email ?? "Account";

	return (
		<aside
			className="flex h-full min-h-0 w-full min-w-0 flex-col bg-card"
			aria-label="Workspace navigation"
		>
			{onToggleCollapsed ? (
				<div
					className={cn(
						"shrink-0 border-b border-border",
						collapsed ? "px-3 py-4" : "px-4 py-4",
					)}
				>
					<div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between gap-3")}>
						{!collapsed ? (
							<p className="text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground/65">
								Dashboard
							</p>
						) : null}
						<SidebarCollapseToggle collapsed={collapsed} onToggle={onToggleCollapsed} />
					</div>
				</div>
			) : null}
			<div
				className={cn(
					"shrink-0 border-b border-border",
					collapsed ? "flex justify-center px-2 py-3" : "p-4",
				)}
			>
				{collapsed ? (
					<div
						className="flex size-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground"
						title={userLabel}
					>
						<User className="size-4 shrink-0" aria-hidden />
						<span className="sr-only">Signed in as {userLabel}</span>
					</div>
				) : (
					<>
						<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Signed in as</p>
						<p className="mt-0.5 truncate font-semibold text-foreground">{userLabel}</p>
					</>
				)}
			</div>
			<div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", collapsed ? "p-2" : "p-4")}>
				<div className={cn("shrink-0 space-y-2", collapsed && "space-y-2")}>
					<button
						type="button"
						onClick={() => onViewChange("overview")}
						title="Deployments"
						className={cn(
							navButtonBase,
							collapsed ? "justify-center px-0 py-2.5" : "gap-2 px-3 py-2",
							activeView === "overview"
								? "border-primary/40 bg-primary/10 text-primary"
								: "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground",
						)}
					>
						<LayoutGrid className="size-4 shrink-0" aria-hidden />
						{collapsed ? <span className="sr-only">Deployments</span> : <span>Deployments</span>}
					</button>
					<button
						type="button"
						onClick={() => onViewChange("deployments")}
						title="History"
						className={cn(
							navButtonBase,
							collapsed ? "justify-center px-0 py-2.5" : "gap-2 px-3 py-2",
							activeView === "deployments"
								? "border-primary/40 bg-primary/10 text-primary"
								: "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground",
						)}
					>
						<History className="size-4 shrink-0" aria-hidden />
						{collapsed ? <span className="sr-only">History</span> : <span>History</span>}
					</button>
					<button
						type="button"
						onClick={() => onViewChange("repositories")}
						title="Repositories"
						className={cn(
							navButtonBase,
							collapsed ? "justify-center px-0 py-2.5" : "gap-2 px-3 py-2",
							activeView === "repositories"
								? "border-primary/40 bg-primary/10 text-primary"
								: "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground",
						)}
					>
						<FolderGit2 className="size-4 shrink-0" aria-hidden />
						{collapsed ? <span className="sr-only">Repositories</span> : <span>Repositories</span>}
					</button>
				</div>
				{!collapsed && (
					<div className="mt-auto rounded-lg border border-border bg-background/70 p-3">
						<p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Workspace Stats</p>
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
				)}
			</div>
		</aside>
	);
}
