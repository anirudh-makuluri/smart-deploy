"use client";

import * as React from "react";
import DashboardMain, { DashboardMainProps } from "@/components/DashboardMain";
import DashboardSideBar from "@/components/DashboardSideBar";
import GithubAppSetupBanner from "@/components/dashboard/GithubAppSetupBanner";
import Header from "@/components/Header";
import { useAppDataQuery } from "@/hooks/useAppDataQuery";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export default function HomePageClient() {
	useAppDataQuery(); // Fetch in background and sync to store; no blocking loader
	const [activeView, setActiveView] = React.useState<DashboardMainProps['activeView']>("overview");
	const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
	const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

	return (
		<div className="landing-bg flex h-svh flex-col overflow-hidden text-foreground">
			<Header homeNav={{ onOpenMobileSidebar: () => setMobileNavOpen(true) }} />
			<GithubAppSetupBanner />
			<div className="flex min-h-0 w-full flex-1 flex-row overflow-hidden">
				<div
					className={cn(
						"hidden min-h-0 shrink-0 overflow-hidden border-r border-border bg-card transition-[width] duration-200 ease-out md:flex",
						sidebarCollapsed ? "w-16" : "w-72 lg:w-80",
					)}
				>
					<DashboardSideBar
						activeView={activeView}
						onViewChange={setActiveView}
						collapsed={sidebarCollapsed}
						onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
					/>
				</div>
				<div className="hidden w-px shrink-0 bg-border/60 md:block" aria-hidden />
				<DashboardMain activeView={activeView} />
			</div>

			<Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
				<SheetContent
					side="left"
					className="z-100 flex w-[min(20rem,calc(100vw-2rem))] max-w-[20rem] flex-col gap-0 border-r border-border p-0 [&>button]:text-foreground"
				>
					<SheetTitle className="sr-only">Workspace navigation</SheetTitle>
					<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
						<DashboardSideBar
							activeView={activeView}
							onViewChange={(view) => {
								setActiveView(view);
								setMobileNavOpen(false);
							}}
							collapsed={false}
						/>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}
