import { z } from "zod";
import { BrowserTransactions, type BrowserTransactionLimits, type BrowserTransactionStart } from "./browserTransactions";
import { GatewayControlClient, GatewayControlError, secureOrigin, type GatewayControlOptions, type GatewayFetch, type GatewayIdentity } from "./controlClient";
import { sessionCookie, sessionToken } from "./cookies";

const PREFIX = "/__smartdeploy";
const CALLBACK = PREFIX + "/callback";
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export interface GatewayBrowserOptions extends GatewayControlOptions {
	appOrigin: string;
	transactions: BrowserTransactionLimits;
}

function headers(): Headers {
	return new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
		"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "X-Frame-Options": "DENY" });
}

function failure(status: number): Response {
	const result = headers();
	result.set("Content-Type", "application/json");
	if (status === 405) result.set("Allow", "GET");
	return new Response(JSON.stringify({ error: status === 503 ? "App sign-in is temporarily unavailable." : "App sign-in could not be confirmed." }), { status, headers: result });
}

function navigation(request: Request, origin: string): boolean {
	const sender = request.headers.get("origin");
	const mode = request.headers.get("sec-fetch-mode");
	const destination = request.headers.get("sec-fetch-dest");
	return (sender === null || sender === origin) && (mode === null || mode === "navigate")
		&& (destination === null || destination === "document")
		&& (mode !== null || request.headers.get("accept")?.includes("text/html") === true);
}

/** Operator-selected, per-origin adapter. Non-reserved requests still require identity() before proxying. */
export class GatewayBrowserAuth {
	readonly #app: URL;
	readonly #platform: URL;
	readonly #bindingId: string;
	readonly #transactions: BrowserTransactions;
	readonly #control: GatewayControlClient;
	readonly #now: () => number;

	constructor(options: GatewayBrowserOptions, transport: GatewayFetch = (url, init) => fetch(url, init), now: () => number = Date.now) {
		this.#app = secureOrigin(options.appOrigin);
		this.#platform = secureOrigin(options.platformOrigin);
		if (this.#app.hostname === this.#platform.hostname || !z.uuid().safeParse(options.bindingId).success) {
			throw new Error("Distinct platform/app hosts and a configured binding required.");
		}
		this.#bindingId = options.bindingId;
		this.#transactions = new BrowserTransactions(options.transactions, now);
		this.#control = new GatewayControlClient(options, transport, now);
		this.#now = now;
	}

	#owns(request: Request): boolean {
		const host = request.headers.get("host");
		return new URL(request.url).origin === this.#app.origin && (host === null || host.toLowerCase() === this.#app.host);
	}

	async identity(request: Request): Promise<GatewayIdentity | null> {
		if (!this.#owns(request)) throw new GatewayControlError(403);
		const token = sessionToken(request.headers.get("cookie"));
		return token ? this.#control.authorize(token) : null;
	}

	async handle(request: Request): Promise<Response | null> {
		if (!this.#owns(request)) return failure(403);
		if (request.url.length > 4096) return failure(400);
		const url = new URL(request.url);
		if (url.hash) return failure(400);
		let decoded = url.pathname;
		let reserved = false;
		for (let depth = 0; depth < 4; depth++) {
			let canonical: URL;
			try { canonical = new URL(decoded.replaceAll("\\", "/"), this.#app); }
			catch { return failure(400); }
			if (canonical.origin !== this.#app.origin) return failure(400);
			if (/^\/+__smartdeploy(?:\/|$)/i.test(canonical.pathname)) { reserved = true; break; }
			let next: string;
			try { next = decodeURIComponent(decoded); }
			catch { return failure(400); }
			if (next === decoded) break;
			if (depth === 3) return failure(400);
			decoded = next;
		}
		if (!reserved) return null;
		if (request.method !== "GET") return failure(405);
		if (!navigation(request, this.#app.origin)) return failure(403);
		if (url.pathname === PREFIX + "/login") return this.#start(url);
		if (url.pathname === CALLBACK) return this.#callback(url, request.headers.get("cookie"));
		return failure(404);
	}

	#start(url: URL): Response {
		if ([...url.searchParams.keys()].some((key) => key !== "returnPath") || url.searchParams.getAll("returnPath").length > 1) return failure(400);
		let flow: BrowserTransactionStart;
		try { flow = this.#transactions.start(this.#bindingId, url.searchParams.get("returnPath") ?? "/"); }
		catch (error) { return failure(error instanceof Error && error.message === "Browser login capacity unavailable." ? 503 : 400); }
		const target = new URL("/apps/authorize", this.#platform);
		target.searchParams.set("bindingId", this.#bindingId);
		target.searchParams.set("challenge", flow.challenge);
		target.searchParams.set("state", flow.state);
		const result = headers();
		result.set("Location", target.href);
		result.set("Set-Cookie", flow.cookie);
		return new Response(null, { status: 303, headers: result });
	}

	async #callback(url: URL, cookie: string | null): Promise<Response> {
		if ([...url.searchParams.keys()].some((key) => key !== "code" && key !== "state")
			|| url.searchParams.getAll("code").length !== 1 || url.searchParams.getAll("state").length !== 1) return failure(400);
		const code = url.searchParams.get("code") ?? "";
		const state = url.searchParams.get("state") ?? "";
		if (!SECRET.test(code) || !SECRET.test(state)) return failure(400);
		const transaction = this.#transactions.claim(this.#bindingId, state, cookie);
		if (!transaction) return failure(403);
		try {
			const redeemed = await this.#control.redeem(code, transaction.verifier, this.#app.origin + CALLBACK);
			let session: string;
			try { session = sessionCookie(redeemed.token, redeemed.expiresAt, this.#now()); }
			catch { await this.#control.revoke(redeemed.token).catch(() => {}); return failure(503); }
			const result = headers();
			result.set("Set-Cookie", session);
			result.set("Location", transaction.returnPath);
			return new Response(null, { status: 303, headers: result });
		} catch (error) { return failure(error instanceof GatewayControlError ? error.status : 503); }
	}
}
