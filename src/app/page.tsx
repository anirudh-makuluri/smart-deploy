"use client";

import DashboardMain from "../components/DashboardMain";
import DashboardSideBar from "../components/DashboardSideBar";
import Header from "../components/Header";
import Landing from "../components/Landing";
import { useSession } from "next-auth/react";
import { SmartDeployLogo } from "../components/SmartDeployLogo";

function LoadingPage() {
	return (
		<div className="landing-bg h-svh overflow-hidden flex flex-col items-center justify-center gap-8 text-foreground">
			<SmartDeployLogo showText size="lg" />
			<div className="flex flex-col items-center gap-4">
				<div className="h-10 w-10 rounded-full border-2 border-border border-t-primary animate-spin" />
				<p className="text-sm text-muted-foreground">Loading...</p>
			</div>
		</div>
	);
}

export default function Home() {
	const { data: session, status } = useSession();

	if (status === "loading") {
		return <LoadingPage />;
	}

	if (!session) {
		return <Landing />;
	}

	return (
		<div className="landing-bg h-svh overflow-hidden flex flex-col text-foreground">
			<Header />
			<div className="flex flex-1 min-h-0 flex-row w-full overflow-hidden">
				<DashboardSideBar />
				<div className="w-px flex-shrink-0 bg-border/60" aria-hidden />
				<DashboardMain />
			</div>
		</div>
	);
}


