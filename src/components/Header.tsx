"use client";

import * as React from "react";
import { authClient } from "@/lib/auth-client";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useAppData } from "@/store/useAppData";
import DeploymentAgentSheet from "@/components/DeploymentAgentSheet";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import UserReportSheet from "@/components/UserReportSheet";
import HeaderActions from "@/components/header/HeaderActions";
import HeaderBreadcrumbs from "@/components/header/HeaderBreadcrumbs";
import HeaderMobileDock from "@/components/header/HeaderMobileDock";
import { useHeaderSystemHealth } from "@/components/header/useHeaderSystemHealth";
import { cn } from "@/lib/utils";

export type HeaderHomeNavProps = {
	onOpenMobileSidebar: () => void;
};

/** Same shape as `homeNav`: opens the deploy workspace menu sheet on small screens. */
export type HeaderWorkspaceNavProps = HeaderHomeNavProps;

type HeaderProps = {
	homeNav?: HeaderHomeNavProps;
	workspaceNav?: HeaderWorkspaceNavProps;
};

export default function Header({ homeNav, workspaceNav }: HeaderProps) {
	const { data: session } = authClient.useSession();
	const router = useRouter();
	const params = useParams();
	const pathname = usePathname();
	const { activeServiceName, setActiveServiceName } = useAppData();
	const systemHealth = useHeaderSystemHealth();
	const [reportOpen, setReportOpen] = React.useState(false);
	const [helpAgentOpen, setHelpAgentOpen] = React.useState(false);

	const owner = params?.owner as string;
	const repo = params?.repo as string;
	const isHome = pathname === "/home";
	const isRepoPage = !!owner && !!repo && !isHome;
	const showMobileNavMenu = Boolean((isHome && homeNav) || (isRepoPage && workspaceNav));

	async function handleSignOut() {
		await authClient.signOut();
		router.replace("/auth");
		router.refresh();
	}

	return (
		<>
			<header className="sticky top-0 z-50 w-full shrink-0 border-b border-white/5 bg-background/50 backdrop-blur-md">
				<div className="mx-auto flex max-w-400 flex-row items-center justify-between gap-3 px-3 py-3 sm:gap-4 sm:px-6">
					<div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
						<SmartDeployLogo href="/home" showText size="sm" className={cn(showMobileNavMenu && "hidden md:flex")} />
						<HeaderBreadcrumbs
							isHome={isHome}
							isRepoPage={isRepoPage}
							sessionName={session?.user?.name}
							owner={owner}
							repo={repo}
							activeServiceName={activeServiceName}
							onRepoClick={() => setActiveServiceName(null)}
						/>
					</div>
					<HeaderActions
						systemHealth={systemHealth}
						session={session}
						onOpenHelpAgent={() => setHelpAgentOpen(true)}
						onOpenReport={() => setReportOpen(true)}
						onSignOut={handleSignOut}
						mobileDockEnabled={showMobileNavMenu}
					/>
				</div>
				<UserReportSheet
					open={reportOpen}
					onOpenChange={setReportOpen}
					pagePath={pathname || "/"}
					repoOwner={owner || undefined}
					repoName={repo || undefined}
					serviceName={activeServiceName || null}
				/>
				<DeploymentAgentSheet open={helpAgentOpen} onOpenChange={setHelpAgentOpen} />
			</header>
			{showMobileNavMenu ? (
				<HeaderMobileDock
					onOpenHelpAgent={() => setHelpAgentOpen(true)}
					onOpenMobileNavMenu={() => {
						homeNav?.onOpenMobileSidebar();
						workspaceNav?.onOpenMobileSidebar();
					}}
				/>
			) : null}
		</>
	);
}
