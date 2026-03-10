"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { SmartDeployLogo } from "./SmartDeployLogo";
import { useParams, usePathname } from "next/navigation";
import { useAppData } from "@/store/useAppData";
import { ChevronRight, LogOut, User } from "lucide-react";
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

	const owner = params?.owner as string;
	const repo = params?.repo as string;

	const isHome = pathname === "/home";
	const isRepoPage = !!owner && !!repo && !isHome;

	function handleRepoClick() {
		setActiveServiceName(null);
	}

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
					{session?.user && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button className="flex items-center gap-2 p-1 rounded-full hover:bg-white/5 transition-colors focus:outline-none">
									<div className="size-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden">
										{session.user.image ? (
											<img src={session.user.image} alt={session.user.name || ""} className="size-8" />
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
