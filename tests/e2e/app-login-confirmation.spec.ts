import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer, request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { connect as tlsConnect } from "node:tls";
import { Client, Pool } from "pg";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { GatewayAuthenticatedHttp } from "../../src/lib/gateway/authenticatedHttp";
import { createGatewayHttpsServer } from "../../src/lib/gateway/nativeServer";
import { createWorkloadTlsListener, type WorkloadTlsListener } from "../../src/lib/workload-tls/tunnel";
import { gatewayCertificate } from "../helpers/gatewayCertificate";
import { GATEWAY_SESSION_COOKIE } from "../../src/lib/gateway/cookies";
import { createGatewayServiceCredential } from "../../src/lib/apps/gatewayServiceAuth";
import { WorkspaceStore } from "../../src/lib/apps/workspaceStore";
import { AppStore } from "../../src/lib/apps/appStore";
import type { GatewayFetch } from "../../src/lib/gateway/controlClient";

const PLATFORM = "https://localhost:34433";
const PUBLISHED = "https://app.localhost";
const PREVIEW = "https://preview.localhost";
type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
interface Account { id: string; email: string; cookies: Cookies }

test.describe("real app sign-in confirmation and gateway over local HTTPS", () => {
	test.skip(process.env.RUN_APP_LOGIN_BROWSER_TESTS !== "1", "Requires the explicit local database/Next/HTTPS fixture.");
	test.describe.configure({ mode: "serial" });
	let client: Client;
	let pool: Pool;
	let server: ReturnType<typeof createServer>;
	let application: ChildProcess;
	let approvals: ReturnType<typeof createHttpServer>;
	let certificateDirectory = "";
	let owner: Account;
	let member: Account;
	let outsider: Account;
	let appId: string;
	let bindingId: string;
	let workspaceId: string;
	let platformCookieReachedApp = false;
	let browserHeadersReachedMachineApi = false;
	let managementRequests = 0;
	const gateways = new Map<string, GatewayAuthenticatedHttp>();
	const upstreams: ReturnType<typeof createHttpServer>[] = [];
	const workloadListeners: WorkloadTlsListener[] = [];
	const upstreamCertificates: Awaited<ReturnType<typeof gatewayCertificate>>[] = [];
	let upstreamRequests = 0;
	let secretsReachedUpstream = false;
	const approved = new Set<string>();
	let workspaces: WorkspaceStore;
	let apps: AppStore;

	async function account(browser: Browser, email: string): Promise<Account> {
		const context = await browser.newContext({ baseURL: PLATFORM, ignoreHTTPSErrors: true });
		try {
			const response = await context.request.post("/api/auth/sign-up/email", { headers: { origin: PLATFORM }, data: { name: "Local Test account", email, password: "local-confirmation-test-password-123" } });
			expect(response.status()).toBe(200);
			const result = await client.query<{ id: string }>('update public."user" set "emailVerified" = true where email = $1 returning id', [email]);
			return { id: result.rows[0].id, email, cookies: await context.cookies() };
		} finally { await context.close(); }
	}
	test.beforeAll(async ({ browser }) => {
		const { databaseTestConnectionString } = await import("../database/helpers.mjs");
		const connectionString = databaseTestConnectionString();
		if (process.env.DATABASE_URL !== connectionString || process.env.BETTER_AUTH_URL !== PLATFORM || !process.env.BETTER_AUTH_SECRET
			|| process.env.WORKSPACE_APPS_ENABLED !== "true" || process.env.PRIVATE_APP_GATEWAY_ENABLED !== "true"
			|| process.env.WAITING_LIST_ENABLED !== "true" || process.env.SUPABASE_URL !== "http://127.0.0.1:45559"
			|| process.env.SUPABASE_SERVICE_ROLE_KEY !== "local-confirmation-approval-only") throw new Error("Exact disposable app-confirmation fixture configuration required.");
		client = new Client({ connectionString }); pool = new Pool({ connectionString, max: 2 }); await client.connect();
		workspaces = new WorkspaceStore(pool); apps = new AppStore(pool);
		approvals = createHttpServer((request, response) => {
			request.resume(); const url = new URL(request.url ?? "/", "http://127.0.0.1:45559");
			const email = url.searchParams.get("email")?.replace(/^eq\./, "");
			response.writeHead(url.pathname === "/rest/v1/approved_users" ? 200 : 404, { "Content-Type": "application/json" }).end(JSON.stringify(email && approved.has(email) ? [{ email }] : []));
		});
		await new Promise<void>((resolve, reject) => { approvals.once("error", reject); approvals.listen(45559, "127.0.0.1", resolve); });
		certificateDirectory = await mkdtemp(path.join(tmpdir(), "smartdeploy-confirmation-"));
		const keyPath = path.join(certificateDirectory, "key.pem"); const certPath = path.join(certificateDirectory, "cert.pem");
		const windowsOpenSSL = "C:/Program Files/Git/usr/bin/openssl.exe";
		const openssl = process.env.OPENSSL_PATH || (process.platform === "win32" && existsSync(windowsOpenSSL) ? windowsOpenSSL : "openssl");
		execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,DNS:app.localhost,DNS:preview.localhost", "-keyout", keyPath, "-out", certPath], { stdio: "ignore", windowsHide: true });
		const certificate = await readFile(certPath);
		// Keep Next outside Playwright's Babel hooks, which cannot transform its sectioned source maps.
		application = spawn(process.execPath, ["tests/e2e/app-login-server.mjs"], { windowsHide: true,
			env: { ...process.env, NODE_ENV: "production", APP_LOGIN_TEST_KEY: keyPath, APP_LOGIN_TEST_CERT: certPath }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
		application.stdout?.pipe(process.stdout, { end: false }); application.stderr?.pipe(process.stderr, { end: false });
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("Local Next HTTPS fixture startup deadline exceeded.")), 90000);
			application.once("error", (error) => { clearTimeout(timer); reject(error); });
			application.once("exit", () => { clearTimeout(timer); reject(new Error("Local Next HTTPS fixture exited before readiness.")); });
			application.once("message", (message: unknown) => { clearTimeout(timer); if (message && typeof message === "object" && "ready" in message && message.ready === true) resolve(); else reject(new Error("Unexpected local Next readiness.")); });
		});
		const transport: GatewayFetch = (url, init) => new Promise<Response>((resolve, reject) => {
			if (url.origin !== PLATFORM) { reject(new Error("Unexpected fixture destination")); return; }
			browserHeadersReachedMachineApi ||= ["cookie", "origin", "sec-fetch-site"].some((name) => new Headers(init.headers).has(name));
			const call = httpsRequest({ hostname: "127.0.0.1", port: 34433, servername: "localhost", ca: certificate, path: url.pathname, method: init.method,
				headers: { ...Object.fromEntries(new Headers(init.headers)), host: "localhost:34433" }, ...(init.signal ? { signal: init.signal } : {}) }, (incoming) => {
				const parts: Buffer[] = []; incoming.on("data", (chunk: Buffer) => parts.push(chunk)); incoming.on("error", reject);
				incoming.on("end", () => { const headers = new Headers(); for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
					const result = new Response(new Uint8Array(Buffer.concat(parts)), { status: incoming.statusCode ?? 503, headers }); Object.defineProperty(result, "url", { value: url.href }); resolve(result); });
			}); call.on("error", reject); call.end(String(init.body ?? ""));
		});
		owner = await account(browser, "confirmation-owner@example.test"); member = await account(browser, "confirmation-member@example.test"); outsider = await account(browser, "confirmation-outsider@example.test");
		approved.add(owner.email);
		workspaceId = (await workspaces.createWorkspace(owner.id, "Operations")).id;
		const invitation = await workspaces.createInvitation(workspaceId, owner.id, member.email, "member"); await workspaces.acceptInvitation(member.id, invitation.token);
		appId = (await apps.createApp(workspaceId, owner.id, "Inventory")).id; await apps.grantUse(appId, owner.id, member.id);
		for (const [origin, environment] of [[PUBLISHED, "published"], [PREVIEW, "preview"]]) {
			const binding = (await client.query<{ id: string }>("insert into public.app_gateway_bindings (app_id, origin, environment) values ($1, $2, $3) returning id", [appId, origin, environment])).rows[0].id;
			if (environment === "published") bindingId = binding;
			const key = createGatewayServiceCredential(); await client.query("insert into public.app_gateway_service_credentials (id, binding_id, secret_hash, expires_at) values ($1, $2, $3, clock_timestamp() + interval '1 hour')", [key.id, binding, key.secretHash]);
			const workload = { bindingId: binding, environment: environment === "published" ? "published" as const : "preview" as const, releaseId: randomUUID() };
			const material = await gatewayCertificate(workload); upstreamCertificates.push(material);
			const upstream = createHttpServer((incoming, outgoing) => {
				incoming.resume(); upstreamRequests++;
				const authorization = Boolean(incoming.headers.authorization);
				const platformCookie = (incoming.headers.cookie ?? "").includes("__Host-smartdeploy.session_token=");
				const gatewayCookie = (incoming.headers.cookie ?? "").includes(GATEWAY_SESSION_COOKIE + "=");
				secretsReachedUpstream ||= authorization || platformCookie || gatewayCookie;
				let identity: { id: string; email: string };
				try { identity = JSON.parse(Buffer.from(String(incoming.headers["x-smartdeploy-identity"]), "base64url").toString()); }
				catch { outgoing.writeHead(500).end("Missing verified fixture identity."); return; }
				if (incoming.url === "/echo") { let body = ""; incoming.on("data", (chunk: Buffer) => { body += chunk.toString(); }); incoming.once("end", () => outgoing.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ body, identity }))); return; }
				if (incoming.url === "/unsafe-cookie") { outgoing.writeHead(200, { "Set-Cookie": `${GATEWAY_SESSION_COOKIE}=evil; Path=/; Secure` }).end("must not reach browser"); return; }
				if (incoming.url === "/request-evidence") { outgoing.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ identity, bindingId: incoming.headers["x-smartdeploy-binding-id"], environment: incoming.headers["x-smartdeploy-environment"], authorization, platformCookie, gatewayCookie })); return; }
				outgoing.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>Private fixture</title><link rel="icon" href="data:,"><p>Private fixture: ${identity.email}</p>`);
			});
			upstreams.push(upstream); await new Promise<void>((resolve, reject) => { upstream.once("error", reject); upstream.listen(0, "127.0.0.1", resolve); });
			const address = upstream.address(); if (!address || typeof address === "string") throw new Error("Private upstream fixture unavailable.");
			const workloadListener = createWorkloadTlsListener({ ...workload, certificatePem: material.cert, privateKeyPem: material.key.toString(),
				appPort: address.port, tlsPort: 8443, maxConnections: 8, timeoutMs: 15000, idleMs: 5000, handshakeMs: 1000, shutdownMs: 1000,
				maxInboundBytes: 1024 * 1024, maxOutboundBytes: 1024 * 1024 });
			workloadListeners.push(workloadListener);
			await new Promise<void>((resolve, reject) => { workloadListener.server.once("error", reject); workloadListener.server.listen(0, "127.0.0.1", resolve); });
			const tlsAddress = workloadListener.server.address(); if (!tlsAddress || typeof tlsAddress === "string") throw new Error("Workload TLS fixture unavailable.");
			gateways.set(new URL(origin).host, new GatewayAuthenticatedHttp({
				browser: { appOrigin: origin, platformOrigin: PLATFORM, bindingId: binding, serviceCredential: key.token, timeoutMs: 5000, transactions: { ttlSeconds: 300, maxEntries: 100 } },
				context: { appOrigin: origin, bindingId: binding, environment: workload.environment },
				upstream: { ...workload, privateIp: "10.0.1.23", port: tlsAddress.port, certificatePem: material.cert, timeoutMs: 1000, maxConnections: 8 },
				limits: { maxRequestBytes: 65536, maxResponseBytes: 65536, timeoutMs: 10000, idleMs: 5000, maxConnections: 8 },
			}, transport, (configuration) => tlsConnect({ ...configuration, host: "127.0.0.1" })));
		}
		server = createGatewayHttpsServer({ key: await readFile(keyPath), cert: certificate,
			limits: { maxRequestBytes: 65536, maxResponseBytes: 65536, timeoutMs: 15000, idleMs: 5000, maxConnections: 16 },
			routes: [PUBLISHED, PREVIEW].map((origin) => {
				const gateway = gateways.get(new URL(origin).host); if (!gateway) throw new Error("Missing registered fixture runtime.");
				return { origin, close: () => gateway.close(), handle: (request) => {
					platformCookieReachedApp ||= (request.headers.get("cookie") ?? "").includes("__Host-smartdeploy.session_token="); return gateway.handle(request);
				} };
			}),
		});
		await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(34434, "127.0.0.1", resolve); });
	});
	test.beforeEach(async ({ page }) => { platformCookieReachedApp = false; browserHeadersReachedMachineApi = false; managementRequests = 0; upstreamRequests = 0; secretsReachedUpstream = false;
		page.on("request", (request) => { const pathname = new URL(request.url()).pathname; if (pathname === "/api/ws-token" || pathname === "/ws") managementRequests++; });
		await client.query("delete from public.app_gateway_codes; delete from public.app_gateway_sessions"); });
	test.afterAll(async () => {
		for (const gateway of gateways.values()) gateway.close();
		if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		for (const workloadListener of workloadListeners) await workloadListener.stop(0);
		for (const upstream of upstreams) await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
		for (const material of upstreamCertificates) await material.dispose();
		if (application && application.exitCode === null) {
			await new Promise<void>((resolve) => { const timer = setTimeout(() => application.kill(), 10000); application.once("exit", () => { clearTimeout(timer); resolve(); }); if (application.connected) application.send({ stop: true }); else application.kill(); });
		}
		if (approvals) await new Promise<void>((resolve, reject) => approvals.close((error) => error ? reject(error) : resolve()));
		await pool?.end(); await client?.end();
		if (certificateDirectory) { await unlink(path.join(certificateDirectory, "key.pem")).catch(() => {}); await unlink(path.join(certificateDirectory, "cert.pem")).catch(() => {}); await rmdir(certificateDirectory).catch(() => {}); }
	});
	async function visit(page: Page, context: BrowserContext, account: Account, origin = PUBLISHED): Promise<void> {
		await context.addCookies(account.cookies); await page.goto(origin + "/items?sort=new");
	}
	async function codes(): Promise<number> { return Number((await client.query("select count(*) from public.app_gateway_codes")).rows[0].count); }
	async function noAppCookie(context: BrowserContext): Promise<void> { expect((await context.cookies()).some((cookie) => cookie.name === GATEWAY_SESSION_COOKIE)).toBe(false); }

	test("shows only login before authentication and never issues from navigation", async ({ page }) => {
		await page.goto(PLATFORM + "/apps/authorize?" + new URLSearchParams({ bindingId, challenge: "c".repeat(43), state: "s".repeat(43) }));
		await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible(); expect(await codes()).toBe(0);
		await expect(page.getByText("Operations", { exact: true })).toHaveCount(0);
	});
	test("composes actual confirmation, signed platform session and machine redemption before creating an app cookie", async ({ page, context }) => {
		await visit(page, context, owner); await expect(page.getByRole("heading", { name: "Open Inventory?" })).toBeVisible();
		expect(await codes()).toBe(0); await expect(page.getByText(owner.email, { exact: true })).toBeVisible();
		const result = await page.request.get(page.url()); expect(result.headers()["x-frame-options"]).toBe("DENY"); expect(result.headers()["content-security-policy"]).toContain("frame-ancestors 'none'"); expect(result.headers()["referrer-policy"]).toBe("no-referrer"); expect(result.headers()["cache-control"]).toContain("no-store");
		await page.screenshot({ path: test.info().outputPath("confirmation-desktop.png"), fullPage: true });
		expect(managementRequests).toBe(0);
		await page.getByRole("button", { name: "Continue to app" }).click(); await expect(page).toHaveURL(PUBLISHED + "/items?sort=new");
		await expect(page.getByText("Private fixture: " + owner.email)).toBeVisible();
		const cookie = (await context.cookies(PUBLISHED)).find((value) => value.name === GATEWAY_SESSION_COOKIE); expect(cookie).toMatchObject({ secure: true, httpOnly: true, path: "/", sameSite: "Lax", domain: "app.localhost" });
		expect(await codes()).toBe(0); expect(platformCookieReachedApp).toBe(false); expect(browserHeadersReachedMachineApi).toBe(false);
	});
	test("allows an unapproved verified invitee only into the published app and renders on mobile", async ({ page, context }) => {
		await page.setViewportSize({ width: 390, height: 844 }); await visit(page, context, member);
		await expect(page.getByRole("button", { name: "Continue to app" })).toBeVisible(); await expect(page.getByText("Published app", { exact: true })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		expect(await page.evaluate(async () => (await fetch("/api/workspaces")).status)).toBe(403);
		await page.screenshot({ path: test.info().outputPath("confirmation-mobile.png"), fullPage: true });
		await page.getByRole("button", { name: "Continue to app" }).click(); await expect(page.getByText("Private fixture: " + member.email)).toBeVisible();
	});
	test("denies preview metadata and login to an ordinary app-use colleague", async ({ page, context }) => {
		await visit(page, context, member, PREVIEW); await expect(page.getByRole("heading", { name: "App sign-in unavailable" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Continue to app" })).toHaveCount(0); await expect(page.getByText("Operations", { exact: true })).toHaveCount(0); expect(await codes()).toBe(0); await noAppCookie(context);
	});
	test("denies an outsider without revealing application metadata", async ({ page, context }) => {
		await visit(page, context, outsider); await expect(page.getByRole("heading", { name: "App sign-in unavailable" })).toBeVisible();
		await expect(page.getByText("Operations", { exact: true })).toHaveCount(0); expect(await codes()).toBe(0); await noAppCookie(context);
	});
	test("requires a new confirmation after the platform account changes", async ({ page, context }) => {
		await visit(page, context, owner); await expect(page.getByRole("button", { name: "Continue to app" })).toBeVisible();
		await context.clearCookies(); await context.addCookies(member.cookies); await page.getByRole("button", { name: "Continue to app" }).click();
		await expect(page.getByRole("region", { name: "App sign-in confirmation" }).getByRole("alert")).toContainText("Refresh this page"); expect(await codes()).toBe(0); await noAppCookie(context);
	});
	test("rechecks a revoked app-use grant after the page was rendered", async ({ page, context }) => {
		await visit(page, context, member); await expect(page.getByRole("button", { name: "Continue to app" })).toBeVisible(); await apps.revokeUse(appId, owner.id, member.id);
		try { await page.getByRole("button", { name: "Continue to app" }).click(); await expect(page.getByRole("region", { name: "App sign-in confirmation" }).getByRole("alert")).toContainText("Refresh this page"); expect(await codes()).toBe(0); await noAppCookie(context); }
		finally { await apps.grantUse(appId, owner.id, member.id); }
	});
	test("rejects an intercepted malformed HTTP success without leaving confirmation", async ({ page, context }) => {
		await visit(page, context, owner); await expect(page.getByRole("button", { name: "Continue to app" })).toBeVisible();
		await page.route("**/api/apps/handoff", (route) => route.fulfill({ json: { code: "unconfirmed" } }));
		await page.getByRole("button", { name: "Continue to app" }).click(); await expect(page.getByRole("region", { name: "App sign-in confirmation" }).getByRole("alert")).toContainText("Refresh this page"); expect(await codes()).toBe(0); await noAppCookie(context);
	});
	test("allows an approved owner to confirm an unpublished preview", async ({ page, context }) => {
		await visit(page, context, owner, PREVIEW); await expect(page.getByText("Unpublished workspace preview", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Continue to app" }).click(); await expect(page).toHaveURL(PREVIEW + "/items?sort=new"); await expect(page.getByText("Private fixture: " + owner.email)).toBeVisible();
	});
	test("forwards verified context while keeping browser and gateway credentials out of the actual app", async ({ page, context }) => {
		await visit(page, context, member); await page.getByRole("button", { name: "Continue to app" }).click(); await expect(page).toHaveURL(PUBLISHED + "/items?sort=new");
		const result = await page.evaluate(async () => {
			const response = await fetch("/request-evidence", { headers: { Authorization: "Bearer fixture-browser-secret", "X-SmartDeploy-Identity": "spoof", "X-SmartDeploy-Environment": "preview" } });
			return { status: response.status, body: await response.json() };
		});
		expect(result.status).toBe(200); expect(result.body).toEqual({ identity: { id: member.id, email: member.email }, bindingId, environment: "published", authorization: false, platformCookie: false, gatewayCookie: false });
		expect(upstreamRequests).toBeGreaterThanOrEqual(2); expect(secretsReachedUpstream).toBe(false); expect(browserHeadersReachedMachineApi).toBe(false);
	});
	test("denies an existing app session immediately after its use grant is revoked", async ({ page, context }) => {
		await visit(page, context, member); await page.getByRole("button", { name: "Continue to app" }).click(); await expect(page).toHaveURL(PUBLISHED + "/items?sort=new");
		const before = upstreamRequests; await apps.revokeUse(appId, owner.id, member.id);
		try { expect(await page.evaluate(async () => (await fetch("/request-evidence")).status)).toBe(403); expect(upstreamRequests).toBe(before); }
		finally { await apps.grantUse(appId, owner.id, member.id); }
	});
	test("streams a same-origin upload through the native listener and verified app transport", async ({ page, context }) => {
		await visit(page, context, member); await page.getByRole("button", { name: "Continue to app" }).click(); await expect(page).toHaveURL(PUBLISHED + "/items?sort=new");
		const result = await page.evaluate(async () => { const response = await fetch("/echo", { method: "POST", headers: { "content-type": "text/plain" }, body: "fixture-upload" }); return { status: response.status, body: await response.json() }; });
		expect(result.status).toBe(200); expect(result.body).toEqual({ body: "fixture-upload", identity: { id: member.id, email: member.email } }); expect(secretsReachedUpstream).toBe(false);
	});
	test("delivers readable anonymous POST denial without forwarding input or cutting off the response", async ({ page, context }) => {
		await visit(page, context, member); await page.getByRole("button", { name: "Continue to app" }).click(); await expect(page).toHaveURL(PUBLISHED + "/items?sort=new");
		await context.clearCookies({ name: GATEWAY_SESSION_COOKIE }); const before = upstreamRequests;
		const result = await page.evaluate(async () => { const response = await fetch("/echo", { method: "POST", body: "must-not-forward" }); return { status: response.status, body: await response.json() }; });
		expect(result).toEqual({ status: 401, body: { error: "App access unavailable." } }); expect(upstreamRequests).toBe(before);
	});
	test("rejects a real app cookie overwrite while preserving the valid app session", async ({ page, context }) => {
		await visit(page, context, member); await page.getByRole("button", { name: "Continue to app" }).click(); await expect(page).toHaveURL(PUBLISHED + "/items?sort=new");
		const cookie = (await context.cookies()).find((value) => value.name === GATEWAY_SESSION_COOKIE)?.value;
		expect(await page.evaluate(async () => (await fetch("/unsafe-cookie")).status)).toBe(502);
		expect((await context.cookies()).find((value) => value.name === GATEWAY_SESSION_COOKIE)?.value).toBe(cookie);
		expect(await page.evaluate(async () => (await fetch("/request-evidence")).status)).toBe(200);
	});
	test("revokes both published and preview app sessions on platform sign-out", async ({ page, context }) => {
		for (const origin of [PUBLISHED, PREVIEW]) { await visit(page, context, owner, origin); await page.getByRole("button", { name: "Continue to app" }).click(); await expect(page).toHaveURL(origin + "/items?sort=new"); }
		expect(Number((await client.query("select count(*) from public.app_gateway_sessions")).rows[0].count)).toBe(2);
		await page.goto(PLATFORM + "/robots.txt"); expect(await page.evaluate(async () => (await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status)).toBe(200);
		expect(Number((await client.query("select count(*) from public.app_gateway_sessions")).rows[0].count)).toBe(0);
		for (const origin of [PUBLISHED, PREVIEW]) { const response = await page.goto(origin + "/items?sort=new"); expect(response?.status()).toBe(403); }
	});
});
