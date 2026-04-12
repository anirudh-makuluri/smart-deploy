import type { ReactNode } from "react";

/** Viewport-height scroll container with stealth scrollbar (docs, changelog, and similar public routes). */
export function PublicPageScroll({ children }: { children: ReactNode }) {
	return (
		<div className="h-svh overflow-x-hidden overflow-y-auto scroll-smooth stealth-scrollbar text-foreground">
			{children}
		</div>
	);
}
