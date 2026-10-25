import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	config: { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, WAITING_LIST_ENABLED: false, GATEWAY_CODE_TTL_SECONDS: "60", GATEWAY_SESSION_TTL_SECONDS: "900" },
	authenticate: vi.fn(), pool: vi.fn(), authorize: vi.fn(), redeem: vi.fn(), revoke: vi.fn(), approved: vi.fn(), invited: vi.fn(),
}));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("@/db-helper", () => ({ dbHelper: { isApprovedUser: mocks.approved } }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: mocks.pool }));
vi.mock("@/lib/apps/gatewayServiceAuth", () => ({ authenticateGateway: mocks.authenticate }));
vi.mock("@/lib/apps/gatewayAuthStore", () => ({ GatewayAuthStore: class {
	authorize = mocks.authorize;
	redeem = mocks.redeem;
	revoke = mocks.revoke;
	isInvitedMember = mocks.invited;
} }));
import { POST as authorize } from "@/app/api/gateway/authorize/route";
import { POST as redeem } from "@/app/api/gateway/redeem/route";
import { POST as logout } from "@/app/api/gateway/logout/route";
import { WorkspaceError } from "@/lib/apps/workspaceStore";
import { GatewaySessionInput, parseGatewayBody } from "@/lib/apps/gatewayApi";

const token = "s".repeat(43);
function request(body: unknown = { token }, headers: Record<string, string> = {}, url = "https://control.test/api/gateway/authorize"): Request {
	return new Request(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer service-credential", "x-smartdeploy-binding-id": "credential-binding", ...headers }, body: JSON.stringify(body) });
}
beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(mocks.config, { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, WAITING_LIST_ENABLED: false, GATEWAY_CODE_TTL_SECONDS: "60", GATEWAY_SESSION_TTL_SECONDS: "900" });
	mocks.authenticate.mockResolvedValue({ bindingId: "credential-binding" });
	mocks.authorize.mockResolvedValue({ id: "bob", email: "bob@example.test" });
	mocks.redeem.mockResolvedValue({ token, expiresAt: new Date("2026-10-23T19:00:00Z") });
	mocks.revoke.mockResolvedValue(undefined);
	mocks.approved.mockResolvedValue({ approved: true });
	mocks.invited.mockResolvedValue(false);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("gateway service endpoints", () => {
	it("requires the configured binding assertion to match the authenticated key before reading bodies", async () => {
		const absent = request();
		absent.headers.delete("x-smartdeploy-binding-id");
		expect((await authorize(absent)).status).toBe(403);
		expect(absent.bodyUsed).toBe(false);
		expect((await authorize(request({ token }, { "x-smartdeploy-binding-id": "different-binding" }))).status).toBe(403);
		expect(mocks.authorize).not.toHaveBeenCalled();
	});
	it("does not accept environment authority in redemption or authorization bodies", async () => {
		expect((await authorize(request({ token, environment: "published" }))).status).toBe(400);
		expect((await redeem(request({ code: token, verifier: token, callbackUrl: "https://app.test/__smartdeploy/callback", environment: "published" }))).status).toBe(400);
		expect(mocks.authorize).not.toHaveBeenCalled();
		expect(mocks.redeem).not.toHaveBeenCalled();
	});
	it("rechecks the exact invited-app scope on every unapproved-user decision", async () => {
		mocks.config.WAITING_LIST_ENABLED = true;
		mocks.approved.mockResolvedValue({ approved: false });
		mocks.invited.mockResolvedValueOnce(true);
		expect((await authorize(request())).status).toBe(200);
		expect(mocks.invited).toHaveBeenCalledWith("credential-binding", "bob");
		expect((await authorize(request())).status).toBe(403);
		expect(mocks.invited).toHaveBeenCalledTimes(2);
	});
	it("requires both independent feature flags before authentication or body consumption", async () => {
		for (const flag of ["WORKSPACE_APPS_ENABLED", "PRIVATE_APP_GATEWAY_ENABLED"] as const) {
			mocks.config[flag] = false;
			const req = request();
			expect((await authorize(req)).status).toBe(503);
			expect(req.bodyUsed).toBe(false);
			mocks.config[flag] = true;
		}
		expect(mocks.authenticate).not.toHaveBeenCalled();
	});

	it("rejects browser context, insecure transport, and query parameters", async () => {
		const browserHeaders: Record<string, string>[] = [{ origin: "https://control.test" }, { cookie: "session=spoof" }, { "sec-fetch-site": "same-origin" }];
		for (const headers of browserHeaders) {
			expect((await authorize(request({ token }, headers))).status).toBe(403);
		}
		expect((await authorize(request({ token }, {}, "http://control.test/api/gateway/authorize"))).status).toBe(403);
		expect((await authorize(request({ token }, {}, "https://control.test/api/gateway/authorize?token=secret"))).status).toBe(403);
		expect(mocks.authenticate).not.toHaveBeenCalled();
	});

	it("rejects missing/invalid service authentication before reading user credentials", async () => {
		mocks.authenticate.mockRejectedValue(new WorkspaceError(401, "Gateway authentication required."));
		const req = request();
		const response = await authorize(req);
		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toContain("Bearer");
		expect(req.bodyUsed).toBe(false);
		expect(mocks.authorize).not.toHaveBeenCalled();
	});

	it("requires explicit valid lifetimes before authenticating or minting sessions", async () => {
		for (const value of ["", "0", "121", "1.5", "Infinity", "1e2"]) {
			mocks.config.GATEWAY_CODE_TTL_SECONDS = value;
			expect((await redeem(request())).status).toBe(503);
		}
		mocks.config.GATEWAY_CODE_TTL_SECONDS = "60";
		mocks.config.GATEWAY_SESSION_TTL_SECONDS = "3601";
		expect((await redeem(request())).status).toBe(503);
		expect(mocks.authenticate).not.toHaveBeenCalled();
	});

	it("derives binding and identity from authenticated server state and prevents caching", async () => {
		const response = await authorize(request({ token }, { "x-user-id": "alice", "x-app-id": "other" }));
		expect(await response.json()).toEqual({ identity: { id: "bob", email: "bob@example.test" } });
		expect(mocks.authorize).toHaveBeenCalledWith("credential-binding", token);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
		expect(response.headers.get("set-cookie")).toBeNull();
	});

	it("rejects supplied app, binding, identity, or upstream authority", async () => {
		for (const extra of [{ bindingId: "other" }, { appId: "other" }, { userId: "alice" }, { upstream: "http://internal" }]) {
			expect((await authorize(request({ token, ...extra }))).status).toBe(400);
		}
		expect(mocks.authorize).not.toHaveBeenCalled();
	});

	it("fails closed when policy denies access or a dependency is unavailable", async () => {
		mocks.authorize.mockResolvedValueOnce(null);
		expect((await authorize(request())).status).toBe(403);
		vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.authorize.mockRejectedValueOnce(new Error("sensitive database detail"));
		const response = await authorize(request());
		expect(response.status).toBe(503);
		expect(JSON.stringify(await response.json())).not.toContain("sensitive");
		expect(console.error).toHaveBeenCalledWith("Gateway authorization request failed.");
	});

	it("rechecks platform approval on every decision and denies approval lookup failures", async () => {
		mocks.config.WAITING_LIST_ENABLED = true;
		expect((await authorize(request())).status).toBe(200);
		expect(mocks.approved).toHaveBeenCalledWith("bob@example.test");
		mocks.approved.mockResolvedValueOnce({ approved: false });
		expect((await authorize(request())).status).toBe(403);
		mocks.approved.mockResolvedValueOnce({ approved: true, error: "lookup failed" });
		expect((await authorize(request())).status).toBe(503);
	});

	it("redeems through the authenticated binding and checks identity before returning the new token", async () => {
		const input = { code: "c".repeat(43), verifier: "v".repeat(43), callbackUrl: "https://app.test/__smartdeploy/callback" };
		const response = await redeem(request(input));
		expect(response.status).toBe(200);
		expect(mocks.redeem).toHaveBeenCalledWith("credential-binding", input.callbackUrl, input.code, input.verifier);
		expect(mocks.authorize).toHaveBeenCalledWith("credential-binding", token);
		expect(await response.json()).toMatchObject({ token, identity: { id: "bob" } });
	});

	it("revokes a newly redeemed session if policy or platform approval rejects it", async () => {
		mocks.config.WAITING_LIST_ENABLED = true;
		mocks.approved.mockResolvedValueOnce({ approved: false });
		const response = await redeem(request({ code: "c".repeat(43), verifier: "v".repeat(43), callbackUrl: "https://app.test/__smartdeploy/callback" }));
		expect(response.status).toBe(403);
		expect(mocks.revoke).toHaveBeenCalledWith("credential-binding", token);
		expect(JSON.stringify(await response.json())).not.toContain(token);
	});

	it("scopes logout to the authenticated binding without requiring continuing user access", async () => {
		expect((await logout(request())).status).toBe(200);
		expect(mocks.revoke).toHaveBeenCalledWith("credential-binding", token);
		expect(mocks.authorize).not.toHaveBeenCalled();
	});
});

describe("bounded gateway request parsing", () => {
	it("rejects invalid JSON, fields, compressed bodies, and non-JSON content", async () => {
		const headersList: Record<string, string>[] = [{ "content-type": "text/plain" }, { "content-encoding": "gzip" }];
		for (const headers of headersList) expect((await authorize(request({ token }, headers))).status).toBe(415);
		expect((await authorize(request({ token: "bad" }))).status).toBe(400);
		expect((await authorize(new Request("https://control.test/api/gateway/authorize", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer service-credential", "x-smartdeploy-binding-id": "credential-binding" }, body: "{" }))).status).toBe(400);
	});

	it("bounds advertised and actual bytes including missing or false Content-Length", async () => {
		const headersList: Record<string, string>[] = [{}, { "content-length": "1" }, { "content-length": "999999" }];
		for (const headers of headersList) {
			expect((await authorize(request({ token: "x".repeat(5000) }, headers))).status).toBe(413);
		}
	});

	it("cancels oversized streamed bodies without reading the full stream", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel });
		const req = new Request("https://control.test/api/gateway/authorize", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
		await expect(parseGatewayBody(req, GatewaySessionInput)).rejects.toMatchObject({ status: 413 });
		expect(cancel).toHaveBeenCalled();
	});

	it("cancels a stalled authenticated body at the whole-body deadline", async () => {
		vi.useFakeTimers();
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ cancel });
		const req = new Request("https://control.test/api/gateway/authorize", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
		const result = expect(parseGatewayBody(req, GatewaySessionInput)).rejects.toMatchObject({ status: 408 });
		await vi.advanceTimersByTimeAsync(5000);
		await result;
		expect(cancel).toHaveBeenCalled();
	});
});
