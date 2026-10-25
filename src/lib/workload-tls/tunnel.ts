import { connect, type Socket } from "node:net";
import { Transform, type TransformCallback } from "node:stream";
import { createSecureContext, createServer, type Server, type TLSSocket } from "node:tls";
import { requireWorkloadCertificateCurrent, validateWorkloadTlsConfig, WorkloadTlsError, type WorkloadTlsConfig } from "./config";

function meter(maximum: number): Transform {
	let size = 0;
	return new Transform({ transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
		if (!Buffer.isBuffer(chunk) || chunk.byteLength > maximum - size) { callback(new WorkloadTlsError()); return; }
		size += chunk.byteLength; callback(null, chunk);
	} });
}
export interface WorkloadTlsListener { server: Server; stop: (graceMs: number) => Promise<void> }

/** TLS identity/byte transport only. The separate trusted gateway authorizes users;
 * AWS ingress must admit only that gateway. This task receives no platform key. */
export function createWorkloadTlsListener(options: WorkloadTlsConfig): WorkloadTlsListener {
	const { config, certificate, serverName } = validateWorkloadTlsConfig(options);
	const context = createSecureContext({ cert: config.certificatePem, key: config.privateKeyPem, minVersion: "TLSv1.3" });
	const connections = new Set<Socket>(); let stopped = false; let stopping: Promise<void> | null = null;
	const server = createServer({ minVersion: "TLSv1.3", ALPNProtocols: ["http/1.1"], allowHalfOpen: true,
		handshakeTimeout: Math.min(config.handshakeMs, config.timeoutMs),
		SNICallback(name, callback) {
			try { requireWorkloadCertificateCurrent(certificate); if (stopped || name !== serverName) throw new WorkloadTlsError(); callback(null, context); }
			catch { callback(new WorkloadTlsError()); }
		},
	}, (client: TLSSocket) => {
		client.on("error", () => client.destroy());
		try { requireWorkloadCertificateCurrent(certificate); } catch { client.destroy(); return; }
		if (stopped || client.servername !== serverName || client.alpnProtocol !== "http/1.1") { client.destroy(); return; }
		client.disableRenegotiation(); client.pause();
		const app = connect({ host: "127.0.0.1", port: config.appPort, allowHalfOpen: true });
		const inbound = meter(config.maxInboundBytes); const outbound = meter(config.maxOutboundBytes);
		let finished = false;
		const abort = () => { if (finished) return; finished = true; client.destroy(); app.destroy(); inbound.destroy(); outbound.destroy(); };
		const lifetime = setTimeout(abort, config.timeoutMs); lifetime.unref();
		client.setTimeout(config.idleMs, abort); app.setTimeout(config.idleMs, abort);
		for (const stream of [client, app, inbound, outbound]) stream.on("error", abort);
		client.once("close", () => { clearTimeout(lifetime); abort(); });
		app.once("close", (hadError) => { if (hadError || !app.readableEnded) abort(); });
		// Independent pipes preserve backpressure and half-close without destroying
		// the app's readable side as soon as its request writable side finishes.
		client.pipe(inbound).pipe(app); app.pipe(outbound).pipe(client);
	});
	server.maxConnections = config.maxConnections;
	server.on("connection", (socket: Socket) => {
		if (stopped) { socket.destroy(); return; }
		connections.add(socket); socket.on("error", () => socket.destroy()); socket.once("close", () => connections.delete(socket));
	});
	server.on("tlsClientError", (_error, socket) => socket.destroy());
	return { server, stop(graceMs: number) {
		if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 5000) return Promise.reject(new WorkloadTlsError());
		if (stopping) return stopping;
		stopped = true;
		stopping = new Promise<void>((resolve) => {
			const destroy = () => { for (const socket of connections) socket.destroy(); };
			const timer = setTimeout(destroy, graceMs); timer.unref(); if (graceMs === 0) destroy();
			server.close(() => { clearTimeout(timer); destroy(); resolve(); });
		}); return stopping;
	} };
}
