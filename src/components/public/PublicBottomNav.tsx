"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export type MobileNavLink = { href: string; label: string };

type PublicBottomNavProps = {
	links: MobileNavLink[];
	className?: string;
};

const linkClassName =
	"flex min-h-12 w-full min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-2 text-center text-[10px] font-semibold leading-tight text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-primary/10 sm:px-1.5 sm:text-[11px]";

export function PublicBottomNav({ links, className }: PublicBottomNavProps) {
	if (links.length < 2) {
		return null;
	}

	return (
		<nav
			className={cn(
				"fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/92 backdrop-blur-xl md:hidden",
				className,
			)}
			aria-label="Section navigation"
		>
			<div className="pb-[env(safe-area-inset-bottom)]">
				<ul className="mx-auto flex w-full max-w-7xl items-stretch gap-0 px-1 sm:px-3">
					{links.map((link) => (
						<li key={`${link.href}-${link.label}`} className="flex min-w-0 flex-1">
							{link.href.startsWith("#") ? (
								<a href={link.href} className={linkClassName}>
									<span className="line-clamp-2">{link.label}</span>
								</a>
							) : (
								<Link href={link.href} className={linkClassName}>
									<span className="line-clamp-2">{link.label}</span>
								</Link>
							)}
						</li>
					))}
				</ul>
			</div>
		</nav>
	);
}
