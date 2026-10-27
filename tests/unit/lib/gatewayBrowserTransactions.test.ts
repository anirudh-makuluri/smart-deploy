import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BrowserTransactions, GATEWAY_LOGIN_COOKIE } from "@/lib/gateway/browserTransactions";

const BINDING = "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac";
const OTHER_BINDING = "91843492-f2ea-437c-a540-b144c3bc8ed2";
const LIMITS = { ttlSeconds: 300, maxEntries: 10 };
function cookie(value: string): string { return value.split(";")[0]; }

describe("gateway browser-bound login transactions", () => {
	it("exposes only a challenge, state and protected cookie until the matching browser claims", () => {
		const store = new BrowserTransactions(LIMITS, () => 1000);
		const started = store.start(BINDING, "/items?sort=new");
		expect(started).not.toHaveProperty("verifier");
		expect(started.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(started.cookie).toMatch(new RegExp(`^${GATEWAY_LOGIN_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300$`));
		expect(started.cookie).not.toContain("Domain=");
		expect(started.expiresAt.getTime()).toBe(301000);
		const claimed = store.claim(BINDING, started.state, cookie(started.cookie));
		if (!claimed) throw new Error("Expected the matching browser to claim.");
		expect(claimed.returnPath).toBe("/items?sort=new");
		expect(createHash("sha256").update(claimed.verifier).digest("base64url")).toBe(started.challenge);
		expect(store.claim(BINDING, started.state, cookie(started.cookie))).toBeNull();
	});

	it("rejects state, browser and binding swaps without consuming the rightful flow", () => {
		const store = new BrowserTransactions(LIMITS);
		const first = store.start(BINDING, "/first");
		const second = store.start(BINDING, "/second");
		expect(store.claim(BINDING, first.state, cookie(second.cookie))).toBeNull();
		expect(store.claim(BINDING, second.state, cookie(first.cookie))).toBeNull();
		expect(store.claim(OTHER_BINDING, first.state, cookie(first.cookie))).toBeNull();
		expect(store.claim(BINDING, "s".repeat(43), cookie(first.cookie))).toBeNull();
		expect(store.claim(BINDING, first.state, cookie(first.cookie))?.returnPath).toBe("/first");
		expect(store.claim(BINDING, second.state, cookie(second.cookie))?.returnPath).toBe("/second");
	});

	it("allows only one callback to claim before asynchronous work starts", async () => {
		const store = new BrowserTransactions(LIMITS);
		const started = store.start(BINDING, "/");
		const results = await Promise.all([0, 1].map(async () => store.claim(BINDING, started.state, cookie(started.cookie))));
		expect(results.filter(Boolean)).toHaveLength(1);
	});

	it("expires at the exact deadline and recovers bounded capacity without a background timer", () => {
		let now = 1000;
		const store = new BrowserTransactions({ ttlSeconds: 1, maxEntries: 1 }, () => now);
		const started = store.start(BINDING, "/");
		expect(() => store.start(BINDING, "/")).toThrow("Browser login capacity unavailable.");
		now = 2000;
		expect(store.claim(BINDING, started.state, cookie(started.cookie))).toBeNull();
		expect(() => store.start(BINDING, "/")).not.toThrow();
	});

	it("fails closed after process restart and does not share transactions between instances", () => {
		const first = new BrowserTransactions(LIMITS);
		const second = new BrowserTransactions(LIMITS);
		const started = first.start(BINDING, "/");
		expect(second.claim(BINDING, started.state, cookie(started.cookie))).toBeNull();
	});

	it.each([
		{ label: "missing", header: null }, { label: "empty", header: "" }, { label: "unrelated", header: "other=x" },
		{ label: "malformed token", header: `${GATEWAY_LOGIN_COOKIE}=bad` },
		{ label: "quoted token", header: `${GATEWAY_LOGIN_COOKIE}=\"${"s".repeat(43)}\"` },
		{ label: "excessive header", header: "x".repeat(16385) },
	])("rejects $label browser cookies", ({ header }) => {
		const store = new BrowserTransactions(LIMITS);
		const started = store.start(BINDING, "/");
		expect(store.claim(BINDING, started.state, header)).toBeNull();
		expect(store.claim(BINDING, started.state, cookie(started.cookie))).not.toBeNull();
	});

	it("rejects duplicate reserved cookie values and ignores unrelated cookies", () => {
		const store = new BrowserTransactions(LIMITS);
		const started = store.start(BINDING, "/");
		const value = cookie(started.cookie);
		expect(store.claim(BINDING, started.state, `${value}; ${value}`)).toBeNull();
		expect(store.claim(BINDING, started.state, `other=ok; ${value}; theme=dark`)).not.toBeNull();
	});

	it("copies configuration rather than retaining mutable caller limits", () => {
		const limits = { ttlSeconds: 1, maxEntries: 1 };
		const store = new BrowserTransactions(limits, () => 0);
		limits.ttlSeconds = 99999;
		limits.maxEntries = 99999;
		expect(store.start(BINDING, "/").expiresAt.getTime()).toBe(1000);
		expect(() => store.start(BINDING, "/")).toThrow("Browser login capacity unavailable.");
	});

	it.each([0, -1, 601, 1.5, Infinity, NaN])("rejects invalid TTL %s", (ttlSeconds) => {
		expect(() => new BrowserTransactions({ ttlSeconds, maxEntries: 1 })).toThrow();
	});
	it.each([0, -1, 10001, 1.5, Infinity, NaN])("rejects invalid capacity %s", (maxEntries) => {
		expect(() => new BrowserTransactions({ ttlSeconds: 1, maxEntries })).toThrow();
	});
	it.each(["https://evil.test", "//evil.test/", "/\\evil.test", "/ok\r\nLocation: bad", "/ok#secret", "/__smartdeploy/callback", "/%5f_smartdeploy/callback", "/a/../__smartdeploy/callback", "/bad%ZZ", "/__smartdeploy;params/callback", "/__smartdeploy-extra", "/%255f_smartdeploy/callback", "/file%00name"])("rejects external, reserved or malformed return path: %s", (path) => {
		expect(() => new BrowserTransactions(LIMITS).start(BINDING, path)).toThrow("Invalid app return path.");
	});
	it("bounds the return path's encoded byte length", () => {
		expect(() => new BrowserTransactions(LIMITS).start(BINDING, "/" + "x".repeat(2048))).toThrow("Invalid app return path.");
	});
	it("rejects invalid binding identifiers before allocating a transaction", () => {
		const store = new BrowserTransactions({ ttlSeconds: 1, maxEntries: 1 });
		expect(() => store.start("not-a-binding", "/")).toThrow("Invalid gateway binding.");
		expect(() => store.start(BINDING, "/")).not.toThrow();
	});
});
