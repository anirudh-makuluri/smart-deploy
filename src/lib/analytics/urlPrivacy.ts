import type { BeforeSendEvent } from "@vercel/analytics/next";

export function privateInvitationNetwork(url: string): boolean {
	try { const path = decodeURIComponent(new URL(url, "https://smart-deploy.xyz").pathname); return path.startsWith("/apps/") || /^\/api\/(auth(?:\/|$)|workspace-invitations(?:\/|$)|workspaces\/[^/]+\/invitations(?:\/|$))/.test(path); }
	catch { return true; }
}
export function analyticsUrl(url: string): string | null {
	try { const parsed = new URL(url); if (parsed.pathname.startsWith("/apps/") || parsed.pathname.startsWith("/api/auth/")) return null; parsed.hash = ""; return parsed.toString(); }
	catch { return null; }
}
export function privateAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
	const url = analyticsUrl(event.url); return url === null ? null : { ...event, url };
}
