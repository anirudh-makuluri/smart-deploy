import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GatewayBrowserAuth, type GatewayBrowserOptions } from "@/lib/gateway/browserAuth";
import { GATEWAY_LOGIN_COOKIE } from "@/lib/gateway/browserTransactions";
import { GATEWAY_SESSION_COOKIE, sessionCookie, sessionToken } from "@/lib/gateway/cookies";
import type { GatewayFetch } from "@/lib/gateway/controlClient";

const NOW = Date.UTC(2026, 9, 25);
const TOKEN = "t".repeat(43);
const IDENTITY = { id: "verified-user", email: "verified@example.test" };
const OPTIONS: GatewayBrowserOptions = {
	appOrigin: "https://app.test", platformOrigin: "https://control.test", bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac",
	serviceCredential: "sd_gateway_91843492-f2ea-437c-a540-b144c3bc8ed2." + "s".repeat(43), timeoutMs: 100,
	transactions: { ttlSeconds: 300, maxEntries: 10 },
};
function request(path: string, cookie = "", extra: Record<string, string> = {}, method = "GET") {
	return new Request(OPTIONS.appOrigin + path, { method, headers: { accept: "text/html", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", ...(cookie ? { cookie } : {}), ...extra } });
}
function fixture() {
	const transport = vi.fn<GatewayFetch>().mockImplementation(async (url) => Response.json(url.pathname.endsWith("authorize") ? { identity: IDENTITY }
		: { token: TOKEN, expiresAt: new Date(NOW + 900000).toISOString(), identity: IDENTITY }));
	return { transport, auth: new GatewayBrowserAuth(OPTIONS, transport, () => NOW) };
}
async function begin(auth: GatewayBrowserAuth, path = "/items?sort=new") {
	const response = await auth.handle(request("/__smartdeploy/login?returnPath=" + encodeURIComponent(path)));
	if (!response) throw new Error("Expected the login route.");
	const location = response.headers.get("location");
	const cookie = response.headers.get("set-cookie");
	if (!location || !cookie) throw new Error("Expected browser transaction.");
	return { response, target: new URL(location), cookie: cookie.split(";")[0] };
}
function callback(state: string) { return `/__smartdeploy/callback?state=${state}&code=${TOKEN}`; }

describe("gateway login and callback HTTP adapter", () => {
	it("redirects only to fixed platform consent with public state/challenge and a protected nonce", async () => {
		const { auth, transport } = fixture();
		const flow = await begin(auth);
		expect(flow.response.status).toBe(303);
		expect(flow.target.origin + flow.target.pathname).toBe("https://control.test/apps/authorize");
		expect([...flow.target.searchParams.keys()].sort()).toEqual(["bindingId", "challenge", "state"]);
		expect(flow.target.searchParams.get("bindingId")).toBe(OPTIONS.bindingId);
		expect(flow.cookie).toMatch(new RegExp(`^${GATEWAY_LOGIN_COOKIE}=[A-Za-z0-9_-]{43}$`));
		expect(flow.response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
		expect(flow.response.headers.get("referrer-policy")).toBe("no-referrer");
		expect(flow.response.headers.get("cache-control")).toBe("no-store");
		expect(transport).not.toHaveBeenCalled();
	});

	it("claims before redeeming and sets an app cookie only after validated success", async () => {
		const { auth, transport } = fixture();
		const flow = await begin(auth);
		const state = flow.target.searchParams.get("state") ?? "";
		const response = await auth.handle(request(callback(state), flow.cookie));
		expect(response?.status).toBe(303);
		expect(response?.headers.get("location")).toBe("/items?sort=new");
		expect(response?.headers.get("set-cookie")).toBe(`${GATEWAY_SESSION_COOKIE}=${TOKEN}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=900`);
		const body: unknown = JSON.parse(String(transport.mock.calls[0][1].body));
		if (!body || typeof body !== "object" || !("verifier" in body) || typeof body.verifier !== "string") throw new Error("Expected server proof.");
		expect(createHash("sha256").update(body.verifier).digest("base64url")).toBe(flow.target.searchParams.get("challenge"));
		expect(body).toMatchObject({ code: TOKEN, callbackUrl: "https://app.test/__smartdeploy/callback" });
		expect((await auth.handle(request(callback(state), flow.cookie)))?.status).toBe(403);
		expect(transport).toHaveBeenCalledOnce();
	});

	it("rejects wrong browser/state before network access without burning the rightful callback", async () => {
		const { auth, transport } = fixture();
		const flow = await begin(auth);
		const state = flow.target.searchParams.get("state") ?? "";
		expect((await auth.handle(request(callback(state))))?.status).toBe(403);
		expect((await auth.handle(request(callback("s".repeat(43)), flow.cookie)))?.status).toBe(403);
		expect(transport).not.toHaveBeenCalled();
		expect((await auth.handle(request(callback(state), flow.cookie)))?.status).toBe(303);
	});

	it("does not set or clear browser cookies on unconfirmed redemption and consumes failed attempts", async () => {
		const { auth, transport } = fixture();
		transport.mockResolvedValue(Response.json({ token: TOKEN, identity: IDENTITY }));
		const flow = await begin(auth);
		const state = flow.target.searchParams.get("state") ?? "";
		const failed = await auth.handle(request(callback(state), `${flow.cookie}; ${GATEWAY_SESSION_COOKIE}=${TOKEN}`));
		expect(failed?.status).toBe(503);
		expect(failed?.headers.get("set-cookie")).toBeNull();
		expect((await auth.handle(request(callback(state), flow.cookie)))?.status).toBe(403);
		expect(transport).toHaveBeenCalledOnce();
	});

	it("revokes an otherwise valid token that cannot form a safe-lived cookie", async () => {
		const { auth, transport } = fixture();
		transport.mockImplementation(async (url) => Response.json(url.pathname.endsWith("logout") ? { revoked: true }
			: { token: TOKEN, expiresAt: new Date(NOW + 500).toISOString(), identity: IDENTITY }));
		const flow = await begin(auth);
		const response = await auth.handle(request(callback(flow.target.searchParams.get("state") ?? ""), flow.cookie));
		expect(response?.status).toBe(503);
		expect(response?.headers.get("set-cookie")).toBeNull();
		expect(transport.mock.calls.map(([url]) => url.pathname)).toEqual(["/api/gateway/redeem", "/api/gateway/logout"]);
	});

	it.each(["/__smartdeploy/new", "/__SMARTDEPLOY/callback", "/%5f_smartdeploy/callback", "/%255f_smartdeploy/callback", "/%2f[", "/bad%ZZ", "/__smartdeploy;params/callback", "/__smartdeploy%00/callback", "/file%00name"])("keeps malformed/reserved variants out of customer routing: %s", async (path) => {
		const { auth, transport } = fixture();
		const response = await auth.handle(request(path));
		expect(response).not.toBeNull();
		expect(response?.status).toBeGreaterThanOrEqual(400);
		expect(transport).not.toHaveBeenCalled();
	});

	it("rejects duplicate/foreign callback fields before consuming state", async () => {
		const { auth, transport } = fixture();
		const flow = await begin(auth);
		const state = flow.target.searchParams.get("state") ?? "";
		for (const suffix of [`&state=${state}`, `&code=${TOKEN}`, "&bindingId=other", "&returnPath=https://evil.test"]) {
			expect((await auth.handle(request(callback(state) + suffix, flow.cookie)))?.status).toBe(400);
		}
		expect(transport).not.toHaveBeenCalled();
		expect((await auth.handle(request(callback(state), flow.cookie)))?.status).toBe(303);
	});

	it("requires navigation and matching authority and leaves ordinary requests for an authenticated proxy", async () => {
		const { auth, transport } = fixture();
		expect(await auth.handle(request("/items"))).toBeNull();
		const invalidHeaders: Record<string, string>[] = [{ origin: "https://evil.test" }, { "sec-fetch-mode": "cors" }, { "sec-fetch-dest": "iframe" }, { host: "other.test" }];
		for (const extra of invalidHeaders) {
			expect((await auth.handle(request("/__smartdeploy/login", "", extra)))?.status).toBe(403);
		}
		const post = await auth.handle(request("/__smartdeploy/login", "", {}, "POST"));
		expect(post?.status).toBe(405);
		expect(post?.headers.get("allow")).toBe("GET");
		expect((await auth.handle(new Request("https://other.test/__smartdeploy/login")))?.status).toBe(403);
		await expect(auth.identity(new Request("https://other.test/items"))).rejects.toMatchObject({ status: 403 });
		expect(transport).not.toHaveBeenCalled();
	});

	it("rejects return-target overrides and preserves an existing flow when capacity is full", async () => {
		const auth = new GatewayBrowserAuth({ ...OPTIONS, transactions: { ttlSeconds: 300, maxEntries: 1 } });
		expect((await auth.handle(request("/__smartdeploy/login?returnPath=https://evil.test")))?.status).toBe(400);
		expect((await auth.handle(request("/__smartdeploy/login?returnPath=/&returnPath=/other")))?.status).toBe(400);
		expect((await auth.handle(request("/__smartdeploy/login?bindingId=other")))?.status).toBe(400);
		await begin(auth);
		const full = await auth.handle(request("/__smartdeploy/login"));
		expect(full?.status).toBe(503);
		expect(full?.headers.get("set-cookie")).toBeNull();
	});

	it("authorizes each request through the current control plane without caller identity headers", async () => {
		const { auth, transport } = fixture();
		expect(await auth.identity(request("/items"))).toBeNull();
		expect(await auth.identity(request("/items", `${GATEWAY_SESSION_COOKIE}=bad`))).toBeNull();
		expect(transport).not.toHaveBeenCalled();
		const req = request("/items", `${GATEWAY_SESSION_COOKIE}=${TOKEN}`, { "x-smartdeploy-user-id": "attacker" });
		expect(await auth.identity(req)).toEqual(IDENTITY);
		expect(new Headers(transport.mock.calls[0][1].headers).has("x-smartdeploy-user-id")).toBe(false);
		transport.mockResolvedValue(Response.json({ error: "revoked" }, { status: 403 }));
		await expect(auth.identity(req)).rejects.toMatchObject({ status: 403 });
		expect(transport).toHaveBeenCalledTimes(2);
	});

	it("requires separate cookie hosts rather than relying on ports", () => {
		expect(() => new GatewayBrowserAuth({ ...OPTIONS, appOrigin: "https://control.test:444" })).toThrow("Distinct platform/app hosts");
		expect(() => new GatewayBrowserAuth({ ...OPTIONS, bindingId: "bad" })).toThrow();
	});
});

describe("app-session cookie bounds", () => {
	it("ignores unrelated cookies and rejects duplicates or excessive headers", () => {
		expect(sessionToken(`theme=dark; ${GATEWAY_SESSION_COOKIE}=${TOKEN}`)).toBe(TOKEN);
		expect(sessionToken(`${GATEWAY_SESSION_COOKIE}=${TOKEN}; ${GATEWAY_SESSION_COOKIE}=${TOKEN}`)).toBeNull();
		expect(sessionToken("x".repeat(16385))).toBeNull();
	});
	it.each([new Date(NOW), new Date(NOW - 1), new Date(NOW + 3601000), new Date(NaN)])("rejects unsafe expiry %s", (date) => {
		expect(() => sessionCookie(TOKEN, date, NOW)).toThrow("Invalid app-session cookie.");
	});
});
