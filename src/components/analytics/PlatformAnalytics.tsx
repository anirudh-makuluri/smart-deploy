"use client";
import { Analytics } from "@vercel/analytics/next";
import { privateAnalyticsEvent } from "@/lib/analytics/urlPrivacy";
export function PlatformAnalytics() { return <Analytics beforeSend={privateAnalyticsEvent} />; }
