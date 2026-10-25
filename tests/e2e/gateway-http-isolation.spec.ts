import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { GatewayHttpError, GatewayHttpIsolation } from "../../src/lib/gateway/httpIsolation";
import { GATEWAY_SESSION_COOKIE } from "../../src/lib/gateway/cookies";
import { GATEWAY_LOGIN_COOKIE } from "../../src/lib/gateway/browserTransactions";

const IDENTITY = { id: "fixture-user", email: "fixture@example.test" };
const SESSION = "s".repeat(43);
test.describe("native browser HTTP isolation policy", () => {
	test.skip(process.env.RUN_GATEWAY_BROWSER_TESTS !== "1", "Requires explicit loopback HTTPS policy fixture.");
	test.describe.configure({ mode: "serial" });
	let server: ReturnType<typeof createServer>;
	let directory = "";
	let appOrigin: string;
	let otherOrigin: string;
	let platformOrigin: string;
	let policy: GatewayHttpIsolation;
	let fixtureSpki = "";
	let dataRequests = 0;
	let deniedWithSession = false;
	let forwardedAuthorization = false;
	let forwardedGatewayCookie = false;
	let forwardedIdentity = false;
	test.beforeAll(async () => {
		directory = await mkdtemp(path.join(tmpdir(), "smartdeploy-http-policy-"));
		const keyPath = path.join(directory, "key.pem"); const certPath = path.join(directory, "cert.pem");
		const windowsOpenSSL = "C:/Program Files/Git/usr/bin/openssl.exe";
		const openssl = process.env.OPENSSL_PATH || (process.platform === "win32" && existsSync(windowsOpenSSL) ? windowsOpenSSL : "openssl");
		execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=control.test", "-addext",
			"subjectAltName=DNS:control.test,DNS:app.control.test,DNS:other.control.test", "-keyout", keyPath, "-out", certPath], { stdio: "ignore", windowsHide: true });
		const certificate = await readFile(certPath);
		fixtureSpki = createHash("sha256").update(new X509Certificate(certificate).publicKey.export({ type: "spki", format: "der" })).digest("base64");
		server = createServer({ key: await readFile(keyPath), cert: certificate }, async (incoming, response) => {
			incoming.resume();
			const host = incoming.headers.host;
			if (host === new URL(platformOrigin).host) {
				response.setHeader("Set-Cookie", "__Host-smartdeploy.session_token=platform-fixture-only; Path=/; Secure; HttpOnly; SameSite=Lax");
				response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>Platform cookie fixture</title><link rel=\"icon\" href=\"data:,\">"); return;
			}
			if (host === new URL(otherOrigin).host) { response.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>Sibling fixture</title><link rel="icon" href="data:,"><a href="${appOrigin}/doc">Open app</a>`); return; }
			if (host !== new URL(appOrigin).host) { response.writeHead(403).end(); return; }
			const url = new URL(incoming.url ?? "/", appOrigin);
			// Trusted fixture seeding only; no identity provider or gateway authorization is simulated by this policy test.
			if (url.pathname === "/seed") {
				response.setHeader("Set-Cookie", [`${GATEWAY_SESSION_COOKIE}=${SESSION}; Path=/; Secure; HttpOnly; SameSite=Lax`, `${GATEWAY_LOGIN_COOKIE}=${"n".repeat(43)}; Path=/; Secure; HttpOnly; SameSite=Lax`]);
				response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>Seed fixture</title><link rel=\"icon\" href=\"data:,\">"); return;
			}
			try {
				const source = new Headers(); for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) source.set(name, Array.isArray(value) ? value.join(", ") : value);
				const request = new Request(url, { method: incoming.method, headers: source });
				const headers = policy.requestHeaders(request, IDENTITY);
				if (url.pathname === "/data" || url.pathname === "/submit") dataRequests++;
				forwardedAuthorization ||= headers.has("authorization"); forwardedGatewayCookie ||= (headers.get("cookie") ?? "").includes("smartdeploy");
				const identityMatches = headers.get("x-smartdeploy-identity") === Buffer.from(JSON.stringify(IDENTITY)).toString("base64url");
				forwardedIdentity ||= identityMatches;
				const upstream = new Headers({ "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-credentials": "true", "cache-control": "public, max-age=99999" });
				if (url.pathname === "/owned") upstream.append("set-cookie", "theme=dark");
				if (url.pathname === "/attack-gateway") upstream.append("set-cookie", `${GATEWAY_SESSION_COOKIE}=attacker; Path=/; Secure; HttpOnly`);
				if (url.pathname === "/attack-parent") upstream.append("set-cookie", "theme=attacker; Domain=control.test; Path=/");
				if (url.pathname === "/clear") upstream.set("clear-site-data", '"cookies", "storage"');
				let body = JSON.stringify({ authorization: headers.has("authorization"), gatewayCookie: (headers.get("cookie") ?? "").includes("smartdeploy"), identity: identityMatches, theme: headers.get("cookie") === "theme=dark" });
				if (url.pathname === "/doc") { upstream.set("content-type", "text/html"); body = '<!doctype html><title>App fixture</title><link rel="icon" href="data:,"><p>App policy document</p>'; }
				if (url.pathname === "/worker.js" || url.pathname === "/compute.js") { upstream.set("content-type", "text/javascript"); upstream.set("service-worker-allowed", "/"); body = url.pathname === "/worker.js" ? "self.addEventListener('fetch', () => {});" : "self.postMessage(42);"; }
				const filtered = policy.responseHeaders(upstream);
				for (const [name, value] of filtered) if (name !== "set-cookie") response.setHeader(name, value);
				const cookies = filtered.getSetCookie(); if (cookies.length) response.setHeader("Set-Cookie", cookies);
				response.writeHead(200).end(body);
			} catch (error) {
				deniedWithSession ||= (incoming.headers.cookie ?? "").includes(`${GATEWAY_SESSION_COOKIE}=${SESSION}`);
				response.writeHead(error instanceof GatewayHttpError ? error.status : 500, { "Content-Type": "text/plain", "Cache-Control": "no-store" }).end("Policy fixture denied.");
			}
		});
		await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
		const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture unavailable");
		platformOrigin = `https://control.test:${address.port}`; appOrigin = `https://app.control.test:${address.port}`; otherOrigin = `https://other.control.test:${address.port}`;
		policy = new GatewayHttpIsolation({ appOrigin, bindingId: "fa03e952-f705-42e2-9706-6a0b425de83d", environment: "published" });
	});
	test.beforeEach(() => { dataRequests = 0; deniedWithSession = false; forwardedAuthorization = false; forwardedGatewayCookie = false; forwardedIdentity = false; });
	test.afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		if (directory) { await unlink(path.join(directory, "key.pem")).catch(() => {}); await unlink(path.join(directory, "cert.pem")).catch(() => {}); await rmdir(directory).catch(() => {}); } });
	async function seed(page: Page): Promise<void> { await page.goto(platformOrigin); await page.goto(appOrigin + "/seed"); }

	test("keeps cookies and verified identity separate while dropping caller Authorization", async ({ page }) => {
		await seed(page); await page.goto(appOrigin + "/doc");
		const values = await page.evaluate(async () => {
			await fetch("/owned"); const response = await fetch("/data", { headers: { authorization: "Bearer explicit-app-token", "x-smartdeploy-identity": "spoofed" } });
			return { status: response.status, body: await response.json(), cors: response.headers.get("access-control-allow-origin") };
		});
		expect(values).toEqual({ status: 200, body: { authorization: false, gatewayCookie: false, identity: true, theme: true }, cors: null });
		expect(forwardedAuthorization).toBe(false); expect(forwardedGatewayCookie).toBe(false); expect(forwardedIdentity).toBe(true);
	});
	test("rejects sibling data reads carrying the user's app cookie before any customer data request", async ({ page }) => {
		await seed(page); await page.goto(otherOrigin);
		const response = page.waitForResponse(appOrigin + "/data");
		await page.evaluate(async (target) => { await fetch(target, { mode: "no-cors", credentials: "include" }); }, appOrigin + "/data");
		expect((await response).status()).toBe(403); expect(dataRequests).toBe(0); expect(deniedWithSession).toBe(true);
	});
	test("preserves Origin proof for ordinary same-origin form submissions", async ({ page }) => {
		await seed(page); await page.goto(appOrigin + "/doc"); const response = page.waitForResponse(appOrigin + "/submit");
		await page.evaluate(() => { const form = document.createElement("form"); form.method = "POST"; form.action = "/submit"; document.body.append(form); form.submit(); });
		const result = await response; expect(result.status()).toBe(200); expect(result.request().headers().origin).toBe(appOrigin); expect(dataRequests).toBe(1);
		await page.waitForURL(appOrigin + "/submit");
	});
	test("rejects sibling form writes with cookies but permits a deliberate top-level app link", async ({ page }) => {
		await seed(page); await page.goto(otherOrigin);
		const response = page.waitForResponse(appOrigin + "/submit");
		await page.evaluate((target) => { const form = document.createElement("form"); form.method = "POST"; form.action = target; document.body.append(form); form.submit(); }, appOrigin + "/submit");
		expect((await response).status()).toBe(403); expect(dataRequests).toBe(0); expect(deniedWithSession).toBe(true);
		await page.waitForURL(appOrigin + "/submit"); await page.waitForLoadState("load");
		await page.goto(otherOrigin); await page.getByRole("link", { name: "Open app" }).click(); await expect(page.getByText("App policy document")).toBeVisible();
	});
	test("blocks sibling framing of private app resources", async ({ page }) => {
		await seed(page); await page.goto(otherOrigin); const response = page.waitForResponse(appOrigin + "/data");
		await page.evaluate((target) => { const frame = document.createElement("iframe"); frame.src = target; document.body.append(frame); }, appOrigin + "/data");
		expect((await response).status()).toBe(403); expect(dataRequests).toBe(0); expect(deniedWithSession).toBe(true);
	});
	test("rejects customer cookie overwrites and parent scope while blocking site-wide clearing", async ({ page, context }) => {
		await seed(page); await page.goto(appOrigin + "/doc");
		for (const endpoint of ["/attack-gateway", "/attack-parent"]) expect(await page.evaluate(async (target) => (await fetch(target)).status, endpoint)).toBe(502);
		expect(await page.evaluate(async () => { const result = await fetch("/clear"); return result.headers.get("clear-site-data"); })).toBeNull();
		expect((await context.cookies(appOrigin)).find((cookie) => cookie.name === GATEWAY_SESSION_COOKIE)?.value).toBe(SESSION);
		expect((await context.cookies(platformOrigin)).some((cookie) => cookie.name === "__Host-smartdeploy.session_token")).toBe(true);
		expect((await context.cookies()).some((cookie) => cookie.domain === ".control.test")).toBe(false);
	});
	test("keeps service workers away from callback scope while preserving dedicated web workers", async ({ playwright }) => {
		// Service-worker fetches require browser trust beyond a page's TLS exception.
		const browser = await playwright.chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${fixtureSpki}`, "--no-proxy-server", "--host-resolver-rules=MAP control.test 127.0.0.1, MAP app.control.test 127.0.0.1"] });
		try {
		const page = await browser.newPage({ ignoreHTTPSErrors: false });
		await seed(page); await page.goto(appOrigin + "/doc");
		const result = await page.evaluate(async () => {
			let rootRejected = false;
			try { await navigator.serviceWorker.register("/worker.js", { scope: "/" }); } catch (error) { rootRejected = error instanceof DOMException && error.message.includes("allowed"); }
			const isolated = await navigator.serviceWorker.register("/worker.js", { scope: "/__smartdeploy/disabled-workers/" });
			const scope = new URL(isolated.scope).pathname; await isolated.unregister();
			const computed = await new Promise<number>((resolve, reject) => { const worker = new Worker("/compute.js"); worker.onmessage = (event: MessageEvent<number>) => { worker.terminate(); resolve(event.data); }; worker.onerror = reject; });
			return { rootRejected, scope, computed };
		});
		expect(result).toEqual({ rootRejected: true, scope: "/__smartdeploy/disabled-workers/", computed: 42 });
		} finally { await browser.close(); }
	});
});
