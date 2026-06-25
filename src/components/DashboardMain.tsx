"use client";

import DashboardDeploymentsView from "@/components/dashboard/DashboardDeploymentsView";
import DashboardOverviewView from "@/components/dashboard/DashboardOverviewView";
import DashboardRepositoriesView from "@/components/dashboard/DashboardRepositoriesView";
import { useDashboardMain } from "@/components/dashboard/useDashboardMain";

export type DashboardMainProps = {
	activeView: "overview" | "history" | "repositories";
};

export default function DashboardMain({ activeView }: DashboardMainProps) {
	const {
		session,
		isLoading,
		repoCards,
		visibleRepositories,
		repoList,
		ui,
		dispatch,
		handleRefresh,
		handleAddPublicRepo,
	} = useDashboardMain();

	return (
		<main className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div className="border-b border-border/60 p-4 sm:p-6">
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div>
						<p className="text-xs uppercase tracking-wider text-muted-foreground">
							Workspaces / {session?.user?.name ?? "Workspace"}
						</p>
						<h1 className="font-semibold text-xl text-foreground">
							{activeView === "overview"
								? "Deployments"
								: activeView === "history"
									? "History"
									: "Repositories"}
						</h1>
					</div>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] sm:px-6 sm:pt-6 sm:pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] md:p-6">
				<div className={activeView === "overview" ? "" : "hidden"}>
					<DashboardOverviewView repoCards={repoCards} isLoading={isLoading} />
				</div>
				<div className={activeView === "history" ? "" : "hidden"}>
					<DashboardDeploymentsView />
				</div>
				<div className={activeView === "repositories" ? "" : "hidden"}>
					<DashboardRepositoriesView
						repoList={repoList}
						visibleRepositories={visibleRepositories}
						repoSearch={ui.repoSearch}
						onRepoSearchChange={(value) => dispatch({ type: "set_repo_search", value })}
						ui={{
							showAddRepo: ui.showAddRepo,
							isLoadingRepo: ui.isLoadingRepo,
							isRefreshing: ui.isRefreshing,
							isLoading,
						}}
						onToggleAddRepo={() => dispatch({ type: "toggle_add_repo" })}
						repoUrl={ui.repoUrl}
						onRepoUrlChange={(value) => dispatch({ type: "set_repo_url", value })}
						onAddPublicRepo={handleAddPublicRepo}
						onRefresh={handleRefresh}
						onCancelAddRepo={() => dispatch({ type: "reset_add_repo" })}
					/>
				</div>
			</div>
		</main>
	);
}
