"use client";

import * as React from "react";
import DashboardMain from "@/components/DashboardMain";
import DashboardSideBar from "@/components/DashboardSideBar";
import Header from "@/components/Header";
import NewDeploySheet from "@/components/NewDeploySheet";
import { useAppDataQuery } from "@/hooks/useAppDataQuery";
import { useAppData } from "@/store/useAppData";
import type { repoType } from "@/app/types";

export default function HomePage() {
	useAppDataQuery(); // Fetch in background and sync to store; no blocking loader
	const { repoList, deployments } = useAppData();
	const [isDeploySheetOpen, setIsDeploySheetOpen] = React.useState(false);
	const [selectedRepo, setSelectedRepo] = React.useState<repoType | null>(null);
	const [activeView, setActiveView] = React.useState<"overview" | "deployments">("overview");

	function openDeploySheet(repo?: repoType) {
		if (!repo && repoList.length === 0) {
			return;
		}
		setSelectedRepo(repo ?? repoList[0] ?? null);
		setIsDeploySheetOpen(true);
	}

	function closeDeploySheet() {
		setIsDeploySheetOpen(false);
		setSelectedRepo(null);
	}

	return (
		<div className="landing-bg h-svh overflow-hidden flex flex-col text-foreground">
			<Header />
			<div className="flex flex-1 min-h-0 flex-row w-full overflow-hidden">
				<DashboardSideBar
					onOpenDeploySheet={openDeploySheet}
					activeView={activeView}
					onViewChange={setActiveView}
				/>
				<div className="w-px shrink-0 bg-border/60" aria-hidden />
				<DashboardMain onNewDeploy={() => openDeploySheet()} activeView={activeView} />
			</div>
			{selectedRepo && (
				<NewDeploySheet
					open={isDeploySheetOpen}
					onClose={closeDeploySheet}
					repo={selectedRepo}
				/>
			)}
		</div>
	);
}
