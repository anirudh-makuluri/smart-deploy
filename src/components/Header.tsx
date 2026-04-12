"use client";

import { signOut, useSession } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { SmartDeployLogo } from "./SmartDeployLogo";
import { useParams, usePathname } from "next/navigation";
import { useAppData } from "@/store/useAppData";
import { ChevronRight, LogOut, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useWebsocketHealth } from "@/custom-hooks/useWebsocketHealth";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Header() {
	const { data: session } = useSession();
	const params = useParams();
	const pathname = usePathname();
	const { activeServiceName, setActiveServiceName } = useAppData();
	const workerHealth = useWebsocketHealth();

	const owner = params?.owner as string;
	const repo = params?.repo as string;

	const isHome = pathname === "/home";
	const isRepoPage = !!owner && !!repo && !isHome;

	function handleRepoClick() {
		setActiveServiceName(null);
	}

	function handleAvatarKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			event.currentTarget.click();
		}
	}

	const workerStatusClass =
		workerHealth.status === "healthy"
			? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
			: workerHealth.status === "unavailable"
				? "border-destructive/30 bg-destructive/10 text-destructive"
				: "border-border/60 bg-secondary/40 text-muted-foreground";

	return (
		<header className="shrink-0 w-full border-b border-white/5 bg-background/50 backdrop-blur-md sticky top-0 z-50">
			<div className="px-6 py-3 flex flex-row justify-between items-center max-w-[1600px] mx-auto">
				<div className="flex items-center gap-4">
					<SmartDeployLogo href="/home" showText size="sm" />

					{(isHome || isRepoPage) && (
						<nav className="flex items-center gap-2 text-sm font-medium">
							<ChevronRight className="size-4 text-muted-foreground/30" />

							{isHome ? (
								<div className="flex items-center gap-2 text-foreground/80">
									<User className="size-3.5" />
									<span>{session?.user?.name || "User Dashboard"}</span>
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

				<div className="flex flex-row gap-3 items-center">
					<Badge
						variant="outline"
						className={`hidden sm:inline-flex gap-2 px-2.5 py-1 ${workerStatusClass}`}
						title={workerHealth.message}
					>
						<span className={`size-2 rounded-full ${
							workerHealth.status === "healthy"
								? "bg-emerald-400"
								: workerHealth.status === "unavailable"
									? "bg-destructive"
									: "bg-muted-foreground/70"
						}`} />
						Worker {workerHealth.status === "healthy" ? "Online" : workerHealth.status === "unavailable" ? "Offline" : "Checking"}
					</Badge>
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
								<DropdownMenuItem
									className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer mt-1"
									onClick={() => signOut()}
								>
									<LogOut className="size-4 mr-2" />
									<span className="font-bold">Sign out</span>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			</div>
		</header>
	);
}
