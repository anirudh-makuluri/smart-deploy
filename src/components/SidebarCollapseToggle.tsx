"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";

type SidebarCollapseToggleProps = {
	/** When true, the sidebar is in its narrow state and the control expands it. */
	collapsed: boolean;
	onToggle: () => void;
	className?: string;
};

/** Same control as in `DeployWorkspaceMenu` for expand/collapse. */
export function SidebarCollapseToggle({ collapsed, onToggle, className }: SidebarCollapseToggleProps) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className={cn(
				"flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-white/[0.04] hover:text-foreground",
				className,
			)}
			aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
		>
			{collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
		</button>
	);
}
