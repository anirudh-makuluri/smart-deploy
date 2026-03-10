"use client";

import * as React from "react";
import DashboardMain from "@/components/DashboardMain";
import DashboardSideBar from "@/components/DashboardSideBar";
import Header from "@/components/Header";
import { useAppDataQuery } from "@/hooks/useAppDataQuery";
import { useAppData } from "@/store/useAppData";
import type { repoType } from "@/app/types";
import { useRouter } from "next/navigation";

export default function HomePage() {
	useAppDataQuery(); // Fetch in background and sync to store; no blocking loader
	const { repoList, setActiveServiceName } = useAppData();
	const router = useRouter();
	const [activeView, setActiveView] = React.useState<"overview" | "deployments">("overview");

	React.useEffect(() => {
		setActiveServiceName(null);
	}, [setActiveServiceName]);


	function handleRepoSelect(repo?: repoType) {
		if (!repo) return;
		router.push(`/${repo.owner.login}/${repo.name}`);
	}

	return (
		<div className="landing-bg h-svh overflow-hidden flex flex-col text-foreground">
			<Header />
			<div className="flex flex-1 min-h-0 flex-row w-full overflow-hidden">
				<DashboardSideBar
					onOpenDeploySheet={handleRepoSelect}
					activeView={activeView}
					onViewChange={setActiveView}
				/>
				<div className="w-px shrink-0 bg-border/60" aria-hidden />
				<DashboardMain activeView={activeView} />
			</div>
		</div>
	);
}
