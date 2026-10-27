"use client";
import { useCallback, useSyncExternalStore } from "react";

export function useDemoExpiry(expiresAt: number): boolean {
	const subscribe = useCallback((notify: () => void) => {
		const timer = setTimeout(notify, Math.max(0, Math.min(2147483647, expiresAt - Date.now())));
		return () => clearTimeout(timer);
	}, [expiresAt]);
	const snapshot = useCallback(() => Date.now() >= expiresAt, [expiresAt]);
	return useSyncExternalStore(subscribe, snapshot, () => true);
}
