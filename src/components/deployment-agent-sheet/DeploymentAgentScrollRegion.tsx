"use client";

import * as React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type DeploymentAgentScrollRegionProps = {
	children: React.ReactNode;
	useCustomScrollbar: boolean;
};

export function DeploymentAgentScrollRegion({
	children,
	useCustomScrollbar,
}: DeploymentAgentScrollRegionProps) {
	if (useCustomScrollbar) {
		return (
			<ScrollArea className="h-0 min-h-0 flex-1 overflow-hidden">
				<div className="min-w-0 w-full max-w-full overflow-x-hidden px-5 py-5">{children}</div>
			</ScrollArea>
		);
	}

	return (
		<div
			className={cn(
				"min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-5 py-5",
				"[-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			)}
		>
			{children}
		</div>
	);
}
