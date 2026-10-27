import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { createServer as tcpServer, type Socket, type Server as TcpServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { connect, createServer, type ConnectionOptions, type TLSSocket } from "node:tls";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GatewayUpstreamTls, gatewayWorkloadServerName, type GatewayUpstreamOptions, type GatewayWorkload } from "@/lib/gateway/upstreamTls";

const WORKLOAD: GatewayWorkload = { bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac", environment: "published", releaseId: "997a2326-5b9b-4c08-aaef-45c618db01d3" };
const NAME = gatewayWorkloadServerName(WORKLOAD);
interface Certificate { key: Buffer; cert: string }
let directory = "";
let opensslConfig = "";
let good: Certificate;
let wrong: Certificate;
let multiple: Certificate;
let wildcard: Certificate;
let child: Certificate;
const files: string[] = [];
const servers: TcpServer[] = [];
const sockets = new Set<Socket>();
const openssl = process.env.OPENSSL_PATH || (process.platform === "win32" && existsSync("C:/Program Files/Git/usr/bin/openssl.exe") ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl");
function run(args: string[]) { execFileSync(openssl, args, { stdio: "ignore", windowsHide: true }); }
function file(name: string) { const value = path.join(directory, name); files.push(value); return value; }
async function certificate(label: string, names: string): Promise<Certificate> {
	const key = file(`${label}.key`); const cert = file(`${label}.pem`);
	run(["req", "-config", opensslConfig, "-x509", "-sha256", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1", "-subj", "/CN=workload-fixture", "-addext", `subjectAltName=${names}`, "-addext", "basicConstraints=critical,CA:TRUE", "-keyout", key, "-out", cert]);
	return { key: await readFile(key), cert: await readFile(cert, "utf8") };
}
async function listen(server: TcpServer): Promise<number> {
	servers.push(server);
	server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.on("error", () => {}); });
	server.listen(0, "127.0.0.1"); await once(server, "listening");
	const address = server.address(); if (!address || typeof address === "string") throw new Error("Loopback fixture unavailable.");
	return address.port;
}
function options(port = 443): GatewayUpstreamOptions { return { ...WORKLOAD, privateIp: "10.0.1.23", port, certificatePem: good.cert, timeoutMs: 1000, maxConnections: 1 }; }
function fixture(configuration = options()) {
	const dial = vi.fn((input: ConnectionOptions) => {
		// Only replace the network route. All TLS identity/trust/protocol options stay intact.
		const socket = connect({ ...input, host: "127.0.0.1" }); sockets.add(socket); socket.once("close", () => sockets.delete(socket)); return socket;
	});
	return { client: new GatewayUpstreamTls(configuration, dial), dial };
}
async function tlsServer(peer = good, protocol: "TLSv1.2" | "TLSv1.3" = "TLSv1.3", alpn = ["http/1.1"]) {
	let bytes = ""; let serverName = "";
	const server = createServer({ key: peer.key, cert: peer.cert, minVersion: protocol, maxVersion: protocol, ALPNProtocols: alpn }, (socket) => {
		serverName = socket.servername || "";
		socket.on("error", () => {}); socket.on("data", (data) => { bytes += data.toString(); socket.write("fixture-received"); });
	});
	server.on("tlsClientError", () => {});
	return { port: await listen(server), bytes: () => bytes, serverName: () => serverName };
}
async function dispose(socket: TLSSocket) { const closed = once(socket, "close"); socket.destroy(); await closed; }
beforeAll(async () => {
	directory = await mkdtemp(path.join(tmpdir(), "smartdeploy-upstream-tls-"));
	opensslConfig = file("openssl.cnf"); await writeFile(opensslConfig, "[req]\ndistinguished_name=dn\n[dn]\n");
	good = await certificate("good", `DNS:${NAME}`);
	wrong = await certificate("wrong", `DNS:${NAME.replace("published", "preview")}`);
	multiple = await certificate("multiple", `DNS:${NAME},DNS:other.gateway.invalid`);
	wildcard = await certificate("wildcard", "DNS:*.gateway.invalid");
	const key = file("child.key"); const csr = file("child.csr"); const cert = file("child.pem"); const extensions = file("child.cnf");
	await writeFile(extensions, `subjectAltName=DNS:${NAME}\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n`);
	run(["req", "-config", opensslConfig, "-new", "-sha256", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-subj", "/CN=other-workload", "-keyout", key, "-out", csr]);
	run(["x509", "-req", "-in", csr, "-CA", path.join(directory, "good.pem"), "-CAkey", path.join(directory, "good.key"), "-set_serial", "2", "-days", "1", "-extfile", extensions, "-out", cert]);
	child = { key: await readFile(key), cert: await readFile(cert, "utf8") };
});
afterEach(async () => {
	vi.restoreAllMocks(); for (const socket of sockets) socket.destroy();
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});
afterAll(async () => { for (const value of files) if (existsSync(value)) await unlink(value); if (directory) await rmdir(directory); });

describe("workload-pinned upstream TLS", () => {
	it("sends no HTTP until the configured peer is verified, with dedicated SNI and only its certificate trusted", async () => {
		const server = await tlsServer(); const configuration = options(server.port); const { client, dial } = fixture(configuration);
		configuration.privateIp = "192.168.99.99"; configuration.certificatePem = wrong.cert; configuration.environment = "preview";
		const socket = await client.connect(new AbortController().signal);
		expect(socket.authorized).toBe(true); expect(socket.getProtocol()).toBe("TLSv1.3"); expect(server.bytes()).toBe("");
		const received = once(socket, "data"); socket.write("GET / HTTP/1.1\r\nHost: private-app.test\r\nX-SmartDeploy-Identity: fixture\r\n\r\n"); await received;
		expect(server.bytes()).toContain("X-SmartDeploy-Identity: fixture"); expect(server.serverName()).toBe(NAME);
		expect(dial.mock.calls[0][0]).toMatchObject({ host: "10.0.1.23", servername: NAME, ca: good.cert, rejectUnauthorized: true, minVersion: "TLSv1.3", ALPNProtocols: ["http/1.1"] });
		await dispose(socket);
	});
	it.each(["wrong workload", "different pinned leaf", "TLS downgrade", "missing ALPN"])("rejects %s without sending any HTTP bytes", async (kind) => {
		const server = await tlsServer(kind === "wrong workload" ? wrong : kind === "different pinned leaf" ? child : good, kind === "TLS downgrade" ? "TLSv1.2" : "TLSv1.3", kind === "missing ALPN" ? [] : ["http/1.1"]);
		await expect(fixture(options(server.port)).client.connect(new AbortController().signal)).rejects.toMatchObject({ status: 502, message: "App connection unavailable." });
		expect(server.bytes()).toBe("");
	});
	it("proves the alternate leaf has a valid chain and hostname, so exact pinning is necessary", async () => {
		const server = await tlsServer(child);
		const socket = connect({ host: "127.0.0.1", port: server.port, ca: good.cert, servername: NAME, rejectUnauthorized: true, minVersion: "TLSv1.3", ALPNProtocols: ["http/1.1"] });
		sockets.add(socket); socket.once("close", () => sockets.delete(socket));
		await once(socket, "secureConnect"); expect(socket.authorized).toBe(true); expect(server.bytes()).toBe(""); await dispose(socket);
	});
	it("rejects a trusted certificate with a different hostname even if its pin matches", async () => {
		const server = await tlsServer(); const { client, dial } = fixture(options(server.port));
		const socket = await client.connect(new AbortController().signal);
		expect(dial.mock.calls[0][0].checkServerIdentity?.("other.gateway.invalid", socket.getPeerCertificate())).toMatchObject({ status: 502 });
		await dispose(socket);
	});
	it.each(["127.0.0.1", "169.254.169.254", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.0.1", "2130706433", "0x0a000001", "10.01.1.1", "::1", "app.internal"])("rejects an unapproved address %s", (privateIp) => {
		expect(() => fixture({ ...options(), privateIp })).toThrow("App connection unavailable.");
	});
	it.each(["10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.1.1"])("accepts canonical RFC1918 address %s", (privateIp) => {
		expect(() => fixture({ ...options(), privateIp })).not.toThrow();
	});
	it.each([{ port: 0 }, { port: 65536 }, { port: 1.5 }, { timeoutMs: 0 }, { timeoutMs: 5001 }, { maxConnections: 0 }, { maxConnections: 33 }, { maxConnections: 1.5 }, { bindingId: "bad" }, { releaseId: "bad" }, { environment: "other" }, { certificatePem: "secret-not-a-certificate" }])("rejects invalid configuration %j", (patch) => {
		expect(() => new GatewayUpstreamTls({ ...options(), ...patch } as GatewayUpstreamOptions)).toThrow("App connection unavailable.");
	});
	it.each(["wrong", "multi-SAN", "wildcard", "chain", "key", "oversized"])("rejects %s certificate configuration", (kind) => {
		const certificatePem = kind === "wrong" ? wrong.cert : kind === "multi-SAN" ? multiple.cert : kind === "wildcard" ? wildcard.cert : kind === "chain" ? good.cert + wrong.cert : kind === "key" ? good.cert + good.key.toString() : "x".repeat(8193);
		expect(() => fixture({ ...options(), certificatePem })).toThrow("App connection unavailable.");
	});
	it.each(["preview", "release"])("requires a distinct certificate for a changed %s", (kind) => {
		expect(() => fixture({ ...options(), ...(kind === "preview" ? { environment: "preview" } : { releaseId: "9296be7b-766e-4d25-9f59-f9418b5ac966" }) })).toThrow("App connection unavailable.");
	});
	it.each([-86400000, 172800000])("rejects a certificate outside its validity window (%i)", (offset) => {
		const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + offset);
		expect(() => fixture()).toThrow("App connection unavailable.");
	});
	it("rechecks expiry before dialing", async () => {
		const { client, dial } = fixture(); const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 172800000);
		await expect(client.connect(new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(dial).not.toHaveBeenCalled();
	});
	it("rechecks expiry when a handshake completes", async () => {
		const server = await tlsServer(); const now = Date.now();
		const client = new GatewayUpstreamTls(options(server.port), (input) => {
			const socket = connect({ ...input, host: "127.0.0.1" }); sockets.add(socket); socket.once("close", () => sockets.delete(socket));
			socket.prependOnceListener("secureConnect", () => vi.spyOn(Date, "now").mockReturnValue(now + 172800000)); return socket;
		});
		await expect(client.connect(new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(server.bytes()).toBe("");
	});
	it("rejects a peer that closes before its TLS handshake completes", async () => {
		const port = await listen(tcpServer((socket) => socket.end()));
		await expect(fixture(options(port)).client.connect(new AbortController().signal)).rejects.toMatchObject({ status: 502 });
	});
	it("times out a stalled handshake and releases capacity", async () => {
		const port = await listen(tcpServer()); const { client, dial } = fixture({ ...options(port), timeoutMs: 30 });
		await expect(client.connect(new AbortController().signal)).rejects.toMatchObject({ status: 503 });
		await once(dial.mock.results[0].value, "close");
		await expect(client.connect(new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(dial).toHaveBeenCalledTimes(2);
	});
	it("does not dial an already cancelled request", async () => {
		const controller = new AbortController(); controller.abort(); const { client, dial } = fixture();
		await expect(client.connect(controller.signal)).rejects.toMatchObject({ status: 503 }); expect(dial).not.toHaveBeenCalled();
	});
	it("cancels an in-progress handshake and removes its abort listener", async () => {
		const port = await listen(tcpServer()); const controller = new AbortController(); const { client, dial } = fixture(options(port));
		const remove = vi.spyOn(controller.signal, "removeEventListener"); const pending = client.connect(controller.signal); controller.abort();
		await expect(pending).rejects.toMatchObject({ status: 503 }); await once(dial.mock.results[0].value, "close");
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
	});
	it("retains capacity until socket close and honours cancellation after connection", async () => {
		const server = await tlsServer(); const { client } = fixture(options(server.port)); const controller = new AbortController();
		const socket = await client.connect(controller.signal);
		await expect(client.connect(new AbortController().signal)).rejects.toMatchObject({ status: 503 });
		const closed = once(socket, "close"); controller.abort(); await closed;
		await dispose(await client.connect(new AbortController().signal));
	});
	it("redacts synchronous dial failures and releases capacity", async () => {
		const dial = vi.fn(() => { throw new Error("private-credential-secret"); }); const client = new GatewayUpstreamTls(options(), dial);
		await expect(client.connect(new AbortController().signal)).rejects.toThrow("App connection unavailable.");
		await expect(client.connect(new AbortController().signal)).rejects.toThrow("App connection unavailable."); expect(dial).toHaveBeenCalledTimes(2);
	});
});
