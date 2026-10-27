import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { gatewayPathKind } from "./paths";

export const GATEWAY_LOGIN_COOKIE = "__Host-smartdeploy-app-login";
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BINDING_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETURN_ORIGIN = "https://return.invalid";

export interface BrowserTransactionLimits { ttlSeconds: number; maxEntries: number }
export interface BrowserTransactionStart { state: string; challenge: string; cookie: string; expiresAt: Date }
export interface BrowserTransactionClaim { verifier: string; returnPath: string }
interface StoredTransaction {
	bindingId: string;
	browserHash: Buffer;
	verifier: string;
	returnPath: string;
	expiresAt: number;
}

function digest(value: string): Buffer { return createHash("sha256").update(value, "utf8").digest(); }

function returnPath(value: string): string {
	if (Buffer.byteLength(value, "utf8") > 2048 || !value.startsWith("/") || value.startsWith("//")
		|| /[\\\u0000-\u0020\u007f#]/.test(value)) throw new Error("Invalid app return path.");
	const url = new URL(value, RETURN_ORIGIN);
	if (url.origin !== RETURN_ORIGIN || gatewayPathKind(url) !== "public") {
		throw new Error("Invalid app return path.");
	}
	return url.pathname + url.search;
}

function browserToken(cookie: string | null): string | null {
	if (!cookie || cookie.length > 16384) return null;
	const matches = cookie.split(";").map((part) => part.trim()).filter((part) => part.startsWith(GATEWAY_LOGIN_COOKIE + "="));
	if (matches.length !== 1) return null;
	const token = matches[0].slice(GATEWAY_LOGIN_COOKIE.length + 1);
	return SECRET_PATTERN.test(token) ? token : null;
}

/** Trusted single-process gateway state. Never expose the verifier or raw cookie in JSON/logs. */
export class BrowserTransactions {
	readonly #entries = new Map<string, StoredTransaction>();
	readonly #limits: BrowserTransactionLimits;
	readonly #now: () => number;

	constructor(limits: BrowserTransactionLimits, now: () => number = Date.now) {
		if (!Number.isInteger(limits.ttlSeconds) || limits.ttlSeconds < 1 || limits.ttlSeconds > 600
			|| !Number.isInteger(limits.maxEntries) || limits.maxEntries < 1 || limits.maxEntries > 10000) {
			throw new Error("Explicit bounded browser transaction limits required.");
		}
		this.#limits = { ...limits };
		this.#now = now;
	}

	start(bindingId: string, path: string): BrowserTransactionStart {
		if (!BINDING_PATTERN.test(bindingId)) throw new Error("Invalid gateway binding.");
		const destination = returnPath(path);
		const now = this.#now();
		this.#prune(now);
		if (this.#entries.size >= this.#limits.maxEntries) throw new Error("Browser login capacity unavailable.");
		const state = randomBytes(32).toString("base64url");
		const browser = randomBytes(32).toString("base64url");
		const verifier = randomBytes(32).toString("base64url");
		const expiresAt = now + this.#limits.ttlSeconds * 1000;
		this.#entries.set(digest(state).toString("hex"), { bindingId, browserHash: digest(browser), verifier, returnPath: destination, expiresAt });
		return {
			state, challenge: digest(verifier).toString("base64url"), expiresAt: new Date(expiresAt),
			cookie: `${GATEWAY_LOGIN_COOKIE}=${browser}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${this.#limits.ttlSeconds}`,
		};
	}

	/** Consume synchronously before any async redemption; wrong-browser requests cannot burn another flow. */
	claim(bindingId: string, state: string, cookie: string | null): BrowserTransactionClaim | null {
		const now = this.#now();
		this.#prune(now);
		if (!BINDING_PATTERN.test(bindingId) || !SECRET_PATTERN.test(state)) return null;
		const browser = browserToken(cookie);
		if (!browser) return null;
		const key = digest(state).toString("hex");
		const transaction = this.#entries.get(key);
		if (!transaction || transaction.bindingId !== bindingId || !timingSafeEqual(transaction.browserHash, digest(browser))) return null;
		this.#entries.delete(key);
		return { verifier: transaction.verifier, returnPath: transaction.returnPath };
	}

	#prune(now: number): void {
		for (const [key, value] of this.#entries) if (value.expiresAt <= now) this.#entries.delete(key);
	}
}
