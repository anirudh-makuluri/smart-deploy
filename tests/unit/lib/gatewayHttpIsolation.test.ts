import { describe, expect, it } from "vitest";
import { GatewayHttpError, GatewayHttpIsolation, type GatewayHttpContext } from "@/lib/gateway/httpIsolation";
import { gatewayPathKind } from "@/lib/gateway/paths";

const OPTIONS: GatewayHttpContext = { appOrigin: "https://app.control.test", bindingId: "fa03e952-f705-42e2-9706-6a0b425de83d", environment: "published" };
const IDENTITY = { id: "verified-user", email: "colleague@example.test" };
const policy = new GatewayHttpIsolation(OPTIONS);
function request(headers: Record<string, string> = {}, method = "GET", path = "/items") {
	return new Request(OPTIONS.appOrigin + path, { method, headers: { "sec-fetch-site": "same-origin", ...headers } });
}
function denied(action: () => unknown, status: number): void {
	try { action(); throw new Error("Expected denial"); }
	catch (error) { expect(error).toBeInstanceOf(GatewayHttpError); if (error instanceof GatewayHttpError) expect(error.status).toBe(status); }
}

describe("HTTP browser origin isolation", () => {
	it.each(["GET", "HEAD"])("allows same-origin %s resources and customer data", (method) => {
		expect(() => policy.assertBrowserRequest(request({}, method))).not.toThrow();
	});
	it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("requires current same-origin Origin proof for %s", (method) => {
		expect(() => policy.assertBrowserRequest(request({ origin: OPTIONS.appOrigin }, method))).not.toThrow();
		for (const origin of ["null", "https://other.control.test", "https://foreign.test"]) denied(() => policy.assertBrowserRequest(request({ origin }, method)), 403);
		denied(() => policy.assertBrowserRequest(request({}, method)), 403);
	});
	it.each(["none", "same-site", "cross-site"])("allows only top-level GET document navigation from %s", (site) => {
		const profile = { "sec-fetch-site": site, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
		expect(() => policy.assertBrowserRequest(request(profile))).not.toThrow();
		for (const destination of ["iframe", "image", "script", "empty"]) denied(() => policy.assertBrowserRequest(request({ ...profile, "sec-fetch-dest": destination })), 403);
		denied(() => policy.assertBrowserRequest(request({ ...profile, origin: "https://other.control.test" })), 403);
		denied(() => policy.assertBrowserRequest(request(profile, "HEAD")), 403);
	});
	it("denies sibling fetches and invalid metadata even when Origin or cookies appear legitimate", () => {
		for (const site of ["same-site", "cross-site", "none", "unknown"]) {
			denied(() => policy.assertBrowserRequest(request({ "sec-fetch-site": site, "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", cookie: "__Host-smartdeploy-app-session=opaque", origin: OPTIONS.appOrigin })), 403);
		}
		denied(() => policy.assertBrowserRequest(request({ origin: "https://other.control.test" })), 403);
	});
	it("retains a bounded legacy HTML navigation and explicit same-origin Origin fallback", () => {
		const navigation = request({ accept: "text/html" }); navigation.headers.delete("sec-fetch-site");
		expect(() => policy.assertBrowserRequest(navigation)).not.toThrow();
		const api = request({ origin: OPTIONS.appOrigin }); api.headers.delete("sec-fetch-site");
		expect(() => policy.assertBrowserRequest(api)).not.toThrow();
		navigation.headers.set("sec-fetch-dest", "iframe"); denied(() => policy.assertBrowserRequest(navigation), 403);
		const missing = request(); missing.headers.delete("sec-fetch-site"); denied(() => policy.assertBrowserRequest(missing), 403);
	});
	it("rejects foreign authority, upgrade attempts and unsupported methods before forwarding", () => {
		denied(() => policy.assertBrowserRequest(new Request("https://other.control.test/items")), 403);
		denied(() => policy.assertBrowserRequest(request({ host: "other.control.test", "x-forwarded-host": "app.control.test" })), 403);
		denied(() => policy.assertBrowserRequest(request({ upgrade: "websocket" })), 403);
		denied(() => policy.assertBrowserRequest(request({}, "PROPFIND")), 403);
	});
	it.each(["/__smartdeploy/login", "/__smartdeploy/callback?code=secret", "/__SMARTDEPLOY/callback", "/%5f_smartdeploy/callback", "/%255f_smartdeploy/callback", "/%2f[", "/bad%ZZ", "/__smartdeploy/disabled-workers/file", "/__smartdeploy;params/callback", "/__smartdeploy%00/callback", "/file%00name"])("never prepares customer forwarding for reserved/malformed path %s", (path) => {
		denied(() => policy.requestHeaders(request({}, "GET", path), IDENTITY), 400);
	});
	it("bounds URL/header bytes and counts, and rejects fragments", () => {
		denied(() => policy.assertBrowserRequest(request({}, "GET", "/?q=" + "a".repeat(4096))), 400);
		denied(() => policy.assertBrowserRequest(request({ "x-large": "x".repeat(16384) })), 400);
		denied(() => policy.assertBrowserRequest(request(Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`x-${index}`, "v"])))), 400);
		denied(() => policy.assertBrowserRequest(request({}, "GET", "/items#private")), 400);
	});
});

describe("customer request credential/header boundary", () => {
	it("strips Authorization, platform/gateway cookies and spoofed routing/identity, then adds only verified context", () => {
		const source = request({ authorization: "Bearer app-or-platform-secret", "proxy-authorization": "Basic secret", forwarded: "host=evil", referer: "https://control.test/private?secret=1",
			"x-forwarded-proto": "http", "x-forwarded-host": "evil", "x-forwarded-for": "spoof", "x-real-ip": "spoof", "x-smartdeploy-identity": "attacker", "x-smartdeploy-binding-id": "other",
			cookie: '__Host-smartdeploy-app-session=secret; __Host-smartdeploy-app-login=nonce; __Host-smartdeploy.session_token=platform; better-auth.session_token=legacy; theme="dark"',
			"accept-language": "en", "content-length": "999", expect: "100-continue" });
		const output = policy.requestHeaders(source, IDENTITY);
		for (const name of ["authorization", "proxy-authorization", "forwarded", "referer", "x-forwarded-for", "x-real-ip", "content-length", "expect", "sec-fetch-site"]) expect(output.has(name)).toBe(false);
		expect(output.get("cookie")).toBe('theme="dark"');
		expect(output.get("host")).toBe("app.control.test"); expect(output.get("x-forwarded-host")).toBe("app.control.test"); expect(output.get("x-forwarded-proto")).toBe("https");
		expect(output.get("x-smartdeploy-binding-id")).toBe(OPTIONS.bindingId); expect(output.get("x-smartdeploy-environment")).toBe("published");
		expect(JSON.parse(Buffer.from(output.get("x-smartdeploy-identity") ?? "", "base64url").toString("utf8"))).toEqual(IDENTITY);
		expect(output.get("accept-language")).toBe("en"); expect(source.headers.get("authorization")).toBe("Bearer app-or-platform-secret");
	});
	it("consumes standard and Connection-nominated hop fields before adding trusted identity", () => {
		const output = policy.requestHeaders(request({ connection: "x-private-hop, cookie, x-smartdeploy-identity, host", "x-private-hop": "secret", cookie: "theme=dark", "keep-alive": "timeout=5", te: "trailers", "transfer-encoding": "chunked", trailer: "x-end" }), IDENTITY);
		for (const name of ["connection", "x-private-hop", "cookie", "keep-alive", "te", "transfer-encoding", "trailer"]) expect(output.has(name)).toBe(false);
		expect(output.get("x-smartdeploy-identity")).not.toBeNull(); expect(output.get("host")).toBe("app.control.test");
		denied(() => policy.requestHeaders(request({ connection: "x-private-hop,,cookie" }), IDENTITY), 400);
	});
	it.each(["theme=one; theme=two", "bare", "theme=bad,value", "=value"])("rejects ambiguous/malformed app cookies: %s", (cookie) => {
		denied(() => policy.requestHeaders(request({ cookie }), IDENTITY), 400);
	});
	it("rejects invalid identity and bounds the generated header envelope", () => {
		denied(() => policy.requestHeaders(request(), { id: "", email: "x" }), 403);
		denied(() => policy.requestHeaders(request({ "x-large": "x".repeat(16300) }), { id: "i".repeat(200), email: "u".repeat(240) + "@example.test" }), 400);
	});
	it("copies operator configuration and safely encodes opaque Unicode identity", () => {
		const options = { ...OPTIONS }; const instance = new GatewayHttpIsolation(options); options.bindingId = "changed"; options.environment = "preview";
		const identity = { id: "user-\u03bb", email: "person@example.test" }; const output = instance.requestHeaders(request(), identity);
		expect(output.get("x-smartdeploy-binding-id")).toBe(OPTIONS.bindingId); expect(output.get("x-smartdeploy-environment")).toBe("published");
		expect(JSON.parse(Buffer.from(output.get("x-smartdeploy-identity") ?? "", "base64url").toString("utf8"))).toEqual(identity);
		expect(() => new GatewayHttpIsolation({ ...OPTIONS, appOrigin: "http://app.test" })).toThrow();
		expect(() => new GatewayHttpIsolation({ ...OPTIONS, bindingId: "bad" })).toThrow();
	});
});

describe("customer response cookie/cache/origin boundary", () => {
	it("preserves separate valid app cookies and gives them secure host-only defaults", () => {
		const source = new Headers({ "content-type": "application/json", etag: "v1" });
		source.append("set-cookie", "theme=dark"); source.append("set-cookie", "preference=compact; Path=/items; HttpOnly; SameSite=Strict; Max-Age=3600");
		const output = policy.responseHeaders(source);
		expect(output.getSetCookie()).toEqual(["theme=dark; Secure; Path=/; SameSite=Lax", "preference=compact; Path=/items; HttpOnly; SameSite=Strict; Max-Age=3600; Secure"]);
		expect(source.getSetCookie()[0]).toBe("theme=dark"); expect(output.get("etag")).toBe("v1");
	});
	it("allows a standard expiry, deletion and explicit __Host- app preference while discarding unknown extensions", () => {
		const source = new Headers({ "set-cookie": "__Host-preference=; Path=/; Secure; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Priority=High; VendorFlag=yes" });
		const output = policy.responseHeaders(source).getSetCookie()[0];
		expect(output).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT"); expect(output).toContain("Max-Age=0"); expect(output).not.toContain("VendorFlag");
	});
	it.each(["__Host-smartdeploy-app-session=evil", "__host-smartdeploy-app-login=evil", "__Host-smartdeploy.session_token=evil", "better-auth.session_token=evil", "theme=dark; Domain=control.test", "theme=dark; Domain=app.control.test",
		"theme=dark; DOMAIN=.control.test", "theme=one, __Host-smartdeploy-app-session=evil", "theme=dark; SameSite=None; samesite=Lax", "__Host-preference=x; Path=/items", "theme=dark; Secure=no", "theme=x; Expires=Thu, 01 Jan 1970 00:00:00 GMT, injected=1", "theme=x; Max-Age=not-a-number", "theme=x; Path=/a,b"])("rejects unsafe upstream cookie without forwarding it: %s", (cookie) => {
		denied(() => policy.responseHeaders(new Headers({ "set-cookie": cookie })), 502);
	});
	it("blocks CORS, site-wide clearing, auth prompts, alternate routing and public caches without weakening app CSP", () => {
		const output = policy.responseHeaders(new Headers({ "access-control-allow-origin": "*", "access-control-allow-credentials": "true", "timing-allow-origin": "*",
			"clear-site-data": '"cookies", "storage"', "www-authenticate": 'Basic realm="app"', "alt-svc": 'h3=":444"', "cache-control": "public, s-maxage=99999", "cdn-cache-control": "public",
			"vercel-cdn-cache-control": "public", "surrogate-control": "public", "x-smartdeploy-identity": "spoofed", "service-worker-allowed": "/", "x-frame-options": "ALLOWALL",
			"content-security-policy": "default-src 'self'; frame-ancestors *", vary: "Accept-Encoding" }));
		for (const name of ["access-control-allow-origin", "access-control-allow-credentials", "timing-allow-origin", "clear-site-data", "www-authenticate", "alt-svc", "cdn-cache-control", "vercel-cdn-cache-control", "surrogate-control", "x-smartdeploy-identity"]) expect(output.has(name)).toBe(false);
		expect(output.get("cache-control")).toBe("private, no-store"); expect(output.get("cross-origin-resource-policy")).toBe("same-origin");
		expect(output.get("content-security-policy")).toBe("default-src 'self'; frame-ancestors *, frame-ancestors 'self'");
		expect(output.get("x-frame-options")).toBe("SAMEORIGIN"); expect(output.get("service-worker-allowed")).toBe("/__smartdeploy/disabled-workers/");
		expect(output.get("referrer-policy")).toBe("same-origin"); expect(output.get("vary")).toContain("Cookie, Origin, Sec-Fetch-Site");
	});
	it("consumes nominated response headers, validates reserved cookies even when nominated and bounds responses", () => {
		const output = policy.responseHeaders(new Headers({ connection: "x-hop, vary", "x-hop": "secret", vary: "X-Hop" }));
		expect(output.has("x-hop")).toBe(false); expect(output.has("connection")).toBe(false); expect(output.get("vary")).not.toContain("X-Hop");
		denied(() => policy.responseHeaders(new Headers({ connection: "set-cookie", "set-cookie": "__Host-smartdeploy-app-session=evil" })), 502);
		denied(() => policy.responseHeaders(new Headers({ "x-large": "x".repeat(32768) })), 502);
		denied(() => policy.responseHeaders(new Headers({ "set-cookie": "large=" + "x".repeat(4096) })), 502);
	});
});

describe("shared reserved path classification", () => {
	it("leaves ordinary paths public and fails closed on excessive encoding", () => {
		expect(gatewayPathKind(new URL(OPTIONS.appOrigin + "/items"))).toBe("public");
		expect(gatewayPathKind(new URL(OPTIONS.appOrigin + "/%2525252525"))).toBe("invalid");
	});
});
