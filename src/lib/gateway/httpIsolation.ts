import { z } from "zod";
import { BrowserLoginIdentity } from "../apps/browserLogin";
import type { AppEnvironment } from "../apps/types";
import { secureOrigin, type GatewayIdentity } from "./controlClient";
import { gatewayPathKind } from "./paths";

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const COOKIE_VALUE = /^(?:[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*|"[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*")$/;
const HOP = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];
const REQUEST_PRIVATE = new Set(["authorization", "cookie", "cookie2", "host", "forwarded", "referer", "content-length", "expect"]);
const RESPONSE_PRIVATE = new Set(["set-cookie", "set-cookie2", "clear-site-data", "www-authenticate", "alt-svc", "timing-allow-origin", "cdn-cache-control", "vercel-cdn-cache-control", "surrogate-control"]);
const COOKIE_PREFIXES = ["__host-smartdeploy", "smartdeploy.", "__secure-smartdeploy.", "better-auth.", "__secure-better-auth."];
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const WORKER_SCOPE = "/__smartdeploy/disabled-workers/";

export interface GatewayHttpContext { appOrigin: string; bindingId: string; environment: AppEnvironment }
export class GatewayHttpError extends Error {
	constructor(public readonly status: 400 | 403 | 502) { super(status === 502 ? "App response unavailable." : "App request unavailable."); }
}

function bound(headers: Headers, limit: number, status: 400 | 502): void {
	let size = 0; let count = 0;
	for (const [name, value] of headers) { size += Buffer.byteLength(name + value, "utf8") + 4; count++; }
	if (size > limit || count > 128) throw new GatewayHttpError(status);
}
function hopHeaders(headers: Headers, status: 400 | 502): Set<string> {
	const result = new Set(HOP);
	const connection = headers.get("connection");
	if (connection !== null) for (const raw of connection.split(",")) {
		const name = raw.trim().toLowerCase();
		if (!TOKEN.test(name)) throw new GatewayHttpError(status);
		result.add(name);
	}
	return result;
}
function reservedCookie(name: string): boolean {
	const value = name.toLowerCase();
	return COOKIE_PREFIXES.some((prefix) => value.startsWith(prefix));
}
function appCookies(value: string): string {
	const result: string[] = []; const names = new Set<string>();
	for (const raw of value.split(";")) {
		const pair = raw.trim(); const separator = pair.indexOf("=");
		const name = pair.slice(0, separator); const content = pair.slice(separator + 1);
		if (separator < 1 || !TOKEN.test(name) || !COOKIE_VALUE.test(content)) throw new GatewayHttpError(400);
		if (reservedCookie(name)) continue;
		if (names.has(name)) throw new GatewayHttpError(400);
		names.add(name); result.push(pair);
	}
	return result.join("; ");
}
function appSetCookie(value: string): string {
	if (Buffer.byteLength(value, "utf8") > 4096) throw new GatewayHttpError(502);
	const [pair, ...attributes] = value.split(";").map((part) => part.trim());
	const separator = pair.indexOf("="); const name = pair.slice(0, separator);
	if (separator < 1 || !TOKEN.test(name) || reservedCookie(name) || !COOKIE_VALUE.test(pair.slice(separator + 1))) throw new GatewayHttpError(502);
	const result = [pair]; const seen = new Set<string>(); let path = "";
	for (const attribute of attributes) {
		const index = attribute.indexOf("=");
		const key = (index < 0 ? attribute : attribute.slice(0, index)).toLowerCase();
		const content = index < 0 ? "" : attribute.slice(index + 1);
		if (!TOKEN.test(key) || seen.has(key) || key === "domain") throw new GatewayHttpError(502);
		seen.add(key);
		if (key === "secure" || key === "httponly" || key === "partitioned") {
			if (index !== -1) throw new GatewayHttpError(502);
			result.push(attribute);
		} else if (key === "path") {
			if (!content.startsWith("/") || /[^\x21-\x7e]|[,\\]/.test(content)) throw new GatewayHttpError(502);
			path = content; result.push(attribute);
		} else if (key === "samesite") {
			if (!/^(lax|strict|none)$/i.test(content)) throw new GatewayHttpError(502);
			result.push(attribute);
		} else if (key === "max-age") {
			if (!/^-?\d+$/.test(content) || !Number.isSafeInteger(Number(content))) throw new GatewayHttpError(502);
			result.push(attribute);
		} else if (key === "expires") {
			if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(content) || !Number.isFinite(Date.parse(content))) throw new GatewayHttpError(502);
			result.push(attribute);
		} else if (key === "priority") {
			if (!/^(low|medium|high)$/i.test(content)) throw new GatewayHttpError(502);
			result.push(attribute);
		} else if (/[\u0000-\u0020\u007f,]/.test(attribute)) throw new GatewayHttpError(502);
	}
	if (name.startsWith("__Host-") && path && path !== "/") throw new GatewayHttpError(502);
	if (!seen.has("secure")) result.push("Secure");
	if (!seen.has("path")) result.push("Path=/");
	if (!seen.has("samesite")) result.push("SameSite=Lax");
	return result.join("; ");
}

/** HTTP policy only. Handle reserved gateway routes separately, freshly authorize,
 * and verify the configured upstream's TLS identity before forwarding anything. */
export class GatewayHttpIsolation {
	readonly #app: URL;
	readonly #bindingId: string;
	readonly #environment: AppEnvironment;
	constructor(context: GatewayHttpContext) {
		this.#app = secureOrigin(context.appOrigin);
		if (!z.uuid().safeParse(context.bindingId).success || !["published", "preview"].includes(context.environment)) throw new Error("Explicit gateway binding/environment required.");
		this.#bindingId = context.bindingId; this.#environment = context.environment;
	}

	assertBrowserRequest(request: Request): void {
		bound(request.headers, 16384, 400);
		const url = new URL(request.url); const host = request.headers.get("host");
		if (url.origin !== this.#app.origin || (host !== null && host.toLowerCase() !== this.#app.host)) throw new GatewayHttpError(403);
		if (!METHODS.has(request.method) || request.headers.has("upgrade")) throw new GatewayHttpError(403);
		if (Buffer.byteLength(request.url, "utf8") > 4096 || url.hash || gatewayPathKind(url) !== "public") throw new GatewayHttpError(400);
		const origin = request.headers.get("origin"); const site = request.headers.get("sec-fetch-site");
		if (origin !== null && origin !== this.#app.origin) throw new GatewayHttpError(403);
		const safe = request.method === "GET" || request.method === "HEAD";
		if (!safe) {
			if (origin !== this.#app.origin || (site !== null && site !== "same-origin")) throw new GatewayHttpError(403);
			return;
		}
		if (site === "same-origin") return;
		// Cross-origin links may navigate a document, never fetch data/assets or frame it.
		const document = request.method === "GET" && origin === null && request.headers.get("sec-fetch-mode") === "navigate" && request.headers.get("sec-fetch-dest") === "document";
		if (document && (site === "none" || site === "same-site" || site === "cross-site")) return;
		// Legacy clients retain same-origin Origin proof or an HTML navigation fallback.
		if (site === null && (origin === this.#app.origin || (origin === null && request.headers.get("accept")?.includes("text/html") === true
			&& [null, "navigate"].includes(request.headers.get("sec-fetch-mode")) && [null, "document"].includes(request.headers.get("sec-fetch-dest"))))) return;
		throw new GatewayHttpError(403);
	}

	requestHeaders(request: Request, verifiedIdentity: GatewayIdentity): Headers {
		this.assertBrowserRequest(request);
		const identity = BrowserLoginIdentity.safeParse(verifiedIdentity);
		if (!identity.success) throw new GatewayHttpError(403);
		const source = request.headers; const hop = hopHeaders(source, 400); const result = new Headers();
		for (const [name, value] of source) {
			if (hop.has(name) || REQUEST_PRIVATE.has(name)
				|| name.startsWith("x-forwarded-") || name.startsWith("x-smartdeploy-") || name.startsWith("sec-") || name === "x-real-ip") continue;
			result.append(name, value);
		}
		if (!hop.has("cookie") && source.has("cookie")) { const cookies = appCookies(source.get("cookie") ?? ""); if (cookies) result.set("cookie", cookies); }
		result.set("host", this.#app.host); result.set("x-forwarded-host", this.#app.host); result.set("x-forwarded-proto", "https");
		result.set("x-smartdeploy-binding-id", this.#bindingId); result.set("x-smartdeploy-environment", this.#environment);
		result.set("x-smartdeploy-identity", Buffer.from(JSON.stringify(identity.data), "utf8").toString("base64url"));
		bound(result, 16384, 400); return result;
	}

	responseHeaders(source: Headers): Headers {
		bound(source, 32768, 502);
		const hop = hopHeaders(source, 502); const result = new Headers();
		for (const [name, value] of source) {
			if (hop.has(name) || RESPONSE_PRIVATE.has(name)
				|| name.startsWith("access-control-") || name.startsWith("x-smartdeploy-")) continue;
			result.append(name, value);
		}
		for (const cookie of source.getSetCookie()) { const safe = appSetCookie(cookie); if (!hop.has("set-cookie")) result.append("set-cookie", safe); }
		result.set("cache-control", "private, no-store"); result.set("referrer-policy", "same-origin");
		result.set("cross-origin-resource-policy", "same-origin"); result.set("x-frame-options", "SAMEORIGIN");
		result.append("content-security-policy", "frame-ancestors 'self'");
		result.set("service-worker-allowed", WORKER_SCOPE); result.set("x-content-type-options", "nosniff");
		result.set("vary", [result.get("vary"), "Cookie", "Origin", "Sec-Fetch-Site", "Sec-Fetch-Mode", "Sec-Fetch-Dest"].filter(Boolean).join(", "));
		bound(result, 32768, 502); return result;
	}
}
