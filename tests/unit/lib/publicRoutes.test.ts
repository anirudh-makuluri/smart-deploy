import { describe, expect, it } from "vitest";
import { isPublicOrAuthRoute } from "@/lib/publicRoutes";

describe("platform provider route classification", () => {
	it("keeps app confirmation outside management worker/session-recovery providers", () => {
		expect(isPublicOrAuthRoute("/apps/authorize")).toBe(true);
		expect(isPublicOrAuthRoute("/apps/invitations")).toBe(true);
	});
	it.each(["/apps/authorize-admin", "/apps/authorize/manage", "/apps/invitations/admin", "/apps/invitations-other", "/apps", "/home", "/acme/repo", "/admin"])("does not expand the provider exception to %s", (path) => {
		expect(isPublicOrAuthRoute(path)).toBe(false);
	});
	it.each(["/", "/auth", "/auth/callback", "/docs", "/docs/guide", "/changelog", "/waiting-list"])("preserves the existing public route %s", (path) => {
		expect(isPublicOrAuthRoute(path)).toBe(true);
	});
});
