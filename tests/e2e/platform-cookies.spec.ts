import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:https";
import type { RequestListener } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, Pool } from "pg";
import { betterAuth } from "better-auth";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { getMigrations } from "better-auth/db/migration";
import { expect, test } from "@playwright/test";
import { platformAuthCookiePolicy } from "../../src/lib/authCookiePolicy";

test.describe("native browser platform cookie isolation", () => {
	test.skip(process.env.RUN_COOKIE_BROWSER_TESTS !== "1", "Requires the explicit local disposable database and HTTPS fixture.");
	let client: Client;
	let pool: Pool;
	let server: ReturnType<typeof createServer>;
	let certificateDirectory = "";
	let controlOrigin: string;
	let appOrigin: string;
	let legacyCookie = "";
	let currentIdentity: (headers: Headers) => Promise<string | null> = async () => null;
	let legacyIdentity: (headers: Headers) => Promise<string | null> = async () => null;
	let authHandler: RequestListener = (_request, response) => { response.writeHead(503).end(); };

	test.beforeAll(async () => {
		const { databaseTestConnectionString } = await import("../database/helpers.mjs");
		const connectionString = databaseTestConnectionString();
		if (process.env.DATABASE_URL !== connectionString || !process.env.BETTER_AUTH_SECRET) throw new Error("Explicit local cookie-test database/auth configuration required.");
		certificateDirectory = await mkdtemp(path.join(tmpdir(), "smartdeploy-cookies-"));
		const keyPath = path.join(certificateDirectory, "key.pem");
		const certPath = path.join(certificateDirectory, "cert.pem");
		const windowsOpenSSL = "C:/Program Files/Git/usr/bin/openssl.exe";
		const openssl = process.env.OPENSSL_PATH || (process.platform === "win32" && existsSync(windowsOpenSSL) ? windowsOpenSSL : "openssl");
		execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=control.test",
			"-addext", "subjectAltName=DNS:control.test,DNS:app.control.test", "-keyout", keyPath, "-out", certPath], { stdio: "ignore", windowsHide: true });
		server = createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, async (request, response) => {
			try {
				const host = request.headers.host?.split(":")[0];
				if (host === "app.control.test") {
					if (request.url === "/attack") {
						response.setHeader("Set-Cookie", [
							`${legacyCookie}; Domain=control.test; Path=/; Secure; HttpOnly; SameSite=Lax`,
							"__Host-smartdeploy.session_token=blocked-injection; Domain=control.test; Path=/; Secure; HttpOnly; SameSite=Lax",
						]);
					}
					response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ receivedPlatformCookie: (request.headers.cookie ?? "").includes("__Host-smartdeploy.session_token=") }));
					return;
				}
				if (host !== "control.test") { response.writeHead(403).end(); return; }
				if (request.url?.startsWith("/api/auth/")) { await authHandler(request, response); return; }
				if (request.url === "/identity" || request.url === "/legacy-identity") {
					const identity = request.url === "/identity" ? currentIdentity : legacyIdentity;
					response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ email: await identity(fromNodeHeaders(request.headers)) }));
					return;
				}
				response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>Local cookie fixture</title>");
			} catch { response.writeHead(500).end("Local fixture failed"); }
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const bound = server.address();
		if (!bound || typeof bound === "string") throw new Error("Local HTTPS fixture unavailable");
		controlOrigin = `https://control.test:${bound.port}`;
		appOrigin = `https://app.control.test:${bound.port}`;
		client = new Client({ connectionString });
		pool = new Pool({ connectionString, max: 2 });
		await client.connect();
		await client.query("drop schema public cascade; create schema public");
		const options = { database: pool, baseURL: controlOrigin, secret: process.env.BETTER_AUTH_SECRET, emailAndPassword: { enabled: true }, logger: { disabled: true } };
		await (await getMigrations(options)).runMigrations();
		const current = betterAuth({ ...options, advanced: platformAuthCookiePolicy(controlOrigin) });
		const legacy = betterAuth(options);
		await Promise.all([current.$context, legacy.$context]);
		authHandler = toNodeHandler(current);
		currentIdentity = async (headers) => (await current.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } }))?.user.email ?? null;
		legacyIdentity = async (headers) => (await legacy.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } }))?.user.email ?? null;
		const attacker = await legacy.handler(new Request(`${controlOrigin}/api/auth/sign-up/email`, { method: "POST",
			headers: { origin: controlOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Local attacker", email: "attacker@example.test", password: "local-cookie-test-password-123" }) }));
		expect(attacker.status).toBe(200);
		const signed = attacker.headers.getSetCookie().find((cookie) => cookie.startsWith("__Secure-better-auth.session_token="));
		if (!signed) throw new Error("Legacy cookie fixture unavailable");
		legacyCookie = signed.split(";")[0];
		await client.query('update public."user" set "emailVerified" = true where email = \'attacker@example.test\'');
	});
	test.afterAll(async () => {
		if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		await pool?.end();
		await client?.end();
		if (certificateDirectory) {
			// Remove only these two generated files, never recursively delete a computed path.
			await unlink(path.join(certificateDirectory, "key.pem")).catch(() => {});
			await unlink(path.join(certificateDirectory, "cert.pem")).catch(() => {});
			await rmdir(certificateDirectory).catch(() => {});
		}
	});

	test("rejects sibling cookie injection and legacy fallback while retaining the real platform login", async ({ page, context }) => {
		await page.goto(`${appOrigin}/attack`);
		await page.goto(controlOrigin);
		const legacyResult = await page.evaluate(async () => (await fetch("/legacy-identity")).json());
		expect(legacyResult).toEqual({ email: "attacker@example.test" });
		expect(await page.evaluate(async () => (await fetch("/identity")).json())).toEqual({ email: null });
		const signup = await page.evaluate(async () => (await fetch("/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Local victim", email: "victim@example.test", password: "local-cookie-test-password-123" }) })).status);
		expect(signup).toBe(200);
		await client.query('update public."user" set "emailVerified" = true where email = \'victim@example.test\'');
		const cookie = (await context.cookies(controlOrigin)).find((entry) => entry.name === "__Host-smartdeploy.session_token");
		expect(cookie).toMatchObject({ domain: "control.test", path: "/", secure: true, httpOnly: true });
		await page.goto(`${appOrigin}/attack`);
		expect(await page.locator("body").textContent()).toContain('"receivedPlatformCookie":false');
		await page.goto(controlOrigin);
		expect(await page.evaluate(async () => (await fetch("/identity")).json())).toEqual({ email: "victim@example.test" });
		expect((await context.cookies(controlOrigin)).find((entry) => entry.name === "__Host-smartdeploy.session_token")?.value).toBe(cookie?.value);
		const signout = await page.evaluate(async () => (await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status);
		expect(signout).toBe(200);
		expect((await context.cookies(controlOrigin)).some((entry) => entry.name === "__Host-smartdeploy.session_token")).toBe(false);
		expect(await page.evaluate(async () => (await fetch("/identity")).json())).toEqual({ email: null });
	});
});
