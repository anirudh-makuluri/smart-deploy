import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { GatewayBrowserDocuments } from "../../src/lib/gateway/browserDocuments";
import { type GatewayFetch } from "../../src/lib/gateway/controlClient";
import { GATEWAY_SESSION_COOKIE } from "../../src/lib/gateway/cookies";
import { createGatewayHttpsServer } from "../../src/lib/gateway/nativeServer";
import { gatewayCertificate } from "../helpers/gatewayCertificate";

const TOKEN = "t".repeat(43);
const BINDING = "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac";
const CREDENTIAL = "sd_gateway_91843492-f2ea-437c-a540-b144c3bc8ed2." + "s".repeat(43);
const OPERATION = { action: "get", collection: "notes", id: "shared" };
interface Document { collection: string; id: string; version: string; json: string }

test.describe("native browser document broker", () => {
	test.skip(process.env.RUN_GATEWAY_BROWSER_TESTS !== "1", "Requires explicit loopback fixture opt-in.");
	test.describe.configure({ mode: "serial" });
	let material: Awaited<ReturnType<typeof gatewayCertificate>>;
	let server: ReturnType<typeof createGatewayHttpsServer>;
	let appOrigin = "";
	let siblingOrigin = "";
	let broker: GatewayBrowserDocuments;
	let stored: Document | null = null;
	let revoked = false;
	let calls = 0;
	let browserCredentialsForwarded = false;
	let documentCookieReceived = false;
	const transport: GatewayFetch = async (url, init) => {
		calls++;
		const headers = new Headers(init.headers);
		browserCredentialsForwarded ||= headers.has("cookie") || headers.has("origin") || headers.has("sec-fetch-site");
		if (url.href !== "https://control.test/api/gateway/documents" || headers.get("authorization") !== `Bearer ${CREDENTIAL}` || headers.get("x-smartdeploy-binding-id") !== BINDING) return Response.json({}, { status: 401 });
		const body: { action: string; token: string; collection: string; id: string; json: string; expectedVersion: string | null } = JSON.parse(String(init.body));
		// Explicit in-memory control fixture: no SQL, IAM, DynamoDB or identity-provider proof.
		if (revoked || body.token !== TOKEN) return Response.json({ error: "fixture revoked" }, { status: 403 });
		if (body.action === "get") return Response.json({ document: stored });
		if (body.expectedVersion !== (stored?.version ?? null)) return Response.json({}, { status: 409 });
		if (body.action === "remove") { stored = null; return Response.json({ deleted: true }); }
		stored = { collection: body.collection, id: body.id, json: JSON.stringify(JSON.parse(body.json)), version: randomUUID() };
		return Response.json({ document: stored });
	};
	test.beforeAll(async () => {
		material = await gatewayCertificate({ bindingId: BINDING, environment: "published", releaseId: "997a2326-5b9b-4c08-aaef-45c618db01d3" });
		// Reserve a loopback ephemeral port before constructing canonical route origins.
		const { createServer } = await import("node:net"); const reservation = createServer();
		await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
		const address = reservation.address(); if (!address || typeof address === "string") throw new Error("Fixture port unavailable.");
		appOrigin = `https://app.control.test:${address.port}`; siblingOrigin = `https://other.control.test:${address.port}`;
		await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
		broker = new GatewayBrowserDocuments({ appOrigin, bindingId: BINDING, environment: "published" },
			{ platformOrigin: "https://control.test", bindingId: BINDING, serviceCredential: CREDENTIAL, timeoutMs: 1000 }, transport);
		server = createGatewayHttpsServer({ key: material.key, cert: material.cert,
			limits: { maxConnections: 8, maxRequestBytes: 32768, maxResponseBytes: 32768, timeoutMs: 5000, idleMs: 2000 },
			routes: [{ origin: appOrigin, close: () => broker.close(), handle: async request => {
				if (new URL(request.url).pathname === "/__smartdeploy/documents") documentCookieReceived ||= request.headers.get("cookie")?.includes(`${GATEWAY_SESSION_COOKIE}=${TOKEN}`) === true;
				const result = await broker.handle(request); if (result) return result;
				return new Response('<!doctype html><title>Document broker fixture</title><link rel="icon" href="data:,"><p>Local broker browser fixture</p>', { headers: { "content-type": "text/html" } });
			} }, { origin: siblingOrigin, close: () => {}, handle: async () => new Response('<!doctype html><title>Sibling fixture</title><link rel="icon" href="data:,">', { headers: { "content-type": "text/html" } }) }] });
		await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(address.port, "127.0.0.1", resolve); });
	});
	test.beforeEach(() => { calls = 0; stored = null; revoked = false; browserCredentialsForwarded = false; documentCookieReceived = false; });
	test.afterAll(async () => { if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); if (material) await material.dispose(); });

	test("uses an HttpOnly session for save/read/conflict/delete without exposing machine credentials", async ({ page, context }) => {
		await context.addCookies([{ name: GATEWAY_SESSION_COOKIE, value: TOKEN, url: appOrigin, httpOnly: true, secure: true, sameSite: "Lax" }]);
		const browserRequests: string[] = []; page.on("request", request => browserRequests.push(JSON.stringify({ url: request.url(), headers: request.headers(), body: request.postData() })));
		await page.goto(appOrigin);
		const result = await page.evaluate(async operation => {
			const send = async (body: object) => { const result = await fetch("/__smartdeploy/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: result.status, value: await result.json(), cache: result.headers.get("cache-control") }; };
			const initial = await send(operation);
			const write = await send({ ...operation, action: "put", json: '{"text":"saved"}', expectedVersion: null });
			const read = await send(operation);
			const conflict = await send({ ...operation, action: "put", json: "{}", expectedVersion: null });
			const remove = await send({ ...operation, action: "remove", expectedVersion: write.value.document.version });
			return { cookie: document.cookie, initial, write, read, conflict, remove };
		}, OPERATION);
		expect(result.cookie).not.toContain(TOKEN); expect(result.initial.value).toEqual({ document: null });
		expect(result.write.status).toBe(200); expect(result.read.value).toEqual(result.write.value); expect(result.read.cache).toBe("private, no-store");
		expect(result.conflict.status).toBe(409); expect(result.remove.value).toEqual({ deleted: true });
		expect(calls).toBe(5); expect(browserCredentialsForwarded).toBe(false); expect(browserRequests.join("\n")).not.toContain(CREDENTIAL);
	});
	test("rejects anonymous requests and rechecks revocation with the same browser cookie", async ({ page, context }) => {
		await page.goto(appOrigin);
		const send = () => page.evaluate(async body => (await fetch("/__smartdeploy/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, OPERATION);
		expect(await send()).toBe(401); expect(calls).toBe(0);
		await context.addCookies([{ name: GATEWAY_SESSION_COOKIE, value: TOKEN, url: appOrigin, httpOnly: true, secure: true, sameSite: "Lax" }]);
		expect(await send()).toBe(200); revoked = true; expect(await send()).toBe(403); expect(calls).toBe(2);
	});
	test("rejects sibling-origin browser requests even when the browser carries the app cookie", async ({ page, context }) => {
		await context.addCookies([{ name: GATEWAY_SESSION_COOKIE, value: TOKEN, url: appOrigin, httpOnly: true, secure: true, sameSite: "Lax" }]);
		await page.goto(siblingOrigin);
		const response = page.waitForResponse(appOrigin + "/__smartdeploy/documents");
		await page.evaluate(target => { const form = document.createElement("form"); form.action = target; form.method = "POST"; document.body.append(form); form.submit(); }, appOrigin + "/__smartdeploy/documents");
		expect((await response).status()).toBe(403); expect(documentCookieReceived).toBe(true); expect(calls).toBe(0);
	});
});
