"use client";

import Link from "next/link";
import { useRef } from "react";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";

export type MobileNavLink = { href: string; label: string };

type MobileNavMenuProps = {
	links: MobileNavLink[];
	className?: string;
};

export function MobileNavMenu({ links, className }: MobileNavMenuProps) {
	const detailsRef = useRef<HTMLDetailsElement>(null);

	const close = () => {
		detailsRef.current?.removeAttribute("open");
	};

	return (
		<details ref={detailsRef} className={cn("relative", className)}>
			<summary
				className="flex cursor-pointer list-none items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-background/85 px-2.5 py-2 text-xs font-semibold text-foreground shadow-sm outline-none transition-colors hover:border-primary/35 hover:bg-background [&::-webkit-details-marker]:hidden focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/45"
				aria-label="Open navigation menu"
			>
				<Menu className="size-3.5 opacity-80" aria-hidden />
				Menu
			</summary>
			<div className="absolute right-0 z-50 mt-2 w-[min(100vw-2rem,16rem)] max-h-[min(70vh,22rem)] overflow-y-auto overscroll-contain rounded-2xl border border-border/70 bg-card/95 p-1.5 shadow-lg backdrop-blur-xl stealth-scrollbar">
				{links.map((link) =>
					link.href.startsWith("#") ? (
						<a
							key={link.href}
							href={link.href}
							onClick={close}
							className="block rounded-xl px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
						>
							{link.label}
						</a>
					) : (
						<Link
							key={link.href}
							href={link.href}
							onClick={close}
							className="block rounded-xl px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
						>
							{link.label}
						</Link>
					),
				)}
			</div>
		</details>
	);
}
