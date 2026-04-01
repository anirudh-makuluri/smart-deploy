"use client";

import * as React from "react";
import DashboardMain from "@/components/DashboardMain";
import DashboardSideBar from "@/components/DashboardSideBar";
import Header from "@/components/Header";
import { useAppDataQuery } from "@/hooks/useAppDataQuery";
import { useAppData } from "@/store/useAppData";

export default function HomePage() {
	useAppDataQuery(); // Fetch in background and sync to store; no blocking loader
	const { deployments, isLoading, setActiveServiceName } = useAppData();
	const [activeView, setActiveView] = React.useState<"overview" | "deployments" | "repositories">("overview");
	const hasResolvedInitialView = React.useRef(false);

	React.useEffect(() => {
		setActiveServiceName(null);
	}, [setActiveServiceName]);

	React.useEffect(() => {
		if (hasResolvedInitialView.current || isLoading) return;
		hasResolvedInitialView.current = true;
		if (deployments.length === 0 && activeView === "overview") {
			setActiveView("repositories");
		}
	}, [activeView, deployments.length, isLoading]);

	return (
		<div className="landing-bg h-svh overflow-hidden flex flex-col text-foreground">
			<Header />
			<div className="flex flex-1 min-h-0 flex-row w-full overflow-hidden">
				<DashboardSideBar
					activeView={activeView}
					onViewChange={setActiveView}
				/>
				<div className="w-px shrink-0 bg-border/60" aria-hidden />
				<DashboardMain activeView={activeView} />
			</div>
		</div>
	);
}
