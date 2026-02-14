"use client";

import DashboardDeploymentItem from "./DashboardDeploymentItem";
import { DeployConfig } from "@/app/types";
import { useAppData } from "@/store/useAppData";
import { Boxes } from "lucide-react";

export default function DashboardMain() {
	const { deployments, repoList } = useAppData();

	function getRepo(dep: DeployConfig) {
		return repoList.find((repo) => repo.html_url === dep.url);
	}

	const activeDeployments = deployments.filter((dep) => dep.status !== "didnt_deploy");

	return (
		<main className="flex-1 min-h-0 flex flex-col overflow-hidden">
			<div className="p-6 border-b border-border/60">
				<div className="flex items-center gap-2">
					<Boxes className="size-6 text-teal-400" />
					<h1 className="font-semibold text-xl text-foreground">Services</h1>
				</div>
				<p className="text-sm text-muted-foreground mt-1">
					{activeDeployments.length} service{activeDeployments.length !== 1 ? "s" : ""} deployed
				</p>
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto p-6">
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
						{activeDeployments.map((dep, i) => (
							<DashboardDeploymentItem
								deployConfig={dep}
								key={dep.id}
								repo={getRepo(dep)}
							/>
						))}
					</div>
				)}
			</div>
		</main>
	);
}

