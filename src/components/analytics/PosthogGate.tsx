"use client";

import type { ReactNode } from "react";
import { PostHogProvider } from "posthog-js/react";
import { PosthogIdentify } from "@/components/analytics/PosthogIdentify";
import { PosthogWebVitals } from "@/components/analytics/PosthogWebVitals";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || "/ph";
const posthogDebug = process.env.NEXT_PUBLIC_POSTHOG_DEBUG === "true";

type PosthogGateProps = {
	children: ReactNode;
};

/**
 * Wraps the tree with PostHog when `NEXT_PUBLIC_POSTHOG_KEY` is set; otherwise passes children through.
 */
export function PosthogGate({ children }: PosthogGateProps) {
	if (!posthogKey) {
		return <>{children}</>;
	}

	return (
		<PostHogProvider
			apiKey={posthogKey}
			options={{
				api_host: posthogHost,
				person_profiles: "identified_only",
				capture_pageview: "history_change",
				capture_pageleave: true,
				debug: posthogDebug,
				loaded: (posthog) => {
					if (posthogDebug) {
						// Helps verify initialization and that requests aren't being blocked.
						console.log("[posthog] loaded", { host: posthogHost });
						posthog.capture("posthog_debug_ping", {
							path: typeof window !== "undefined" ? window.location.pathname : undefined,
						});
					}
				},
			}}
		>
			<PosthogIdentify />
			<PosthogWebVitals />
			{children}
		</PostHogProvider>
	);
}
