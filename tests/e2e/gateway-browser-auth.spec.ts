import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { GatewayBrowserAuth } from "../../src/lib/gateway/browserAuth";
import type { GatewayFetch } from "../../src/lib/gateway/controlClient";
import { GATEWAY_SESSION_COOKIE } from "../../src/lib/gateway/cookies";

const BINDING = "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac";
const CREDENTIAL = "sd_gateway_91843492-f2ea-437c-a540-b144c3bc8ed2." + "s".repeat(43);
const IDENTITY = { id: "fixture-creator", email: "fixture@example.test" };
const Secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const SessionInput = z.strictObject({ token: Secret });

async function jsonBody(request: IncomingMessage): Promise<unknown> {
	const parts: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) { const part = Buffer.from(chunk); size += part.byteLength; if (size > 4096) throw new Error("Fixture body limit"); parts.push(part); }
	return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
function json(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
}
async function send(response: ServerResponse, result: Response): Promise<void> {
	for (const [name, value] of result.headers) if (name !== "set-cookie") response.setHeader(name, value);
	const cookies = result.headers.getSetCookie();
	if (cookies.length) response.setHeader("Set-Cookie", cookies);
	response.writeHead(result.status).end(Buffer.from(await result.arrayBuffer()));
}

test.describe("native gateway browser authentication adapter", () => {
	test.skip(process.env.RUN_GATEWAY_BROWSER_TESTS !== "1", "Requires explicit local HTTPS fixture opt-in.");
	test.describe.configure({ mode: "serial" });
	let server: ReturnType<typeof createServer>;
	let certificateDirectory = "";
	let platformOrigin: string;
	let appOrigin: string;
	let auth: GatewayBrowserAuth;
	let transport: GatewayFetch;
	let malformed = false;
	let revoked = false;
	let redemptionRequests = 0;
	let authorizationRequests = 0;
	let customerRequests: string[] = [];
	let browserHeadersReachedMachineApi = false;
	let platformCookieReachedApp = false;
	let approvalRequest: { method: string; origin: string | null } | null = null;
	const codes = new Map<string, { challenge: string; state: string }>();
	const sessions = new Set<string>();

	test.beforeAll(async () => {
		certificateDirectory = await mkdtemp(path.join(tmpdir(), "smartdeploy-gateway-auth-"));
		const keyPath = path.join(certificateDirectory, "key.pem");
		const certPath = path.join(certificateDirectory, "cert.pem");
		const windowsOpenSSL = "C:/Program Files/Git/usr/bin/openssl.exe";
		const openssl = process.env.OPENSSL_PATH || (process.platform === "win32" && existsSync(windowsOpenSSL) ? windowsOpenSSL : "openssl");
		execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=control.test",
			"-addext", "subjectAltName=DNS:control.test,DNS:app.control.test", "-keyout", keyPath, "-out", certPath], { stdio: "ignore", windowsHide: true });
		const certificate = await readFile(certPath);
		server = createServer({ key: await readFile(keyPath), cert: certificate }, async (request, response) => {
			try {
				const host = request.headers.host;
				if (host === new URL(platformOrigin).host) {
					const url = new URL(request.url ?? "/", platformOrigin);
					if (url.pathname === "/apps/authorize" || url.pathname === "/approve") {
						if (url.pathname === "/approve") approvalRequest = { method: request.method ?? "", origin: request.headers.origin ?? null };
						const input = z.strictObject({ bindingId: z.literal(BINDING), challenge: Secret, state: Secret }).safeParse(Object.fromEntries(url.searchParams));
						if (!input.success) { json(response, 400, {}); return; }
						if (url.pathname === "/apps/authorize" && request.method === "GET") {
							response.setHeader("Set-Cookie", "__Host-fixture-platform=test-only; Path=/; Secure; HttpOnly; SameSite=Lax");
							const action = ("/approve?" + url.searchParams.toString()).replaceAll("&", "&amp;");
							response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" })
								.end(`<!doctype html><title>Synthetic control-plane consent</title><link rel="icon" href="data:,"><p>Fixture identity only</p><form method="post" action="${action}"><button>Approve fixture app</button></form><script>
document.querySelector('form').addEventListener('submit', async event => {
 event.preventDefault();
 const response = await fetch(event.currentTarget.action, {method:'POST',headers:{'content-type':'application/json'},body:'{}',redirect:'error'});
 if (!response.ok) return;
 const result = await response.json();
 const target = new URL(${JSON.stringify(appOrigin + "/__smartdeploy/callback")});
 target.searchParams.set('code', result.code); target.searchParams.set('state', result.state);
 window.location.replace(target.href);
});</script>`);
							return;
						}
						if (url.pathname === "/approve" && request.method === "POST" && request.headers.origin === platformOrigin) {
							request.resume();
							const code = randomBytes(32).toString("base64url");
							codes.set(code, { challenge: input.data.challenge, state: input.data.state });
							json(response, 200, { code, state: input.data.state });
							return;
						}
						json(response, 403, {}); return;
					}
					if (url.pathname.startsWith("/api/gateway/")) {
						browserHeadersReachedMachineApi ||= ["cookie", "origin", "sec-fetch-site"].some((name) => Boolean(request.headers[name]));
						if (request.method !== "POST" || request.headers.authorization !== `Bearer ${CREDENTIAL}` || request.headers["x-smartdeploy-binding-id"] !== BINDING || browserHeadersReachedMachineApi) { json(response, 403, {}); return; }
						const body = await jsonBody(request);
						if (url.pathname.endsWith("/redeem")) {
							redemptionRequests++;
							const input = z.strictObject({ code: Secret, verifier: Secret, callbackUrl: z.literal(appOrigin + "/__smartdeploy/callback") }).safeParse(body);
							const pending = input.success ? codes.get(input.data.code) : null;
							if (!input.success || !pending || createHash("sha256").update(input.data.verifier).digest("base64url") !== pending.challenge) { json(response, 401, {}); return; }
							codes.delete(input.data.code);
							if (malformed) { json(response, 200, { token: "unconfirmed" }); return; }
							const token = randomBytes(32).toString("base64url");
							sessions.add(token);
							json(response, 200, { token, expiresAt: new Date(Date.now() + 900000).toISOString(), identity: IDENTITY }); return;
						}
						const input = SessionInput.safeParse(body);
						if (!input.success) { json(response, 400, {}); return; }
						if (url.pathname.endsWith("/authorize")) {
							authorizationRequests++;
							json(response, sessions.has(input.data.token) && !revoked ? 200 : 403, { identity: IDENTITY }); return;
						}
						if (url.pathname.endsWith("/logout")) { sessions.delete(input.data.token); json(response, 200, { revoked: true }); return; }
					}
					json(response, 404, {}); return;
				}
				if (host !== new URL(appOrigin).host) { json(response, 403, {}); return; }
				platformCookieReachedApp ||= (request.headers.cookie ?? "").includes("__Host-fixture-platform=");
				const incomingHeaders = new Headers();
				for (const [name, value] of Object.entries(request.headers)) if (value !== undefined) incomingHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
				const incoming = new Request(new URL(request.url ?? "/", appOrigin), { method: request.method, headers: incomingHeaders });
				const managed = await auth.handle(incoming);
				if (managed) { await send(response, managed); return; }
				const identity = await auth.identity(incoming);
				if (!identity) { response.writeHead(303, { Location: "/__smartdeploy/login?returnPath=" + encodeURIComponent(request.url ?? "/") }).end(); return; }
				customerRequests.push(request.url ?? "/");
				response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }).end("<!doctype html><title>Private fixture</title><link rel=\"icon\" href=\"data:,\"><p>Private fixture: fixture-creator</p>");
			} catch { json(response, 403, { error: "Fixture denied" }); }
		});
		await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Local HTTPS fixture unavailable");
		platformOrigin = `https://control.test:${address.port}`;
		appOrigin = `https://app.control.test:${address.port}`;
		transport = (url, init) => new Promise<Response>((resolve, reject) => {
			if (url.origin !== platformOrigin) { reject(new Error("Unexpected fixture transport target")); return; }
			const call = httpsRequest({ hostname: "127.0.0.1", port: address.port, servername: url.hostname, ca: certificate,
				path: url.pathname, method: init.method, headers: { ...Object.fromEntries(new Headers(init.headers)), host: url.host }, ...(init.signal ? { signal: init.signal } : {}) }, (incoming) => {
				const parts: Buffer[] = [];
				incoming.on("data", (chunk: Buffer) => parts.push(chunk));
				incoming.on("error", reject);
				incoming.on("end", () => {
					const headers = new Headers();
					for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
					const result = new Response(new Uint8Array(Buffer.concat(parts)), { status: incoming.statusCode ?? 503, headers });
					Object.defineProperty(result, "url", { value: url.href });
					resolve(result);
				});
			});
			call.on("error", reject);
			call.end(String(init.body ?? ""));
		});
	});
	test.beforeEach(() => {
		codes.clear(); sessions.clear(); malformed = false; revoked = false; redemptionRequests = 0; authorizationRequests = 0;
		customerRequests = []; browserHeadersReachedMachineApi = false; platformCookieReachedApp = false;
		approvalRequest = null;
		auth = new GatewayBrowserAuth({ appOrigin, platformOrigin, bindingId: BINDING, serviceCredential: CREDENTIAL, timeoutMs: 2000, transactions: { ttlSeconds: 300, maxEntries: 20 } }, transport);
	});
	test.afterAll(async () => {
		if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		if (certificateDirectory) {
			await unlink(path.join(certificateDirectory, "key.pem")).catch(() => {});
			await unlink(path.join(certificateDirectory, "cert.pem")).catch(() => {});
			await rmdir(certificateDirectory).catch(() => {});
		}
	});

	async function approve(page: Page): Promise<void> {
		await expect(page.getByRole("button", { name: "Approve fixture app" })).toBeVisible();
		await page.getByRole("button", { name: "Approve fixture app" }).click();
		await expect.poll(() => approvalRequest).toEqual({ method: "POST", origin: platformOrigin });
		await expect(page).toHaveURL(appOrigin + "/items?sort=new");
	}
	test("completes S256 redemption over HTTPS, sets a separate app cookie and preserves the stored local destination", async ({ page, context }) => {
		await page.goto(appOrigin + "/items?sort=new");
		expect(new URL(page.url()).origin).toBe(platformOrigin);
		expect([...new URL(page.url()).searchParams.keys()].sort()).toEqual(["bindingId", "challenge", "state"]);
		await approve(page);
		await expect(page.getByText("Private fixture: fixture-creator")).toBeVisible();
		expect((await context.cookies(appOrigin)).find((value) => value.name === GATEWAY_SESSION_COOKIE)).toMatchObject({ domain: "app.control.test", path: "/", secure: true, httpOnly: true, sameSite: "Lax" });
		expect(await page.evaluate(() => document.cookie)).not.toContain(GATEWAY_SESSION_COOKIE);
		expect(redemptionRequests).toBe(1);
		expect(authorizationRequests).toBe(1);
		expect(browserHeadersReachedMachineApi).toBe(false);
		expect(platformCookieReachedApp).toBe(false);
		expect(customerRequests).toEqual(["/items?sort=new"]);
	});
	test("cannot redeem an approved callback in another browser and leaves the rightful browser's flow intact", async ({ page, browser }) => {
		await page.goto(appOrigin + "/items?sort=new");
		const body = await page.evaluate(async () => {
			const target = new URL(window.location.href);
			const response = await fetch("/approve?" + target.searchParams.toString(), { method: "POST", headers: { "content-type": "application/json" }, body: "{}", redirect: "error" });
			if (!response.ok) throw new Error("Fixture approval failed");
			return response.json() as Promise<{ code: string; state: string }>;
		});
		const callback = `${appOrigin}/__smartdeploy/callback?code=${body.code}&state=${body.state}`;
		const outsider = await browser.newContext({ ignoreHTTPSErrors: true });
		try {
			const other = await outsider.newPage();
			await other.goto(appOrigin + "/items?sort=new");
			expect((await other.goto(callback))?.status()).toBe(403);
			expect(redemptionRequests).toBe(0);
			await page.goto(callback);
			await expect(page).toHaveURL(appOrigin + "/items?sort=new");
			expect(redemptionRequests).toBe(1);
		} finally { await outsider.close(); }
	});
	test("does not mint a browser session or retry a consumed callback after malformed successful redemption", async ({ page, context }) => {
		malformed = true;
		await page.goto(appOrigin + "/items?sort=new");
		await page.getByRole("button", { name: "Approve fixture app" }).click();
		await expect(page).toHaveURL(/\/__smartdeploy\/callback\?/);
		expect(await page.locator("body").textContent()).toContain("temporarily unavailable");
		expect((await context.cookies(appOrigin)).some((value) => value.name === GATEWAY_SESSION_COOKIE)).toBe(false);
		const callback = page.url();
		expect((await page.goto(callback))?.status()).toBe(403);
		expect(redemptionRequests).toBe(1);
		expect(customerRequests).toEqual([]);
	});
	test("checks current authorization on later requests and never forwards reserved callback variants", async ({ page, context }) => {
		await page.goto(appOrigin + "/items?sort=new");
		await approve(page);
		const cookie = (await context.cookies(appOrigin)).find((value) => value.name === GATEWAY_SESSION_COOKIE);
		for (const path of ["/__smartdeploy/callback?code=bad&state=bad", "/%5f_smartdeploy/callback?code=bad&state=bad", "/__SMARTDEPLOY/callback"]) {
			expect((await page.goto(appOrigin + path))?.status()).toBeGreaterThanOrEqual(400);
		}
		expect(customerRequests).toEqual(["/items?sort=new"]);
		expect((await context.cookies(appOrigin)).find((value) => value.name === GATEWAY_SESSION_COOKIE)?.value).toBe(cookie?.value);
		revoked = true;
		expect((await page.goto(appOrigin + "/items?sort=new"))?.status()).toBe(403);
		expect(authorizationRequests).toBe(2);
		expect(customerRequests).toEqual(["/items?sort=new"]);
	});
});
