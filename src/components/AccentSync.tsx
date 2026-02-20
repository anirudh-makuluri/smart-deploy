"use client";

import { useEffect } from "react";

const ACCENT_KEY = "smartdeploy-accent";

/**
 * Applies saved accent (green/blue/red) to the document as soon as the client mounts,
 * so the first paint uses the correct theme and no element keeps a stale color.
 */
export function AccentSync() {
	useEffect(() => {
		const stored = localStorage.getItem(ACCENT_KEY);
		const value =
			stored === "green" || stored === "blue" || stored === "red" ? stored : "green";
		document.documentElement.setAttribute("data-accent", value);
	}, []);
	return null;
}
