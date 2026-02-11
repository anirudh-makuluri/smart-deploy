"use client";

import DashboardMain from "../components/DashboardMain";
import DashboardSideBar from "../components/DashboardSideBar";
import Header from "../components/Header";
import Landing from "../components/Landing";
import { useSession } from "next-auth/react";
import { SmartDeployLogo } from "../components/SmartDeployLogo";

function LoadingPage() {
	return (
		<div className="landing-bg h-svh overflow-hidden flex flex-col items-center justify-center gap-8 text-[#e2e8f0]">
			<SmartDeployLogo showText size="lg" />
			<div className="flex flex-col items-center gap-4">
				<div className="h-10 w-10 rounded-full border-2 border-[#1e3a5f] border-t-[#1d4ed8] animate-spin" />
				<p className="text-sm text-[#94a3b8]">Loading...</p>
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
		<div className="landing-bg h-svh overflow-hidden flex flex-col text-[#e2e8f0]">
			<Header />
			<div className="flex flex-1 min-h-0 flex-row w-full overflow-hidden">
				<DashboardSideBar />
				<div className="w-px flex-shrink-0 bg-[#1e3a5f]/60" aria-hidden />
				<DashboardMain />
			</div>
		</div>
	);
}
