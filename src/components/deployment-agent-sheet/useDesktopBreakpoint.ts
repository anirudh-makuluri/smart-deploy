"use client";

import * as React from "react";

export function useDesktopBreakpoint(): boolean {
	return React.useSyncExternalStore(
		(onStoreChange) => {
			const query = window.matchMedia("(min-width: 640px)");
			query.addEventListener("change", onStoreChange);
			return () => query.removeEventListener("change", onStoreChange);
		},
		() => window.matchMedia("(min-width: 640px)").matches,
		() => false
	);
}
