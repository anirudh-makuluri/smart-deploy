import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BrowserTransactions, GATEWAY_LOGIN_COOKIE } from "../../src/lib/gateway/browserTransactions";

const BINDING_A = "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac";
const BINDING_B = "91843492-f2ea-437c-a540-b144c3bc8ed2";
interface StartedFlow { state: string; challenge: string }
interface ClaimedFlow { claimed: boolean; returnPath: string | null }

async function start(page: Page): Promise<StartedFlow> {
	return page.evaluate(async () => { const response = await fetch("/start"); if (!response.ok) throw new Error("Fixture start failed"); return response.json(); });
}
async function claim(page: Page, state: string): Promise<ClaimedFlow> {
	return page.evaluate(async (value) => { const response = await fetch(`/callback?state=${encodeURIComponent(value)}`); if (!response.ok) throw new Error("Fixture callback failed"); return response.json(); }, state);
}

test.describe("native gateway browser transactions", () => {
	test.skip(process.env.RUN_GATEWAY_BROWSER_TESTS !== "1", "Requires explicit local HTTPS fixture opt-in.");
	test.describe.configure({ mode: "serial" });
	let server: ReturnType<typeof createServer>;
	let certificateDirectory = "";
	let originA: string;
	let originB: string;
	let now = Date.now();
	let transactions = new BrowserTransactions({ ttlSeconds: 300, maxEntries: 1 }, () => now);

	test.beforeAll(async () => {
		certificateDirectory = await mkdtemp(path.join(tmpdir(), "smartdeploy-gateway-browser-"));
		const keyPath = path.join(certificateDirectory, "key.pem");
		const certPath = path.join(certificateDirectory, "cert.pem");
		const windowsOpenSSL = "C:/Program Files/Git/usr/bin/openssl.exe";
		const openssl = process.env.OPENSSL_PATH || (process.platform === "win32" && existsSync(windowsOpenSSL) ? windowsOpenSSL : "openssl");
		execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=control.test",
			"-addext", "subjectAltName=DNS:control.test,DNS:app.control.test", "-keyout", keyPath, "-out", certPath], { stdio: "ignore", windowsHide: true });
		server = createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (request, response) => {
			const host = request.headers.host?.split(":")[0];
			const binding = host === "control.test" ? BINDING_A : host === "app.control.test" ? BINDING_B : null;
			response.setHeader("Cache-Control", "no-store");
			response.setHeader("Referrer-Policy", "no-referrer");
			if (!binding) { response.writeHead(403).end(); return; }
			const url = new URL(request.url ?? "/", "https://fixture.invalid");
			if (url.pathname === "/start") {
				try {
					const flow = transactions.start(binding, "/items?sort=new");
					response.setHeader("Set-Cookie", flow.cookie);
					response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ state: flow.state, challenge: flow.challenge }));
				} catch { response.writeHead(503).end(); }
				return;
			}
			if (url.pathname === "/callback") {
				const result = transactions.claim(binding, url.searchParams.get("state") ?? "", request.headers.cookie ?? null);
				response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ claimed: result !== null, returnPath: result ? result.returnPath : null }));
				return;
			}
			if (url.pathname === "/attack") {
				response.setHeader("Set-Cookie", `${GATEWAY_LOGIN_COOKIE}=blocked-injection; Domain=control.test; Path=/; Secure; HttpOnly; SameSite=Lax`);
				response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ receivedLoginCookie: (request.headers.cookie ?? "").includes(GATEWAY_LOGIN_COOKIE + "=") }));
				return;
			}
			response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>Local gateway transaction fixture</title><p>Fixture ready</p>");
		});
		await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Local HTTPS fixture unavailable");
		originA = `https://control.test:${address.port}`;
		originB = `https://app.control.test:${address.port}`;
	});
	test.beforeEach(() => {
		now = Date.now();
		transactions = new BrowserTransactions({ ttlSeconds: 300, maxEntries: 10 }, () => now);
	});
	test.afterAll(async () => {
		if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		if (certificateDirectory) {
			await unlink(path.join(certificateDirectory, "key.pem")).catch(() => {});
			await unlink(path.join(certificateDirectory, "cert.pem")).catch(() => {});
			await rmdir(certificateDirectory).catch(() => {});
		}
	});

	test("keeps the host-only nonce HttpOnly and consumes only one concurrent callback", async ({ page, context }) => {
		await page.goto(originA);
		const flow = await start(page);
		expect(flow).not.toHaveProperty("verifier");
		expect(flow).not.toHaveProperty("cookie");
		const nonce = (await context.cookies(originA)).find((value) => value.name === GATEWAY_LOGIN_COOKIE);
		expect(nonce).toMatchObject({ domain: "control.test", path: "/", secure: true, httpOnly: true, sameSite: "Lax" });
		expect(await page.evaluate(() => document.cookie)).not.toContain(GATEWAY_LOGIN_COOKIE);
		const results = await Promise.all([claim(page, flow.state), claim(page, flow.state)]);
		expect(results.filter((value) => value.claimed)).toEqual([{ claimed: true, returnPath: "/items?sort=new" }]);
		expect(results.filter((value) => !value.claimed)).toHaveLength(1);
	});

	test("cannot claim another browser's state even after starting its own login", async ({ page, browser }) => {
		await page.goto(originA);
		const first = await start(page);
		const outsider = await browser.newContext({ ignoreHTTPSErrors: true });
		try {
			const otherPage = await outsider.newPage();
			await otherPage.goto(originA);
			expect((await claim(otherPage, first.state)).claimed).toBe(false);
			const second = await start(otherPage);
			expect((await claim(otherPage, first.state)).claimed).toBe(false);
			expect((await claim(page, second.state)).claimed).toBe(false);
			expect((await claim(page, first.state)).claimed).toBe(true);
			expect((await claim(otherPage, second.state)).claimed).toBe(true);
		} finally { await outsider.close(); }
	});

	test("replaces a preexisting JavaScript nonce instead of trusting browser-supplied login state", async ({ page, context }) => {
		await page.goto(originA);
		const fixed = "x".repeat(43);
		await page.evaluate(({ name, value }) => { document.cookie = `${name}=${value}; Path=/; Secure; SameSite=Lax`; }, { name: GATEWAY_LOGIN_COOKIE, value: fixed });
		expect((await context.cookies(originA)).find((value) => value.name === GATEWAY_LOGIN_COOKIE)?.value).toBe(fixed);
		const flow = await start(page);
		const nonce = (await context.cookies(originA)).find((value) => value.name === GATEWAY_LOGIN_COOKIE);
		expect(nonce?.value).not.toBe(fixed);
		expect(nonce?.httpOnly).toBe(true);
		expect((await claim(page, flow.state)).claimed).toBe(true);
	});

	test("rejects sibling injection and does not forward the nonce to another app host", async ({ page, context }) => {
		await page.goto(originA);
		const first = await start(page);
		const original = (await context.cookies(originA)).find((value) => value.name === GATEWAY_LOGIN_COOKIE);
		await page.goto(`${originB}/attack`);
		expect(await page.locator("body").textContent()).toContain('"receivedLoginCookie":false');
		expect((await context.cookies(originA)).find((value) => value.name === GATEWAY_LOGIN_COOKIE)?.value).toBe(original?.value);
		const second = await start(page);
		expect((await claim(page, first.state)).claimed).toBe(false);
		expect((await claim(page, second.state)).claimed).toBe(true);
		await page.goto(originA);
		expect((await claim(page, first.state)).claimed).toBe(true);
	});

	test("allows only the latest started tab to complete after the shared host cookie rotates", async ({ page, context }) => {
		await page.goto(originA);
		const first = await start(page);
		const tab = await context.newPage();
		try {
			await tab.goto(originA);
			const second = await start(tab);
			expect((await claim(page, first.state)).claimed).toBe(false);
			expect((await claim(tab, second.state)).claimed).toBe(true);
		} finally { await tab.close(); }
	});

	test("retains the current flow when capacity is full and rejects expired state despite a retained cookie", async ({ page, context }) => {
		transactions = new BrowserTransactions({ ttlSeconds: 300, maxEntries: 1 }, () => now);
		await page.goto(originA);
		const first = await start(page);
		const original = (await context.cookies(originA)).find((value) => value.name === GATEWAY_LOGIN_COOKIE);
		expect(await page.evaluate(async () => (await fetch("/start")).status)).toBe(503);
		expect((await context.cookies(originA)).find((value) => value.name === GATEWAY_LOGIN_COOKIE)?.value).toBe(original?.value);
		now += 300000;
		expect((await claim(page, first.state)).claimed).toBe(false);
		const fresh = await start(page);
		expect((await claim(page, fresh.state)).claimed).toBe(true);
	});
});
