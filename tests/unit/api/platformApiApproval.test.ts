import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

const mocks = vi.hoisted(() => ({
	config: { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, WAITING_LIST_ENABLED: true, BETTER_AUTH_URL: "https://control.test" },
	session: vi.fn(), approved: vi.fn(), cli: vi.fn(), query: vi.fn(),
}));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/db-helper", () => ({ dbHelper: { isApprovedUser: mocks.approved } }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock("@/lib/cliAuth", async (original) => ({ ...await original<typeof import("@/lib/cliAuth")>(), authenticateCliAccessToken: mocks.cli }));
import { proxy, config as proxyConfig } from "@/proxy";

const cookie = "better-auth.session_token=local-test-cookie";
function request(path = "/api/ws-token", headers: Record<string, string> = { cookie }, method = "GET") {
	return new NextRequest(`https://control.test${path}`, { method, headers });
}
beforeEach(() => {
	vi.resetAllMocks();
	Object.assign(mocks.config, { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, WAITING_LIST_ENABLED: true });
	mocks.session.mockResolvedValue({ user: { id: "invitee", email: "invitee@example.test" } });
	mocks.approved.mockResolvedValue({ approved: false });
	mocks.cli.mockResolvedValue("invitee");
	mocks.query.mockResolvedValue({ rows: [{ email: "invitee@example.test" }] });
});

describe("app-only login cannot unlock platform APIs", () => {
	it.each(["/api/graphql", "/api/ws-token", "/api/llm", "/api/github/access-token", "/api/cli/deployments/queue", "/api/cli/device/approve", "/api/deployments/env-secrets", "/api/workspaces", "/api/apps/any/grants"])("matches and denies unapproved login at %s", async (path) => {
		expect(unstable_doesMiddlewareMatch({ config: proxyConfig, nextConfig: {}, url: `https://control.test${path}` })).toBe(true);
		const response = await proxy(request(path));
		expect(response.status).toBe(403);
		expect(response.headers.get("x-middleware-next")).toBeNull();
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mocks.session).toHaveBeenCalledWith({ headers: expect.any(Headers), query: { disableCookieCache: true, disableRefresh: true } });
	});

	it("retains destination authorization for approved users and anonymous/machine requests", async () => {
		mocks.approved.mockResolvedValue({ approved: true });
		expect((await proxy(request())).headers.get("x-middleware-next")).toBe("1");
		mocks.session.mockClear();
		expect((await proxy(request("/api/graphql", {}))).headers.get("x-middleware-next")).toBe("1");
		expect(mocks.session).not.toHaveBeenCalled();
	});

	it.each(["/api/apps/handoff", "/api/workspace-invitations/accept", "/api/gateway/authorize", "/api/auth/sign-out", "/api/health", "/api/docs-markdown"])("leaves %s to its specific authentication policy", async (path) => {
		expect((await proxy(request(path))).headers.get("x-middleware-next")).toBe("1");
		expect(mocks.session).not.toHaveBeenCalled();
	});

	it("does not exempt management paths sharing an app/auth-like prefix", async () => {
		for (const path of ["/api/apps/handoff-admin", "/api/authentication", "/api/gateway-admin", "/api/gateway/new-management-action"]) {
			expect((await proxy(request(path))).status).toBe(403);
		}
	});

	it("does not infer browser authority from a particular cookie name or formatting", async () => {
		for (const cookie of ["better-auth.session_token =local-test", "__Host-better-auth.session_token=local-test", "other=local-test"]) {
			expect((await proxy(request("/api/ws-token", { cookie }))).status).toBe(403);
		}
		expect(mocks.session).toHaveBeenCalledTimes(3);
	});

	it("requires current CLI approval too, without granting API access from token possession alone", async () => {
		const headers = { authorization: "Bearer sd_cli_local_test" };
		expect((await proxy(request("/api/graphql", headers))).status).toBe(403);
		expect(mocks.cli).toHaveBeenCalledWith("sd_cli_local_test");
		expect(mocks.approved).toHaveBeenCalledWith("invitee@example.test");
		mocks.approved.mockResolvedValue({ approved: true });
		expect((await proxy(request("/api/graphql", headers))).headers.get("x-middleware-next")).toBe("1");
		mocks.cli.mockResolvedValue(null);
		expect((await proxy(request("/api/graphql", headers))).status).toBe(401);
	});

	it("fails closed when fresh login or approval cannot be established", async () => {
		mocks.session.mockResolvedValueOnce(null);
		expect((await proxy(request())).status).toBe(401);
		mocks.session.mockRejectedValueOnce(new Error("private database details"));
		const unavailable = await proxy(request());
		expect(unavailable.status).toBe(503);
		expect(await unavailable.text()).not.toContain("private database details");
		mocks.approved.mockResolvedValue({ approved: true, error: "lookup failed" });
		expect((await proxy(request())).status).toBe(503);
	});

	it("rejects sibling-origin reads and mutations even for approved platform users", async () => {
		mocks.approved.mockResolvedValue({ approved: true });
		expect((await proxy(request("/api/graphql", { cookie, origin: "https://app.control.test" }, "POST"))).status).toBe(403);
		expect((await proxy(request("/api/graphql", { cookie, "sec-fetch-site": "same-site" }))).status).toBe(403);
		expect((await proxy(request("/api/graphql", { cookie }, "POST"))).status).toBe(403);
		expect(mocks.session).not.toHaveBeenCalled();
		expect((await proxy(request("/api/graphql", { cookie, origin: "https://control.test", "sec-fetch-site": "same-origin" }, "POST"))).headers.get("x-middleware-next")).toBe("1");
	});

	it("preserves platform denial after disabling the private-app pilot", async () => {
		mocks.config.PRIVATE_APP_GATEWAY_ENABLED = false;
		mocks.config.WORKSPACE_APPS_ENABLED = false;
		expect((await proxy(request())).status).toBe(403);
	});

	it("honors the existing explicit switch disabling the platform waiting list", async () => {
		mocks.config.WAITING_LIST_ENABLED = false;
		expect((await proxy(request())).headers.get("x-middleware-next")).toBe("1");
		expect(mocks.session).not.toHaveBeenCalled();
	});
});
