"use client";

import { Bot, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

type HeaderMobileDockProps = {
	onOpenHelpAgent: () => void;
	onOpenMobileNavMenu: () => void;
	className?: string;
};

const dockButtonClassName =
	"group flex min-w-[6.5rem] items-center justify-center gap-2 rounded-[1rem] px-3.5 py-3 text-sm font-medium text-foreground/88 transition-all hover:bg-white/[0.06] active:scale-[0.985]";

export default function HeaderMobileDock({
	onOpenHelpAgent,
	onOpenMobileNavMenu,
	className,
}: HeaderMobileDockProps) {
	return (
		<div
			className={cn(
				"pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-50 flex justify-center md:hidden",
				className,
			)}
		>
			<div className="pointer-events-auto flex items-center gap-1 rounded-[1.4rem] border border-white/10 bg-background/76 p-1.5 shadow-[0_24px_80px_-28px_rgba(0,0,0,0.75)] ring-1 ring-white/6 backdrop-blur-2xl">
				<button
					type="button"
					onClick={onOpenHelpAgent}
					className={dockButtonClassName}
					aria-label="Open agent"
				>
					<span className="flex size-8 items-center justify-center rounded-full bg-primary/14 text-primary">
						<Bot className="size-4" />
					</span>
					<span>Agent</span>
				</button>
				<span aria-hidden className="h-8 w-px rounded-full bg-white/8" />
				<button
					type="button"
					onClick={onOpenMobileNavMenu}
					className={dockButtonClassName}
					aria-label="Open menu"
				>
					<span className="flex size-8 items-center justify-center rounded-full bg-white/[0.06] text-foreground">
						<Menu className="size-4" />
					</span>
					<span>Menu</span>
				</button>
			</div>
		</div>
	);
}
