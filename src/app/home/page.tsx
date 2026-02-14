"use client";

import * as React from "react";
import { AppDataLoader } from "@/components/AppDataLoader";
import DashboardMain from "@/components/DashboardMain";
import DashboardSideBar from "@/components/DashboardSideBar";
import Header from "@/components/Header";
import NewDeploySheet from "@/components/NewDeploySheet";
import { useAppData } from "@/store/useAppData";
import type { repoType } from "@/app/types";

export default function HomePage() {
	const { repoList, deployments } = useAppData();
	const [isDeploySheetOpen, setIsDeploySheetOpen] = React.useState(false);
	const [selectedRepo, setSelectedRepo] = React.useState<repoType | null>(null);

	const availableRepos = React.useMemo(() => {
		return repoList.filter((repo) => !deployments.some((dep) => dep.url === repo.html_url));
	}, [repoList, deployments]);

	function openDeploySheet(repo?: repoType) {
		if (!repo && availableRepos.length === 0) {
			return;
		}
		setSelectedRepo(repo ?? availableRepos[0] ?? null);
		setIsDeploySheetOpen(true);
	}

	function closeDeploySheet() {
		setIsDeploySheetOpen(false);
		setSelectedRepo(null);
	}

	return (
		<AppDataLoader>
			<div className="landing-bg h-svh overflow-hidden flex flex-col text-foreground">
				<Header />
				<div className="flex flex-1 min-h-0 flex-row w-full overflow-hidden">
					<DashboardSideBar onOpenDeploySheet={openDeploySheet} />
					<div className="w-px shrink-0 bg-border/60" aria-hidden />
					<DashboardMain onNewDeploy={() => openDeploySheet()} />
				</div>
			</div>
			{selectedRepo && (
				<NewDeploySheet
					open={isDeploySheetOpen}
					onClose={closeDeploySheet}
					repo={selectedRepo}
				/>
			)}
		</AppDataLoader>
	);
}
