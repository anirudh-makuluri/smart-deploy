import { createServer, type Server, type Socket } from "node:net";
import { checkServerIdentity, connect, type ConnectionOptions, type TLSSocket } from "node:tls";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createWorkloadTlsListener, type WorkloadTlsListener } from "@/lib/workload-tls/tunnel";
import { validateWorkloadTlsConfig, workloadServerName, workloadTlsConfigFromEnv, type WorkloadTlsConfig } from "@/lib/workload-tls/config";
import { gatewayWorkloadServerName, GatewayUpstreamTls } from "@/lib/gateway/upstreamTls";
import { workloadTlsEnvironment, workloadTlsFixture } from "../../helpers/workloadTlsFixture";

let material: Awaited<ReturnType<typeof workloadTlsFixture>>; let alternate: Awaited<ReturnType<typeof workloadTlsFixture>>;
const listeners: WorkloadTlsListener[] = []; const apps: Server[] = []; const sockets = new Set<Socket>();
beforeAll(async () => { material = await workloadTlsFixture(3000); alternate = await workloadTlsFixture(3001); });
afterAll(async () => { await material.dispose(); await alternate.dispose(); });
afterEach(async () => {
	vi.restoreAllMocks(); for (const socket of sockets) socket.destroy(); sockets.clear();
	for (const listener of listeners.splice(0)) await listener.stop(0);
	for (const app of apps.splice(0)) await new Promise<void>((resolve) => app.close(() => resolve()));
});
function track<T extends Socket>(socket: T): T { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); return socket; }
async function app(handler: (socket: Socket) => void): Promise<number> {
	const server = createServer({ allowHalfOpen: true }, (socket) => { track(socket); handler(socket); }); apps.push(server);
	await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address(); if (!address || typeof address === "string") throw Error("No test app port"); return address.port;
}
async function listener(appPort: number, overrides: Partial<WorkloadTlsConfig> = {}): Promise<{ port: number; config: WorkloadTlsConfig; value: WorkloadTlsListener }> {
	const config = { ...material.config, appPort, ...overrides }; const value = createWorkloadTlsListener(config); listeners.push(value);
	await new Promise<void>((resolve, reject) => { value.server.once("error", reject); value.server.listen(0, "127.0.0.1", resolve); });
	const address = value.server.address(); if (!address || typeof address === "string") throw Error("No TLS test port"); return { port: address.port, config, value };
}
function tls(port: number, overrides: ConnectionOptions = {}, halfOpen = false): Promise<TLSSocket> {
	return new Promise((resolve, reject) => {
		const options: ConnectionOptions & { allowHalfOpen: boolean } = { host: "127.0.0.1", port, servername: workloadServerName(material.config), ca: material.config.certificatePem,
			rejectUnauthorized: true, minVersion: "TLSv1.3", ALPNProtocols: ["http/1.1"], ...overrides, allowHalfOpen: halfOpen };
		const socket = track(connect(options));
		socket.once("secureConnect", () => resolve(socket)); socket.once("error", reject); socket.once("close", () => reject(new Error("TLS closed")));
	});
}
function read(socket: Socket): Promise<Buffer> {
	return new Promise((resolve) => { const chunks: Buffer[] = []; socket.on("data", (chunk: Buffer) => chunks.push(chunk)); socket.once("close", () => resolve(Buffer.concat(chunks))); });
}
function closed(socket: Socket): Promise<void> { return new Promise((resolve) => { if (socket.destroyed) resolve(); else socket.once("close", () => resolve()); }); }

describe("standalone workload TLS configuration", () => {
	it("matches the gateway's exact binding/environment/release name and explicit env contract", () => {
		const { bindingId, environment, releaseId } = material.config;
		expect(workloadServerName(material.config)).toBe(gatewayWorkloadServerName({ bindingId, environment, releaseId }));
		expect(workloadTlsConfigFromEnv(workloadTlsEnvironment(material.config))).toEqual(material.config);
	});
	it.each<[string, Partial<WorkloadTlsConfig>]>([
		["binding", { bindingId: "invalid" }], ["release", { releaseId: "invalid" }], ["same ports", { appPort: 8443 }],
		["negative port", { appPort: -1 }], ["oversized port", { tlsPort: 65536 }], ["zero connections", { maxConnections: 0 }],
		["many connections", { maxConnections: 33 }], ["infinite lifetime", { timeoutMs: Infinity }], ["long lifetime", { timeoutMs: 30001 }],
		["long idle", { idleMs: 5001 }], ["zero handshake", { handshakeMs: 0 }], ["long drain", { shutdownMs: 5001 }],
		["zero input", { maxInboundBytes: 0 }], ["large output", { maxOutboundBytes: 64 * 1024 * 1024 + 1 }],
		["invalid key", { privateKeyPem: "must-not-escape" }], ["invalid cert", { certificatePem: "must-not-escape" }],
	])("rejects %s without exposing config values", (_, changes) => {
		expect(() => validateWorkloadTlsConfig({ ...material.config, ...changes })).toThrow("Workload TLS unavailable.");
	});
	it("rejects a different workload certificate, mismatched private key and appended chain", () => {
		for (const changes of [{ certificatePem: alternate.config.certificatePem, privateKeyPem: alternate.config.privateKeyPem },
			{ privateKeyPem: alternate.config.privateKeyPem }, { certificatePem: material.config.certificatePem + alternate.config.certificatePem }]) {
			expect(() => createWorkloadTlsListener({ ...material.config, ...changes })).toThrow("Workload TLS unavailable.");
		}
	});
	it("rejects expired configuration", () => {
		vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2 * 24 * 60 * 60 * 1000);
		expect(() => createWorkloadTlsListener(material.config)).toThrow("Workload TLS unavailable.");
	});
	it.each(["", "1e3", "1.5", "-1", " 10", "01"])("rejects malformed environment number %j", (value) => {
		expect(() => workloadTlsConfigFromEnv({ ...workloadTlsEnvironment(material.config), SMARTDEPLOY_APP_PORT: value })).toThrow("Workload TLS unavailable.");
	});
});

describe("real TLS to fixed loopback app transport", () => {
	it("forwards binary bytes unchanged and works with the gateway's actual pinned connector", async () => {
		const payload = Buffer.from([0, 255, 1, 13, 10, 88]); const received: Buffer[] = [];
		const appPort = await app((socket) => socket.on("data", (chunk: Buffer) => { received.push(chunk); socket.end(payload); }));
		const target = await listener(appPort);
		const connector = new GatewayUpstreamTls({ bindingId: target.config.bindingId, environment: target.config.environment, releaseId: target.config.releaseId,
			privateIp: "10.0.1.23", port: target.port, certificatePem: target.config.certificatePem, maxConnections: 1, timeoutMs: 1000 },
			(options) => connect({ ...options, host: "127.0.0.1" }));
		const client = track(await connector.connect(new AbortController().signal)); const response = read(client); client.write(payload);
		expect(await response).toEqual(payload); expect(Buffer.concat(received)).toEqual(payload);
	});
	it("keeps the app response alive after the client half-closes its request", async () => {
		const appPort = await app((socket) => { socket.resume(); socket.once("end", () => socket.end("after-request-end")); });
		const target = await listener(appPort); const client = await tls(target.port, {}, true);
		const response = read(client); client.end("request"); expect((await response).toString()).toBe("after-request-end");
	});
	it("flushes a response larger than socket high-water marks before closing", async () => {
		const body = Buffer.alloc(512 * 1024, 7);
		const appPort = await app((socket) => socket.once("data", () => socket.end(body)));
		const target = await listener(appPort); const client = await tls(target.port); const response = read(client); client.write("request");
		expect(await response).toEqual(body);
	});
	it.each(["wrong SNI", "no SNI", "wrong ALPN", "no ALPN", "TLS 1.2"])("does not connect to the app for %s", async (kind) => {
		const accepted = vi.fn(); const appPort = await app((socket) => { accepted(); socket.resume(); }); const target = await listener(appPort);
		const overrides: ConnectionOptions = {};
		if (kind === "wrong SNI") { overrides.servername = "wrong.gateway.invalid"; overrides.checkServerIdentity = (_, certificate) => checkServerIdentity(workloadServerName(material.config), certificate); }
		if (kind === "no SNI") overrides.servername = "";
		if (kind === "wrong ALPN") overrides.ALPNProtocols = ["h2"];
		if (kind === "no ALPN") overrides.ALPNProtocols = [];
		if (kind === "TLS 1.2") { overrides.minVersion = "TLSv1.2"; overrides.maxVersion = "TLSv1.2"; }
		try { const client = await tls(target.port, overrides); client.resume(); await closed(client); } catch { /* Expected TLS rejection. */ }
		expect(accepted).not.toHaveBeenCalled();
	});
	it("rejects new handshakes after the configured certificate expires", async () => {
		const accepted = vi.fn(); const appPort = await app((socket) => { accepted(); socket.resume(); }); const target = await listener(appPort);
		vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2 * 24 * 60 * 60 * 1000);
		await expect(tls(target.port)).rejects.toBeInstanceOf(Error); expect(accepted).not.toHaveBeenCalled();
	});
	it("closes on a loopback connection failure without returning error details", async () => {
		const unused = createServer(); await new Promise<void>((resolve) => unused.listen(0, "127.0.0.1", resolve));
		const address = unused.address(); if (!address || typeof address === "string") throw Error("No unused port"); await new Promise<void>((resolve) => unused.close(() => resolve()));
		const target = await listener(address.port); const client = await tls(target.port); const response = read(client); client.write("request"); expect(await response).toHaveLength(0);
	});
	it("bounds bytes sent toward the app", async () => {
		let count = 0; const appPort = await app((socket) => socket.on("data", (chunk: Buffer) => { count += chunk.byteLength; }));
		const target = await listener(appPort, { maxInboundBytes: 4 }); const client = await tls(target.port); const done = closed(client); client.write(Buffer.alloc(32)); await done;
		expect(count).toBeLessThanOrEqual(4);
	});
	it("bounds bytes returned from the app", async () => {
		const appPort = await app((socket) => socket.once("data", () => socket.end(Buffer.alloc(128))));
		const target = await listener(appPort, { maxOutboundBytes: 4 }); const client = await tls(target.port); const response = read(client); client.write("request"); expect((await response).length).toBeLessThanOrEqual(4);
	});
	it("times out an idle app connection", async () => {
		const appPort = await app((socket) => socket.resume()); const target = await listener(appPort, { idleMs: 50 }); const client = await tls(target.port); await closed(client);
	});
	it("bounds a continuously active connection by its lifetime", async () => {
		const appPort = await app((socket) => { const timer = setInterval(() => socket.write("x"), 10); socket.once("close", () => clearInterval(timer)); });
		const target = await listener(appPort, { timeoutMs: 100, idleMs: 1000 }); const client = await tls(target.port); client.resume(); await closed(client);
	});
	it("bounds incomplete handshakes and stops them during shutdown", async () => {
		const accepted = vi.fn(); const appPort = await app((socket) => { accepted(); socket.resume(); }); const target = await listener(appPort, { handshakeMs: 50 });
		const client = track(new (await import("node:net")).Socket()); client.connect(target.port, "127.0.0.1"); await closed(client); expect(accepted).not.toHaveBeenCalled();
		const pending = track(new (await import("node:net")).Socket()); await new Promise<void>((resolve) => pending.connect(target.port, "127.0.0.1", resolve));
		await target.value.stop(0); await closed(pending);
	});
	it("limits simultaneous TLS/app connections", async () => {
		const accepted = vi.fn(); const appPort = await app((socket) => { accepted(); socket.resume(); }); const target = await listener(appPort, { maxConnections: 1 });
		const first = await tls(target.port); await vi.waitFor(() => expect(accepted).toHaveBeenCalledTimes(1));
		await expect(tls(target.port)).rejects.toBeInstanceOf(Error); expect(accepted).toHaveBeenCalledTimes(1); first.destroy();
	});
	it("drains an existing response during graceful stop and then closes", async () => {
		let seen: () => void = () => {}; const received = new Promise<void>((resolve) => { seen = resolve; });
		const appPort = await app((socket) => socket.once("data", () => { seen(); setTimeout(() => socket.end("drained"), 30); }));
		const target = await listener(appPort); const client = await tls(target.port); const response = read(client); client.write("request");
		await received;
		const stop = target.value.stop(500); expect((await response).toString()).toBe("drained"); await stop;
		await expect(tls(target.port)).rejects.toBeInstanceOf(Error);
	});
	it("forces stuck connections closed when the drain allowance ends", async () => {
		const appPort = await app((socket) => socket.resume()); const target = await listener(appPort); const client = await tls(target.port);
		await target.value.stop(30); await closed(client); await expect(target.value.stop(-1)).rejects.toThrow("Workload TLS unavailable.");
	});
});
