"use client";

import * as React from "react";
import { authClient } from "@/lib/auth-client";
import Image from "next/image";
import Link from "next/link";
import { SmartDeployLogo } from "./SmartDeployLogo";
import HelpAgentSheet from "./HelpAgentSheet";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useAppData } from "@/store/useAppData";
import { Activity, Bot, ChevronRight, LogOut, Menu, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSystemHealth } from "@/custom-hooks/useSystemHealth";
import type { SystemHealthService, SystemHealthStatus } from "@/custom-hooks/useSystemHealth";
import { useWorkerWebSocket } from "@/components/WorkerWebSocketProvider";
import { cn } from "@/lib/utils";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
	const workerWs = useWorkerWebSocket();
	const artifactsHealth = useSystemHealth();
	const [helpAgentOpen, setHelpAgentOpen] = React.useState(false);

	const systemHealth = React.useMemo((): {
		status: SystemHealthStatus;
		message: string;
		services: SystemHealthService[];
	} => {
		const workerOnline = workerWs.hasConnectedOnce || workerWs.socketStatus === "open";
		const wsRow: SystemHealthService = {
			name: "WebSocket server",
			status: workerOnline ? "healthy" : "unavailable",
			message:
				workerWs.socketStatus === "open"
					? "Connected to deploy worker"
					: workerWs.hasConnectedOnce
						? "Deploy worker connected"
					: workerWs.socketStatus === "connecting"
						? "Connecting to deploy worker…"
						: workerWs.socketStatus === "closed"
							? "Disconnected from deploy worker"
							: "Deploy worker unreachable",
		};

		const services: SystemHealthService[] = [wsRow, ...artifactsHealth.services];

		const wsOk = workerOnline;
		const artifactsOk =
			artifactsHealth.services.length > 0 && artifactsHealth.services.every((s) => s.status === "healthy");

		if (workerWs.socketStatus === "connecting" || artifactsHealth.status === "checking") {
			return {
				status: "checking",
				message: "Checking system health",
				services,
			};
		}

		if (artifactsHealth.status === "unavailable" && artifactsHealth.services.length === 0) {
			return {
				status: "unavailable",
				message: artifactsHealth.message,
				services,
			};
		}

		if (wsOk && artifactsOk) {
			return {
				status: "healthy",
				message: "All systems online",
				services,
			};
		}

		return {
			status: "degraded",
			message: "One or more services need attention",
			services,
		};
	}, [workerWs.hasConnectedOnce, workerWs.socketStatus, artifactsHealth]);

	const owner = params?.owner as string;
	const repo = params?.repo as string;

	const isHome = pathname === "/home";
	const isRepoPage = !!owner && !!repo && !isHome;

	function handleRepoClick() {
		setActiveServiceName(null);
	}

	async function handleSignOut() {
		await authClient.signOut();
		router.replace("/auth");
		router.refresh();
	}

	function handleAvatarKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			event.currentTarget.click();
		}
	}

	const workerStatusClass =
		systemHealth.status === "healthy"
			? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
			: systemHealth.status === "degraded" || systemHealth.status === "unavailable"
				? "border-destructive/30 bg-destructive/10 text-destructive"
				: "border-border/60 bg-secondary/40 text-muted-foreground";

	const showMobileNavMenu = Boolean((isHome && homeNav) || (isRepoPage && workspaceNav));

	return (
		<header className="sticky top-0 z-50 w-full shrink-0 border-b border-white/5 bg-background/50 backdrop-blur-md">
			<div className="mx-auto flex max-w-400 flex-row items-center justify-between gap-3 px-3 py-3 sm:gap-4 sm:px-6">
				<div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
					<SmartDeployLogo
						href="/home"
						showText
						size="sm"
						className={cn(showMobileNavMenu && "hidden md:flex")}
					/>
					{showMobileNavMenu ? (
						<div className="flex shrink-0 items-center gap-0.5">
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-9 w-9 shrink-0 md:hidden"
								onClick={() => {
									homeNav?.onOpenMobileSidebar();
									workspaceNav?.onOpenMobileSidebar();
								}}
								aria-label="Open navigation menu"
							>
								<Menu className="size-5" />
							</Button>
						</div>
					) : null}

					{(isHome || isRepoPage) && (
						<nav className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm font-medium">
							<ChevronRight className="size-4 text-muted-foreground/30" />

							{isHome ? (
								<div className="flex min-w-0 items-center gap-2 text-foreground/80">
									<User className="size-3.5 shrink-0" />
									<span className="truncate">{session?.user?.name || "User Dashboard"}</span>
								</div>
							) : (
								<div className="flex items-center gap-2 overflow-hidden">
									<Link
										href="/home"
										className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors truncate"
									>
										<User className="size-3.5" />
										<span>{session?.user?.name || owner}</span>
									</Link>
									<span className="text-muted-foreground/30">/</span>
									<Link
										href={`/${owner}/${repo}`}
										className={`transition-colors truncate ${!activeServiceName ? 'text-foreground font-bold' : 'text-muted-foreground hover:text-foreground'}`}
										onClick={handleRepoClick}
									>
										{repo}
									</Link>

									{activeServiceName && (
										<>
											<span className="text-muted-foreground/30">/</span>
											<span className="text-foreground font-bold truncate">{activeServiceName}</span>
										</>
									)}
								</div>
							)}
						</nav>
					)}
				</div>

				<div className="flex shrink-0 flex-row items-center gap-2 sm:gap-3">
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-8 gap-1.5 px-2.5 text-xs sm:text-sm"
						onClick={() => setHelpAgentOpen(true)}
					>
						<Bot className="size-3.5" />
						<span>Agent</span>
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								className="inline-flex focus:outline-none focus-visible:outline-none focus-visible:ring-0"
								aria-label="View system health"
								title={systemHealth.message}
							>
								<Badge
									variant="outline"
									className={`gap-2 px-2.5 py-1 cursor-pointer ${workerStatusClass}`}
								>
									<span className={`size-2 rounded-full ${
										systemHealth.status === "healthy"
											? "bg-emerald-400"
											: systemHealth.status === "degraded" || systemHealth.status === "unavailable"
												? "bg-destructive"
												: "bg-muted-foreground/70"
									}`} />
									{systemHealth.status === "healthy"
										? "Systems Online"
										: systemHealth.status === "degraded" || systemHealth.status === "unavailable"
											? "Systems Degraded"
											: "Checking Systems"}
								</Badge>
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-80 mt-2 bg-card border-border shadow-2xl backdrop-blur-xl p-0">
							<div className="px-3 py-3 border-b border-border/40">
								<p className="text-sm font-bold">System Health</p>
								<p className="text-xs text-muted-foreground">{systemHealth.message}</p>
							</div>
							<div className="p-2">
								{systemHealth.services.length > 0 ? (
									systemHealth.services.map((service) => (
										<div
											key={service.name}
											className="flex items-start justify-between gap-3 rounded-md px-2 py-2"
										>
											<div className="min-w-0">
												<p className="text-sm font-medium text-foreground">{service.name}</p>
											</div>
											<div className="flex items-center gap-2 shrink-0">
												<span className={`size-2 rounded-full ${service.status === "healthy" ? "bg-emerald-400" : "bg-destructive"}`} />
												<span className={`text-xs font-medium ${service.status === "healthy" ? "text-emerald-300" : "text-destructive"}`}>
													{service.status === "healthy" ? "Online" : "Offline"}
												</span>
											</div>
										</div>
									))
								) : (
									<div className="flex items-center gap-2 rounded-md px-2 py-3 text-sm text-muted-foreground">
										<Activity className="size-4" />
										<span>No service details available yet.</span>
									</div>
								)}
							</div>
						</DropdownMenuContent>
					</DropdownMenu>
					{session?.user && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									className="flex items-center gap-2 p-1 rounded-full hover:bg-white/5 transition-colors focus:outline-none"
									onKeyDown={handleAvatarKeyDown}
								>
									<div className="size-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden">
										{session.user.image ? (
											<Image
												src={session.user.image}
												alt={session.user.name || ""}
												width={32}
												height={32}
												className="w-8 h-auto"
												unoptimized
											/>
										) : (
											<User className="size-4 text-primary" />
										)}
									</div>
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-56 mt-2 bg-card border-border shadow-2xl backdrop-blur-xl">
								<div className="px-3 py-2 border-b border-border/40">
									<p className="text-sm font-bold truncate">{session.user.name}</p>
									<p className="text-[10px] text-muted-foreground truncate">{session.user.email}</p>
								</div>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer mt-1"
									onClick={() => void handleSignOut()}
								>
									<LogOut className="size-4 mr-2" />
									<span className="font-bold">Sign out</span>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			</div>
			<HelpAgentSheet open={helpAgentOpen} onOpenChange={setHelpAgentOpen} />
		</header>
	);
}
