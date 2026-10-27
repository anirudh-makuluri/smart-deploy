import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const access = vi.hoisted(() => ({ session: vi.fn(), platform: vi.fn(), workspaceEnabled: true, gatewayEnabled: true, props: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-test": "headers" }) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: access.session } } }));
vi.mock("@/lib/platformAccess", () => ({ requirePlatformAccess: access.platform }));
vi.mock("@/config", () => ({ default: { get WORKSPACE_APPS_ENABLED() { return access.workspaceEnabled; }, get PRIVATE_APP_GATEWAY_ENABLED() { return access.gatewayEnabled; } } }));
vi.mock("@/components/Header", () => ({ default: () => <header>SmartDeploy</header> }));
vi.mock("@/components/apps/WorkspaceManagement", () => ({ WorkspaceManagement: (props: unknown) => { access.props(props); return <div>Management controls</div>; } }));
import Page from "@/app/home/apps/page";

beforeEach(() => { vi.clearAllMocks(); access.workspaceEnabled = true; access.gatewayEnabled = true; access.session.mockResolvedValue({ user: { id: "creator", email: "creator@example.test", emailVerified: true, providerToken: "must-not-reach-client" } }); access.platform.mockResolvedValue(undefined); });
describe("server-side app management entry", () => {
	it.each(["workspace", "gateway"])("stays inert when %s feature is disabled", async flag => {
		if (flag === "workspace") access.workspaceEnabled = false; else access.gatewayEnabled = false;
		expect(renderToStaticMarkup(await Page())).toContain("aren&#x27;t available"); expect(access.session).not.toHaveBeenCalled(); expect(access.props).not.toHaveBeenCalled();
	});
	it("does not render management without a platform session", async () => {
		access.session.mockResolvedValue(null); expect(renderToStaticMarkup(await Page())).toContain("Sign in to manage"); expect(access.platform).not.toHaveBeenCalled(); expect(access.props).not.toHaveBeenCalled();
	});
	it("checks fresh authentication and platform permission before projecting minimal client identity", async () => {
		expect(renderToStaticMarkup(await Page())).toContain("Management controls"); expect(access.session).toHaveBeenCalledWith({ headers: expect.any(Headers), query: { disableCookieCache: true, disableRefresh: true } }); expect(access.platform).toHaveBeenCalledOnce(); expect(access.props).toHaveBeenCalledWith({ principal: { id: "creator", email: "creator@example.test" } });
	});
	it("redacts platform rejection and does not render client controls", async () => {
		access.platform.mockRejectedValue(Error("sensitive provider details")); const html = renderToStaticMarkup(await Page()); expect(html).toContain("verified, approved account"); expect(html).not.toContain("sensitive provider details"); expect(access.props).not.toHaveBeenCalled();
	});
});
