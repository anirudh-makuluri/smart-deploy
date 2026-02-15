"use client";

import DashboardDeploymentItem from "./DashboardDeploymentItem";
import DeploymentHistoryTable from "./DeploymentHistoryTable";
import { DeployConfig } from "@/app/types";
import { useAppData } from "@/store/useAppData";
import { Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";

type DashboardMainProps = {
	onNewDeploy: () => void;
	activeView: "overview" | "deployments";
};

export default function DashboardMain({ onNewDeploy, activeView }: DashboardMainProps) {
	const { data: session } = useSession();
	const { deployments, repoList } = useAppData();

	function getRepo(dep: DeployConfig) {
		return repoList.find((repo) => repo.html_url === dep.url);
	}

	const activeDeployments = deployments.filter((dep) => dep.status !== "didnt_deploy");

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
				{/* Overview View */}
				<div className={activeView === "overview" ? "" : "hidden"}>
					<div className="space-y-6">
						<div className="flex items-center justify-between gap-3">
							<div>
								<h2 className="text-lg font-semibold text-foreground">Active Services</h2>
								<p className="text-sm text-muted-foreground">
									{activeDeployments.length} service{activeDeployments.length !== 1 ? "s" : ""} deployed
								</p>
							</div>
						</div>
						{activeDeployments.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-dashed border-border/60 bg-card/20 text-center">
								<Boxes className="size-12 text-muted-foreground/70 mb-4" />
								<p className="text-foreground font-medium">No services yet</p>
								<p className="text-sm text-muted-foreground mt-1 max-w-sm">
									Add a repository and deploy to see your services here.
								</p>
							</div>
						) : (
							<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
								{activeDeployments.map((dep) => (
									<DashboardDeploymentItem
										deployConfig={dep}
										key={dep.id}
										repo={getRepo(dep)}
									/>
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

