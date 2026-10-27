import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import { connect, type ConnectionOptions } from "node:tls";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GatewayHttpProxy, type GatewayHttpProxyOptions } from "@/lib/gateway/httpProxy";
import { gatewayWorkloadServerName } from "@/lib/gateway/upstreamTls";
import { GATEWAY_SESSION_COOKIE } from "@/lib/gateway/cookies";

const ORIGIN = "https://app.control.test";
const IDENTITY = { id: "fixture-user", email: "fixture@example.test" };
const WORKLOAD = { bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac", environment: "published" as const, releaseId: "997a2326-5b9b-4c08-aaef-45c618db01d3" };
let directory = ""; let certificate = ""; let wrongCertificate = ""; let key: Buffer;
const files: string[] = []; const servers: Server[] = []; const sockets = new Set<Duplex>(); const proxies: GatewayHttpProxy[] = [];
function options(port = 443): GatewayHttpProxyOptions {
	return { context: { appOrigin: ORIGIN, bindingId: WORKLOAD.bindingId, environment: "published" },
		upstream: { ...WORKLOAD, privateIp: "10.0.1.23", port, certificatePem: certificate, timeoutMs: 1000, maxConnections: 2 },
		limits: { maxRequestBytes: 64, maxResponseBytes: 1024, timeoutMs: 1500, idleMs: 1000, maxConnections: 1 } };
}
async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void, overrides: Partial<GatewayHttpProxyOptions["limits"]> = {}, peerCertificate: () => string = () => certificate) {
	let count = 0;
	const server = createServer({ key, cert: peerCertificate(), minVersion: "TLSv1.3", ALPNProtocols: ["http/1.1"] }, (request, response) => {
		count++; request.on("error", () => {}); response.on("error", () => {}); handler(request, response);
	});
	servers.push(server); server.on("tlsClientError", () => {});
	server.on("connection", (socket) => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); });
	server.listen(0, "127.0.0.1"); await once(server, "listening");
	const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address unavailable.");
	const configuration = options(address.port); Object.assign(configuration.limits, overrides);
	const dial = vi.fn((input: ConnectionOptions) => { const socket = connect({ ...input, host: "127.0.0.1" }); sockets.add(socket); socket.once("close", () => sockets.delete(socket)); return socket; });
	const proxy = new GatewayHttpProxy(configuration, dial); proxies.push(proxy);
	return { proxy, dial, count: () => count, configuration };
}
function input(route = "/", init: RequestInit = {}) {
	const headers = new Headers(init.headers); if (!headers.has("sec-fetch-site")) headers.set("sec-fetch-site", "same-origin");
	return new Request(ORIGIN + route, { ...init, headers });
}
function streaming(body: ReadableStream<Uint8Array>, headers: HeadersInit = {}): Request {
	const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half", headers: { origin: ORIGIN, ...Object.fromEntries(new Headers(headers)) } };
	return input("/upload", init);
}
beforeAll(async () => {
	directory = await mkdtemp(path.join(tmpdir(), "smartdeploy-http-proxy-"));
	const named = (name: string) => { const value = path.join(directory, name); files.push(value); return value; };
	const config = named("openssl.cnf"); const keyPath = named("key.pem"); const certPath = named("cert.pem");
	await writeFile(config, "[req]\ndistinguished_name=dn\n[dn]\n");
	const windows = "C:/Program Files/Git/usr/bin/openssl.exe";
	const openssl = process.env.OPENSSL_PATH || (process.platform === "win32" && existsSync(windows) ? windows : "openssl");
	execFileSync(openssl, ["req", "-config", config, "-x509", "-sha256", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1", "-subj", "/CN=http-fixture", "-addext", `subjectAltName=DNS:${gatewayWorkloadServerName(WORKLOAD)}`, "-addext", "basicConstraints=critical,CA:TRUE", "-keyout", keyPath, "-out", certPath], { stdio: "ignore", windowsHide: true });
	key = await readFile(keyPath); certificate = await readFile(certPath, "utf8");
	const wrongPath = named("wrong.pem");
	execFileSync(openssl, ["req", "-config", config, "-x509", "-sha256", "-key", keyPath, "-days", "1", "-subj", "/CN=other-workload", "-addext", "subjectAltName=DNS:other.gateway.invalid", "-out", wrongPath], { stdio: "ignore", windowsHide: true });
	wrongCertificate = await readFile(wrongPath, "utf8");
});
afterEach(async () => {
	for (const proxy of proxies.splice(0)) proxy.close(); for (const socket of sockets) socket.destroy();
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});
afterAll(async () => { for (const value of files) if (existsSync(value)) await unlink(value); if (directory) await rmdir(directory); });

describe("bounded fixed-workload HTTP forwarding", () => {
	it("forwards exact path/query and verified context over TLS, with isolated request and response headers", async () => {
		let received: IncomingMessage["headers"] = {}; let route = "";
		const { proxy } = await fixture((request, response) => { received = request.headers; route = request.url ?? ""; request.resume(); response.writeHead(200, { "Content-Type": "text/plain", "Set-Cookie": "theme=dark", "Access-Control-Allow-Origin": "*", "Cache-Control": "public" }).end("hello"); });
		const response = await proxy.forward(input("/hello?q=a%20b", { headers: { authorization: "Bearer private-platform-secret", cookie: `${GATEWAY_SESSION_COOKIE}=${"s".repeat(43)}; theme=light`, "x-smartdeploy-identity": "spoof", "x-forwarded-host": "evil.test" } }), IDENTITY);
		expect(response.status).toBe(200); expect(await response.text()).toBe("hello"); expect(route).toBe("/hello?q=a%20b");
		expect(received.authorization).toBeUndefined(); expect(received.cookie).toBe("theme=light"); expect(received.host).toBe("app.control.test");
		expect(JSON.parse(Buffer.from(received["x-smartdeploy-identity"] as string, "base64url").toString())).toEqual(IDENTITY);
		expect(received["x-smartdeploy-binding-id"]).toBe(WORKLOAD.bindingId); expect(received["x-smartdeploy-environment"]).toBe("published");
		expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.has("access-control-allow-origin")).toBe(false);
		expect(response.headers.getSetCookie()).toEqual(["theme=dark; Secure; Path=/; SameSite=Lax"]);
	});
	it.each(["origin", "reserved", "identity", "authority"])("rejects invalid %s before TLS or HTTP", async (kind) => {
		const { proxy, dial } = await fixture((_request, response) => response.end("unreachable"));
		const request = kind === "reserved" ? input("/%5f%5fsmartdeploy/callback") : kind === "origin" ? input("/", { headers: { "sec-fetch-site": "same-site", origin: "https://other.control.test" } }) : kind === "authority" ? input("/", { headers: { host: "other.control.test" } }) : input();
		await expect(proxy.forward(request, kind === "identity" ? { id: "", email: "" } : IDENTITY)).rejects.toMatchObject({ status: kind === "reserved" ? 400 : 403 }); expect(dial).not.toHaveBeenCalled();
	});
	it.each(["length", "negative", "ambiguous"])("rejects %s upload headers before dialing", async (kind) => {
		const { proxy, dial } = await fixture((_request, response) => response.end());
		const headers = new Headers({ origin: ORIGIN, "content-length": kind === "length" ? "65" : kind === "negative" ? "-1" : "1" }); if (kind === "ambiguous") headers.set("transfer-encoding", "chunked");
		await expect(proxy.forward(input("/", { method: "POST", body: "x", headers }), IDENTITY)).rejects.toMatchObject({ status: kind === "length" ? 413 : 400 }); expect(dial).not.toHaveBeenCalled();
	});
	it("streams a bounded upload without forwarding caller framing", async () => {
		let framing = ""; let declared: string | undefined;
		const { proxy } = await fixture((request, response) => { let body = ""; framing = request.headers["transfer-encoding"] ?? ""; declared = request.headers["content-length"]; request.on("data", (chunk) => { body += chunk.toString(); }); request.on("end", () => response.end(body)); });
		const response = await proxy.forward(input("/", { method: "POST", body: "hello", headers: { origin: ORIGIN, "content-length": "5" } }), IDENTITY);
		expect(await response.text()).toBe("hello"); expect(framing).toBe("chunked"); expect(declared).toBeUndefined();
	});
	it("stops an undeclared upload before sending bytes past its cap", async () => {
		let received = 0;
		const { proxy } = await fixture((request) => request.on("data", (chunk) => { received += chunk.length; }), { maxRequestBytes: 5 });
		const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("abcd")); controller.enqueue(new TextEncoder().encode("efgh")); controller.close(); } });
		await expect(proxy.forward(streaming(body), IDENTITY)).rejects.toMatchObject({ status: 413 }); expect(received).toBeLessThanOrEqual(5);
	});
	it.each(["short", "long"])("rejects a %s declared upload", async (kind) => {
		const { proxy } = await fixture((request) => request.resume());
		await expect(proxy.forward(input("/", { method: "POST", body: kind === "short" ? "x" : "xxx", headers: { origin: ORIGIN, "content-length": "2" } }), IDENTITY)).rejects.toMatchObject({ status: 400 });
	});
	it.each(["cookie", "size", "fields", "header-bytes", "status"])("rejects invalid response %s before returning its body", async (kind) => {
		const { proxy } = await fixture((request, response) => { request.resume(); if (kind === "cookie") response.setHeader("Set-Cookie", "__Host-smartdeploy-app-session=evil; Path=/; Secure"); if (kind === "size") response.setHeader("Content-Length", "1025"); if (kind === "fields") for (let index = 0; index < 129; index++) response.setHeader(`x-fixture-${index}`, "a"); if (kind === "header-bytes") response.setHeader("x-oversized", "x".repeat(32768)); if (kind === "status") response.statusCode = 700; response.end("private-body"); });
		await expect(proxy.forward(input(), IDENTITY)).rejects.toMatchObject({ status: 502 });
	});
	it("preserves customer redirects without following them", async () => {
		const { proxy, count } = await fixture((request, response) => { request.resume(); response.writeHead(302, { Location: "http://169.254.169.254/never-follow" }).end("redirect"); });
		const response = await proxy.forward(input(), IDENTITY); expect(response.status).toBe(302); expect(response.headers.get("location")).toContain("169.254.169.254"); expect(await response.text()).toBe("redirect"); expect(count()).toBe(1);
	});
	it("streams the first chunk before completion, then fails a response past its cap", async () => {
		let more = () => {};
		const { proxy } = await fixture((request, response) => { request.resume(); response.write("abc"); more = () => response.end("def"); }, { maxResponseBytes: 3 });
		const response = await proxy.forward(input(), IDENTITY); const reader = response.body!.getReader();
		expect(new TextDecoder().decode((await reader.read()).value)).toBe("abc"); more();
		await expect(reader.read()).rejects.toMatchObject({ status: 502 });
	});
	it.each(["HEAD", "204", "205", "304"])("handles bodyless %s and closes its lease", async (kind) => {
		const { proxy } = await fixture((request, response) => { request.resume(); response.writeHead(kind === "HEAD" ? 200 : Number(kind)).end(); });
		const response = await proxy.forward(input("/", { method: kind === "HEAD" ? "HEAD" : "GET" }), IDENTITY); expect(response.body).toBeNull();
	});
	it.each(["idle", "deadline"])("enforces a response-header %s timeout", async (kind) => {
		const { proxy } = await fixture((request) => request.resume(), kind === "idle" ? { idleMs: 100 } : { idleMs: 1000, timeoutMs: 100 });
		await expect(proxy.forward(input(), IDENTITY)).rejects.toMatchObject({ status: 504 });
	});
	it("cancels a stalled upload reader at timeout", async () => {
		let cancelled = false; const { proxy } = await fixture((request) => request.resume(), { idleMs: 100 });
		const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
		await expect(proxy.forward(streaming(body), IDENTITY)).rejects.toMatchObject({ status: 504 }); expect(cancelled).toBe(true);
	});
	it("aborts an in-progress response and retires the runtime", async () => {
		const { proxy, dial } = await fixture((request, response) => { request.resume(); response.write("first"); });
		const response = await proxy.forward(input(), IDENTITY); const reader = response.body!.getReader(); await reader.read(); proxy.close();
		await expect(reader.read()).rejects.toMatchObject({ status: 503 }); await expect(proxy.forward(input(), IDENTITY)).rejects.toMatchObject({ status: 503 }); expect(dial).toHaveBeenCalledTimes(1);
	});
	it("holds admission until response completion and releases on socket close", async () => {
		let finish = () => {};
		const { proxy, dial } = await fixture((request, response) => { request.resume(); if (request.url === "/next") { response.end("next"); return; } response.write("first"); finish = () => response.end("last"); });
		const response = await proxy.forward(input(), IDENTITY); await expect(proxy.forward(input(), IDENTITY)).rejects.toMatchObject({ status: 503 });
		const closed = once(dial.mock.results[0].value, "close"); finish(); expect(await response.text()).toBe("firstlast"); await closed;
		expect(await (await proxy.forward(input("/next"), IDENTITY)).text()).toBe("next");
	});
	it("honours caller cancellation before dialing and during body consumption", async () => {
		const { proxy, dial } = await fixture((request, response) => { request.resume(); response.write("first"); });
		const cancelled = new AbortController(); cancelled.abort(); await expect(proxy.forward(input("/", { signal: cancelled.signal }), IDENTITY)).rejects.toMatchObject({ status: 503 }); expect(dial).not.toHaveBeenCalled();
		const controller = new AbortController(); const response = await proxy.forward(input("/", { signal: controller.signal }), IDENTITY); const reader = response.body!.getReader(); await reader.read(); controller.abort();
		await expect(reader.read()).rejects.toMatchObject({ status: 503 });
	});
	it("rejects mismatched binding/environment configuration", () => {
		for (const context of [{ ...options().context, bindingId: "9296be7b-766e-4d25-9f59-f9418b5ac966" }, { ...options().context, environment: "preview" as const }]) expect(() => new GatewayHttpProxy({ ...options(), context })).toThrow("App request unavailable.");
	});
	it.each([{ maxRequestBytes: 0 }, { maxRequestBytes: 1048577 }, { maxResponseBytes: 0 }, { maxResponseBytes: 10485761 }, { timeoutMs: 0 }, { timeoutMs: 30001 }, { idleMs: 0 }, { idleMs: 5001 }, { maxConnections: 0 }, { maxConnections: 33 }, { maxConnections: 1.5 }])("rejects unbounded limits %j", (patch) => {
		expect(() => new GatewayHttpProxy({ ...options(), limits: { ...options().limits, ...patch } })).toThrow("App request unavailable.");
	});
	it("rejects a missing declared upload and oversized request headers before TLS", async () => {
		const { proxy, dial } = await fixture((_request, response) => response.end());
		await expect(proxy.forward(input("/", { headers: { "content-length": "1" } }), IDENTITY)).rejects.toMatchObject({ status: 400 });
		await expect(proxy.forward(input("/", { headers: { "x-oversized": "x".repeat(16384) } }), IDENTITY)).rejects.toMatchObject({ status: 400 }); expect(dial).not.toHaveBeenCalled();
	});
	it("never sends HTTP to the wrong TLS workload", async () => {
		const { proxy, count } = await fixture((_request, response) => response.end(), {}, () => wrongCertificate);
		await expect(proxy.forward(input(), IDENTITY)).rejects.toMatchObject({ status: 502 }); expect(count()).toBe(0);
	});
	it("fails a truncated response without exposing the native socket error", async () => {
		let truncate = () => {};
		const { proxy } = await fixture((request, response) => { request.resume(); response.writeHead(200, { "Content-Length": "50" }); response.write("abc"); truncate = () => response.destroy(); });
		const reader = (await proxy.forward(input(), IDENTITY)).body!.getReader(); expect((await reader.read()).value?.byteLength).toBe(3); truncate();
		await expect(reader.read()).rejects.toMatchObject({ status: 502, message: "App request unavailable." });
	});
	it("rejects a customer upgrade response instead of tunneling it", async () => {
		const { proxy } = await fixture((request, response) => { request.resume(); response.writeHead(101, { Connection: "Upgrade", Upgrade: "websocket" }); response.flushHeaders(); });
		await expect(proxy.forward(input(), IDENTITY)).rejects.toMatchObject({ status: 502 });
	});
	it("preserves encoded response bytes and encoding headers", async () => {
		const compressed = gzipSync("customer content");
		const { proxy } = await fixture((request, response) => { request.resume(); response.writeHead(200, { "Content-Encoding": "gzip", "Content-Length": compressed.length }).end(compressed); });
		const response = await proxy.forward(input(), IDENTITY); expect(response.headers.get("content-encoding")).toBe("gzip"); expect(Buffer.from(await response.arrayBuffer())).toEqual(compressed);
	});
	it("closes an unread response at its idle limit and releases admission", async () => {
		const { proxy, dial } = await fixture((request, response) => { request.resume(); if (request.url === "/next") { response.end("next"); return; } response.write("first"); }, { idleMs: 100 });
		const response = await proxy.forward(input(), IDENTITY); const closed = once(dial.mock.results[0].value, "close");
		await expect(response.body!.getReader().closed).rejects.toMatchObject({ status: 504 }); await closed;
		expect(await (await proxy.forward(input("/next"), IDENTITY)).text()).toBe("next");
	});
	it("destroys upstream when the consumer cancels its response", async () => {
		const { proxy, dial } = await fixture((request, response) => { request.resume(); response.write("first"); });
		const response = await proxy.forward(input(), IDENTITY); const closed = once(dial.mock.results[0].value, "close"); await response.body!.cancel(); await closed;
		expect(dial.mock.results[0].value.destroyed).toBe(true);
	});
	it("enforces the overall deadline even while response data keeps arriving", async () => {
		let writes = 0;
		const { proxy } = await fixture((request, response) => { request.resume(); response.write("first"); const interval = setInterval(() => { writes++; response.write("more"); }, 10); response.once("close", () => clearInterval(interval)); }, { idleMs: 1000, timeoutMs: 200 });
		const response = await proxy.forward(input(), IDENTITY); await expect(response.text()).rejects.toMatchObject({ status: 504 }); expect(writes).toBeGreaterThan(1);
	});
	it("cancels unfinished input when the app completes an early response", async () => {
		let cancelled = false;
		const { proxy } = await fixture((request, response) => { request.resume(); response.writeHead(413).end("stop"); });
		const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("first")); }, cancel() { cancelled = true; } });
		const response = await proxy.forward(streaming(body), IDENTITY); expect(response.status).toBe(413); expect(await response.text()).toBe("stop"); expect(cancelled).toBe(true);
	});
});
