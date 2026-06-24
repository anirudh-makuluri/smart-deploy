"use client";

import Image from "next/image";
import { Activity, Bot, Bug, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { HeaderSystemHealth } from "@/components/header/useHeaderSystemHealth";
import { systemHealthStatusClass } from "@/components/header/useHeaderSystemHealth";
import { cn } from "@/lib/utils";

function handleAvatarKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		event.currentTarget.click();
	}
}

type HeaderActionsProps = {
	systemHealth: HeaderSystemHealth;
	session?: {
		user?: {
			name?: string | null;
			email?: string | null;
			image?: string | null;
		} | null;
	} | null;
	onOpenHelpAgent: () => void;
	onOpenReport: () => void;
	onSignOut: () => void;
	mobileDockEnabled?: boolean;
};

export default function HeaderActions({
	systemHealth,
	session,
	onOpenHelpAgent,
	onOpenReport,
	onSignOut,
	mobileDockEnabled = false,
}: HeaderActionsProps) {
	const workerStatusClass = systemHealthStatusClass(systemHealth.status);
	const healthIndicatorClassName =
		systemHealth.status === "healthy"
			? "border-border/60 bg-background/72 text-muted-foreground"
			: workerStatusClass;

	return (
		<div className="flex shrink-0 flex-row items-center gap-2 sm:gap-3">
			<Button
				type="button"
				variant="outline"
				size="sm"
				className={cn("h-8 gap-1.5 px-2.5 text-xs sm:text-sm", mobileDockEnabled && "hidden md:inline-flex")}
				onClick={onOpenHelpAgent}
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
						<span
							data-testid="system-health-indicator"
							className={cn(
								"relative inline-flex size-9 items-center justify-center rounded-full border bg-background/80 text-foreground",
								healthIndicatorClassName,
							)}
						>
							<Activity className="size-4" />
							<span
								className={cn(
									"absolute right-2 top-2 size-2 rounded-full ring-2 ring-background",
									systemHealth.status === "healthy"
										? "bg-emerald-400"
										: systemHealth.status === "degraded" || systemHealth.status === "unavailable"
											? "bg-destructive"
											: "bg-muted-foreground/70",
								)}
							/>
						</span>
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
								<div key={service.name} className="flex items-start justify-between gap-3 rounded-md px-2 py-2">
									<div className="min-w-0">
										<p className="text-sm font-medium text-foreground">{service.name}</p>
									</div>
									<div className="flex items-center gap-2 shrink-0">
										<span
											className={`size-2 rounded-full ${service.status === "healthy" ? "bg-emerald-400" : "bg-destructive"}`}
										/>
										<span
											className={`text-xs font-medium ${service.status === "healthy" ? "text-emerald-300" : "text-destructive"}`}
										>
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
			{session?.user ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className="flex items-center gap-2 p-1 rounded-full hover:bg-white/5 transition-colors focus:outline-none"
							aria-label="Open profile menu"
							title="Open profile menu"
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
						<DropdownMenuItem className="cursor-pointer mt-1" onClick={onOpenReport}>
							<Bug className="size-4 mr-2" />
							<span className="font-medium">Report issue</span>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer mt-1"
							onClick={() => void onSignOut()}
						>
							<LogOut className="size-4 mr-2" />
							<span className="font-bold">Sign out</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</div>
	);
}
