import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	config: { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, WAITING_LIST_ENABLED: true,
		BETTER_AUTH_URL: "https://control.test", GATEWAY_CODE_TTL_SECONDS: "60", GATEWAY_SESSION_TTL_SECONDS: "900" },
	getSession: vi.fn(), issue: vi.fn(), approved: vi.fn(), pool: vi.fn(),
}));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/db-helper", () => ({ dbHelper: { isApprovedUser: mocks.approved } }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: mocks.pool }));
vi.mock("@/lib/apps/gatewayAuthStore", () => ({ GatewayAuthStore: class { issue = mocks.issue; } }));
import { POST } from "@/app/api/apps/handoff/route";
import { WorkspaceError } from "@/lib/apps/workspaceStore";

const input = { bindingId: "fa03e952-f705-42e2-9706-6a0b425de83d", challenge: "c".repeat(43), state: "s".repeat(43) };
const handoff = { code: "k".repeat(43), callbackUrl: "https://app.test/__smartdeploy/callback", expiresAt: new Date("2026-10-23T23:00:00Z") };
function request(body: unknown = input, headers: Record<string, string> = {}, url = "https://control.test/api/apps/handoff") {
	return new Request(url, { method: "POST", headers: { origin: "https://control.test", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) });
}
beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(mocks.config, { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, WAITING_LIST_ENABLED: true,
		BETTER_AUTH_URL: "https://control.test", GATEWAY_CODE_TTL_SECONDS: "60", GATEWAY_SESSION_TTL_SECONDS: "900" });
	mocks.getSession.mockResolvedValue({ user: { id: "bob", email: "bob@example.test" }, session: { id: "live-platform-session" } });
	mocks.approved.mockResolvedValue({ approved: true });
	mocks.issue.mockResolvedValue(handoff);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("platform browser handoff issuance", () => {
	it("checks both flags before reading the session or body", async () => {
		for (const flag of ["WORKSPACE_APPS_ENABLED", "PRIVATE_APP_GATEWAY_ENABLED"] as const) {
			mocks.config[flag] = false;
			const req = request();
			expect((await POST(req)).status).toBe(503);
			expect(req.bodyUsed).toBe(false);
			mocks.config[flag] = true;
		}
		expect(mocks.getSession).not.toHaveBeenCalled();
	});
	it("rejects foreign/sibling/null/missing Origin and cross-site metadata before authentication", async () => {
		for (const origin of ["https://attacker.test", "https://app.control.test", "null", "https://control.test.attacker.test"]) {
			expect((await POST(request(input, { origin }))).status).toBe(403);
		}
		const missing = request(); missing.headers.delete("origin");
		expect((await POST(missing)).status).toBe(403);
		for (const site of ["same-site", "cross-site", "none"]) expect((await POST(request(input, { "sec-fetch-site": site }))).status).toBe(403);
		expect(mocks.getSession).not.toHaveBeenCalled();
		expect(mocks.issue).not.toHaveBeenCalled();
	});
	it("uses the configured secure platform origin instead of forwarded headers or arbitrary Host authority", async () => {
		for (const url of ["http://control.test/api/apps/handoff", "https://attacker.test/api/apps/handoff", "https://control.test/api/apps/handoff?state=secret"]) {
			expect((await POST(request(input, { "x-forwarded-host": "control.test", "x-forwarded-proto": "https" }, url))).status).toBe(403);
		}
		for (const value of ["", "http://control.test", "https://user:pass@control.test", "https://control.test?x=1", "https://control.test#fragment"]) {
			mocks.config.BETTER_AUTH_URL = value;
			vi.spyOn(console, "error").mockImplementation(() => {});
			expect((await POST(request())).status).toBe(503);
		}
		expect(mocks.getSession).not.toHaveBeenCalled();
	});
	it("rejects a GET even when called directly and does not mint on navigation", async () => {
		expect((await POST(new Request("https://control.test/api/apps/handoff", { headers: { origin: "https://control.test" } }))).status).toBe(403);
		expect(mocks.getSession).not.toHaveBeenCalled();
	});
	it("requires an explicit valid lifetime before loading a principal", async () => {
		mocks.config.GATEWAY_CODE_TTL_SECONDS = "";
		expect((await POST(request())).status).toBe(503);
		expect(mocks.getSession).not.toHaveBeenCalled();
	});
	it("requires a fresh signed platform session before reading the body", async () => {
		mocks.getSession.mockResolvedValueOnce(null);
		const req = request();
		const response = await POST(req);
		expect(response.status).toBe(401);
		expect(req.bodyUsed).toBe(false);
		expect(mocks.getSession).toHaveBeenCalledWith({ headers: req.headers, query: { disableCookieCache: true, disableRefresh: true } });
		expect(response.headers.get("www-authenticate")).toBeNull();
		expect(mocks.issue).not.toHaveBeenCalled();
	});
	it("checks current platform approval and fails closed on dependency errors", async () => {
		mocks.approved.mockResolvedValueOnce({ approved: false });
		expect((await POST(request())).status).toBe(403);
		mocks.approved.mockResolvedValueOnce({ approved: true, error: "lookup failed" });
		expect((await POST(request())).status).toBe(503);
		expect(mocks.approved).toHaveBeenCalledWith("bob@example.test");
		expect(mocks.issue).not.toHaveBeenCalled();
	});
	it("derives identity/session from Better Auth and callback from storage without caching, cookies, or CORS", async () => {
		const response = await POST(request(input, { "x-user-id": "attacker", "x-session-id": "fake", "x-forwarded-host": "attacker.test" }));
		expect(response.status).toBe(200);
		expect(mocks.issue).toHaveBeenCalledWith(input.bindingId, { userId: "bob", sessionId: "live-platform-session" }, input.challenge);
		expect(await response.json()).toEqual({ ...handoff, expiresAt: handoff.expiresAt.toISOString(), state: input.state });
		for (const name of ["location", "set-cookie", "access-control-allow-origin"]) expect(response.headers.get(name)).toBeNull();
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	});
	it("supports browsers lacking Fetch Metadata while retaining exact Origin checks", async () => {
		const req = request(); req.headers.delete("sec-fetch-site");
		expect((await POST(req)).status).toBe(200);
	});
	it("rejects identity, redirect, lifetime, verifier, and upstream overrides", async () => {
		for (const extra of [{ userId: "alice" }, { sessionId: "other" }, { callbackUrl: "https://attacker.test" }, { returnTo: "//attacker.test" }, { expiresAt: "forever" }, { verifier: "v".repeat(43) }, { upstream: "http://internal" }]) {
			expect((await POST(request({ ...input, ...extra }))).status).toBe(400);
		}
		expect(mocks.issue).not.toHaveBeenCalled();
	});
	it("requires binding UUID, S256 challenge, and opaque state with strict shapes", async () => {
		for (const body of [{ ...input, bindingId: "bad" }, { ...input, challenge: "bad" }, { ...input, state: "https://attacker.test" }, { bindingId: input.bindingId, challenge: input.challenge }, { ...input, state: "s".repeat(44) }]) {
			expect((await POST(request(body))).status).toBe(400);
		}
		expect(mocks.issue).not.toHaveBeenCalled();
	});
	it("uses the bounded parser and rejects oversized or non-JSON issuance", async () => {
		expect((await POST(request(input, { "content-type": "text/plain" }))).status).toBe(415);
		expect((await POST(request({ ...input, state: "x".repeat(5000) }, { "content-length": "1" }))).status).toBe(413);
		expect(mocks.issue).not.toHaveBeenCalled();
	});
	it("propagates policy denial and redacts unexpected authentication/storage errors", async () => {
		mocks.issue.mockRejectedValueOnce(new WorkspaceError(403, "App access unavailable."));
		expect((await POST(request())).status).toBe(403);
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.issue.mockRejectedValueOnce(new Error("sensitive storage secret"));
		const response = await POST(request());
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("sensitive");
		expect(log).toHaveBeenCalledWith("Browser app handoff unavailable.");
	});
});
