import { once } from "node:events";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import type { Duplex } from "node:stream";
import { connect } from "node:tls";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createGatewayHttpsServer } from "@/lib/gateway/nativeServer";
import type { GatewayHttpLimits } from "@/lib/gateway/httpLease";
import { gatewayWorkloadServerName } from "@/lib/gateway/upstreamTls";
import { gatewayCertificate } from "../../helpers/gatewayCertificate";

const WORKLOAD = { bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac", environment: "published" as const, releaseId: "997a2326-5b9b-4c08-aaef-45c618db01d3" };
const LIMITS: GatewayHttpLimits = { maxRequestBytes: 64, maxResponseBytes: 1024, timeoutMs: 1500, idleMs: 1000, maxConnections: 8 };
let certificate: Awaited<ReturnType<typeof gatewayCertificate>>;
const servers: ReturnType<typeof createGatewayHttpsServer>[] = []; const sockets = new Set<Duplex>();
beforeAll(async () => { certificate = await gatewayCertificate(WORKLOAD); });
afterEach(async () => { for (const socket of sockets) socket.destroy(); await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))); });
afterAll(async () => { await certificate.dispose(); });

async function fixture(handler: (request: Request) => Promise<Response>, overrides: Partial<GatewayHttpLimits> = {}) {
	const handle = vi.fn(handler); const closed = vi.fn();
	const server = createGatewayHttpsServer({ key: certificate.key, cert: certificate.cert, routes: [{ origin: "https://app.test", handle, close: closed }], limits: { ...LIMITS, ...overrides } });
	servers.push(server); server.on("connection", (socket) => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); });
	server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address unavailable.");
	const options: RequestOptions = { hostname: "127.0.0.1", port: address.port, servername: gatewayWorkloadServerName(WORKLOAD), ca: certificate.cert, rejectUnauthorized: true, agent: false };
	const query = (init: RequestOptions = {}, payload = "", headersOnly = false) => new Promise<{ status: number; body: string; headers: IncomingHttpHeaders; continued: boolean }>((resolve, reject) => {
		let continued = false;
		const call = httpsRequest({ ...options, ...init, headers: { host: "app.test", ...init.headers } }, (response) => {
			const chunks: Buffer[] = []; response.on("data", (chunk: Buffer) => chunks.push(chunk)); response.on("error", reject);
			response.once("end", () => { resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: response.headers, continued }); call.destroy(); });
		}); call.on("continue", () => { continued = true; }); call.on("error", reject); if (headersOnly) call.flushHeaders(); else call.end(payload);
	});
	const raw = (packet: string) => new Promise<string>((resolve, reject) => {
		let output = ""; const socket = connect({ host: "127.0.0.1", port: address.port, servername: gatewayWorkloadServerName(WORKLOAD), ca: certificate.cert, rejectUnauthorized: true });
		socket.once("secureConnect", () => { socket.removeListener("error", reject); socket.on("error", () => {}); socket.write(packet); });
		socket.once("error", reject); socket.on("data", (chunk) => { output += chunk.toString(); }); socket.once("close", () => resolve(output));
	});
	return { server, handle, closed, options, query, raw };
}

describe("native HTTPS gateway bridge", () => {
	it("preserves streamed input and trusted public URL without forwarded-host authority", async () => {
		const { query } = await fixture(async (request) => Response.json({ url: request.url, body: await request.text() }));
		const response = await query({ method: "POST", path: "/echo?q=new", headers: { "content-length": "5", "x-forwarded-host": "evil.test", "x-forwarded-proto": "http" } }, "hello");
		expect(response.status).toBe(200); expect(JSON.parse(response.body)).toEqual({ url: "https://app.test/echo?q=new", body: "hello" }); expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.headers.connection).toBe("close");
	});
	it("delivers the full early denial after cancelling unread input", async () => {
		const { query } = await fixture(async (request) => { await request.body?.cancel(); return new Response("denied-completely", { status: 401 }); });
		const response = await query({ method: "POST", headers: { "content-length": "10" } }, "", true);
		expect(response.status).toBe(401); expect(response.body).toBe("denied-completely");
	});
	it("rejects a known oversized upload before handler and still delivers 413", async () => {
		const { query, handle } = await fixture(async () => new Response("unreachable"));
		const response = await query({ method: "POST", headers: { "content-length": "65" } }, "", true);
		expect(response.status).toBe(413); expect(JSON.parse(response.body)).toEqual({ error: "App access unavailable." }); expect(handle).not.toHaveBeenCalled();
	});
	it("stops an undeclared upload at the bridge cap and delivers its error", async () => {
		const { query } = await fixture(async (request) => new Response(await request.text()));
		const response = await query({ method: "POST" }, "x".repeat(65)); expect(response.status).toBe(413); expect(response.body).toContain("App access unavailable.");
	});
	it.each(["absolute", "slash", "backslash", "get-body", "method"])("rejects %s input before handler", async (kind) => {
		const { raw, handle } = await fixture(async () => new Response("unreachable"));
		const line = kind === "absolute" ? "GET https://evil.test/ HTTP/1.1" : kind === "slash" ? "GET //evil.test/ HTTP/1.1" : kind === "backslash" ? "GET /back\\slash HTTP/1.1" : kind === "method" ? "TRACE / HTTP/1.1" : "GET / HTTP/1.1";
		const response = await raw(line + "\r\nHost: app.test\r\n" + (kind === "get-body" ? "Content-Length: 1\r\n" : "") + "\r\n");
		expect(response).toMatch(/^HTTP\/1\.1 400/); expect(handle).not.toHaveBeenCalled();
	});
	it.each(["host", "cookie", "framing", "fields", "bytes"])("rejects duplicate/oversized %s headers", async (kind) => {
		const { raw, handle } = await fixture(async () => new Response("unreachable"));
		const extra = kind === "host" ? "Host: other.test\r\n" : kind === "cookie" ? "Cookie: a=1\r\nCookie: a=2\r\n" : kind === "framing" ? "Content-Length: 1\r\nTransfer-Encoding: chunked\r\n" : kind === "fields" ? Array.from({ length: 129 }, (_, index) => `x-fixture-${index}: a\r\n`).join("") : "x-oversized: " + "x".repeat(16384) + "\r\n";
		const response = await raw("GET / HTTP/1.1\r\nHost: app.test\r\n" + extra + "\r\n"); expect(response).toMatch(/^HTTP\/1\.1 400/); expect(response.toLowerCase()).toContain("cache-control: private, no-store"); expect(handle).not.toHaveBeenCalled();
	});
	it("rejects unknown hosts without selecting a default tenant", async () => {
		const { query, handle } = await fixture(async () => new Response("unreachable"));
		expect((await query({ headers: { host: "other.test" } })).status).toBe(403); expect(handle).not.toHaveBeenCalled();
	});
	it("rejects Expect without sending 100 Continue or reading the body", async () => {
		const { query, handle } = await fixture(async () => new Response("unreachable"));
		const response = await query({ method: "POST", headers: { Expect: "100-continue", "content-length": "10" } }, "", true);
		expect(response.status).toBe(400); expect(response.continued).toBe(false); expect(handle).not.toHaveBeenCalled();
	});
	it.each(["CONNECT app.test:443", "GET /"])("closes unsupported tunnel/upgrade %s", async (line) => {
		const { raw, handle } = await fixture(async () => new Response("unreachable"));
		await raw(line + " HTTP/1.1\r\nHost: app.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"); expect(handle).not.toHaveBeenCalled();
	});
	it("delivers a private deadline failure while cancelling an unfinished handler", async () => {
		let aborted = false;
		const { query } = await fixture(async (request) => { request.signal.addEventListener("abort", () => { aborted = true; }); return new Promise<Response>(() => {}); }, { timeoutMs: 100 });
		const response = await query(); expect(response.status).toBe(504); expect(response.body).toContain("App access unavailable."); expect(aborted).toBe(true);
	});
	it("streams a prefix before completion and preserves separate protected cookies", async () => {
		let finish = () => {};
		const { options } = await fixture(async () => {
			const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("first")); finish = () => { controller.enqueue(new TextEncoder().encode("last")); controller.close(); }; } });
			const headers = new Headers(); headers.append("set-cookie", "__Host-smartdeploy-app-session=fixture; Path=/; Secure; HttpOnly"); headers.append("set-cookie", "theme=dark; Path=/; Secure"); return new Response(body, { headers });
		});
		let prefix = ""; let headers: IncomingHttpHeaders = {};
		let first = () => {}; const arrived = new Promise<void>((resolve) => { first = resolve; });
		const completed = new Promise<void>((resolve, reject) => { const call = httpsRequest({ ...options, headers: { host: "app.test" } }, (response) => { headers = response.headers; response.on("data", (chunk) => { prefix += chunk.toString(); first(); }); response.once("end", resolve); response.on("error", reject); }); call.on("error", reject); call.end(); });
		await arrived; expect(prefix).toBe("first"); expect(headers["set-cookie"]).toHaveLength(2); finish(); await completed; expect(prefix).toBe("firstlast");
	});
	it("aborts a late body failure without appending a second HTTP response", async () => {
		const { raw } = await fixture(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("first")); } })), { idleMs: 100 });
		const result = await raw("GET / HTTP/1.1\r\nHost: app.test\r\n\r\n"); expect(result).toContain("first"); expect(result.match(/HTTP\/1\.1 \d{3}/g)).toEqual(["HTTP/1.1 200"]); expect(result).not.toContain("App access unavailable.");
	});
	it("cancels the web response and request signal when the client disconnects", async () => {
		let cancelled = false; let aborted = false;
		const { options } = await fixture(async (request) => { request.signal.addEventListener("abort", () => { aborted = true; }); return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("first")); }, cancel() { cancelled = true; } })); });
		await new Promise<void>((resolve, reject) => { const call = httpsRequest({ ...options, headers: { host: "app.test" } }, (response) => { response.once("data", () => { response.destroy(); call.destroy(); resolve(); }); response.on("error", () => {}); }); call.on("error", reject); call.end(); });
		await vi.waitFor(() => { expect(cancelled).toBe(true); expect(aborted).toBe(true); });
	});
});
