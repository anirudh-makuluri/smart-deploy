import { describe, expect, it } from "vitest";
import { analyticsUrl, privateAnalyticsEvent, privateInvitationNetwork } from "@/lib/analytics/urlPrivacy";
describe("invitation analytics privacy", () => {
	it.each(["https://platform.example.test/apps/invitations#token=secret", "https://platform.example.test/apps/authorize?state=value", "https://platform.example.test/api/auth/callback/github?code=secret"])("drops sensitive analytics navigation", url => { expect(analyticsUrl(url)).toBeNull(); });
	it.each(["/apps/invitations#token=secret", "/api/auth/sign-in/social", "/api/workspace-invitations/inspect", "/api/workspace-invitations/accept", "/api/workspaces/uuid/invitations", "/api/workspaces/uuid/invitations/uuid", "/api/%61uth/sign-in/social"])("excludes credential-bearing network captures", url => { expect(privateInvitationNetwork(url)).toBe(true); });
	it("retains ordinary navigation while removing all fragments", () => { expect(analyticsUrl("https://platform.example.test/docs?view=short#private")).toBe("https://platform.example.test/docs?view=short"); expect(privateInvitationNetwork("/api/health")).toBe(false); });
	it("applies the Vercel beforeSend contract to both pageviews and custom events", () => {
		for (const type of ["pageview", "event"] as const) {
			expect(privateAnalyticsEvent({ type, url: "https://platform.example.test/apps/invitations#token=secret" })).toBeNull();
			expect(privateAnalyticsEvent({ type, url: "https://platform.example.test/docs#private" })).toEqual({ type, url: "https://platform.example.test/docs" });
		}
	});
});
