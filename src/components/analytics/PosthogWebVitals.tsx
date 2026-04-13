"use client";

import { useReportWebVitals } from "next/web-vitals";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef } from "react";
import { posthogPageType } from "@/lib/analytics/posthogPageType";

function shouldSendWebVitals(): boolean {
	if (process.env.NODE_ENV === "production") return true;
	return process.env.NEXT_PUBLIC_POSTHOG_CAPTURE_WEB_VITALS_IN_DEV === "true";
}

/**
 * Sends Core Web Vitals to PostHog (production by default; set NEXT_PUBLIC_POSTHOG_CAPTURE_WEB_VITALS_IN_DEV=true to include local dev).
 */
export function PosthogWebVitals() {
	const pathname = usePathname() ?? "";
	const posthog = usePostHog();
	const posthogRef = useRef(posthog);
	const pathnameRef = useRef(pathname);

	useEffect(() => {
		posthogRef.current = posthog;
	}, [posthog]);

	useEffect(() => {
		pathnameRef.current = pathname;
	}, [pathname]);

	useReportWebVitals((metric) => {
		if (!shouldSendWebVitals()) return;
		const ph = posthogRef.current;
		const path = pathnameRef.current;
		const pageType = posthogPageType(path);
		const navType =
			"navigationType" in metric ? (metric as { navigationType?: string }).navigationType : undefined;
		ph.capture("web_vital", {
			metric_name: metric.name,
			value: metric.value,
			rating: metric.rating,
			metric_id: metric.id,
			navigation_type: navType,
			page_type: pageType,
			path: path,
		});
	});

	return null;
}
