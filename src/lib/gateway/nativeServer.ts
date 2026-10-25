import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { secureOrigin } from "./controlClient";
import { GatewayHttpLimits, GatewayProxyError, HttpLease } from "./httpLease";
import { nativeHeaders, nativeRequest } from "./nativeInput";
import { nativeFailure, nativeResponse } from "./nativeResponse";

export interface GatewayNativeRoute { origin: string; handle: (request: Request) => Promise<Response>; close: () => void }
export interface GatewayNativeOptions { key: string | Buffer; cert: string | Buffer; routes: GatewayNativeRoute[]; limits: GatewayHttpLimits }

/** Creates an unbound HTTPS server. No process, listener address, registry,
 * certificate provisioning or cloud resource is started by this function. */
export function createGatewayHttpsServer(options: GatewayNativeOptions): Server {
	const limits = GatewayHttpLimits.parse(options.limits); const routes = new Map<string, GatewayNativeRoute>();
	if (options.routes.length < 1 || options.routes.length > 32) throw new GatewayProxyError(503);
	for (const route of options.routes) {
		const origin = secureOrigin(route.origin); if (routes.has(origin.host)) throw new GatewayProxyError(503);
		routes.set(origin.host, { origin: origin.origin, handle: route.handle.bind(route), close: route.close.bind(route) });
	}
	let active = 0;
	const exchanges = new WeakMap<Duplex, { lease: HttpLease; outgoing: ServerResponse }>();
	const serve = async (incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> => {
		incoming.pause(); incoming.socket.setTimeout(0);
		const disconnected = new AbortController();
		let managed: Response | null = null;
		const lease = new HttpLease(disconnected.signal, limits, () => {});
		exchanges.set(incoming.socket, { lease, outgoing });
		const stop = () => disconnected.abort();
		const inputClosed = () => { if (!incoming.complete) stop(); };
		const outputClosed = () => { if (!outgoing.writableFinished) stop(); };
		incoming.once("error", stop); incoming.once("close", inputClosed); outgoing.once("close", outputClosed); outgoing.once("error", stop);
		const drop = () => outgoing.destroy(); lease.signal.addEventListener("abort", () => { if (outgoing.headersSent && !outgoing.writableFinished) drop(); }, { once: true });
		try {
			if (active >= limits.maxConnections) throw new GatewayProxyError(503);
			active++;
			try {
				const headers = nativeHeaders(incoming); const host = headers.get("host") ?? "";
				const route = routes.get(host.toLowerCase()); if (!route) { await nativeFailure(outgoing, 403); return; }
				const request = nativeRequest(incoming, route.origin, headers, lease, limits.maxRequestBytes);
				lease.assert();
				const aborted = new Promise<never>((_resolve, reject) => { lease.signal.addEventListener("abort", () => reject(lease.error ?? new GatewayProxyError(503)), { once: true }); });
				const work = route.handle(request);
				void work.then((response) => { if (lease.signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
				managed = await Promise.race([work, aborted]); lease.assert(); lease.touch();
				await nativeResponse(managed, outgoing, incoming.method ?? "", lease, limits.maxResponseBytes);
			} finally { active--; }
		} catch (error) { await nativeFailure(outgoing, lease.error?.status ?? (error instanceof GatewayProxyError ? error.status : 503)); }
		finally {
			void managed?.body?.cancel().catch(() => {});
			lease.finish(); incoming.pause(); incoming.removeListener("close", inputClosed); outgoing.removeListener("close", outputClosed);
			incoming.socket.setTimeout(Math.min(1000, limits.idleMs), () => incoming.socket.destroy());
		}
	};
	const dispatch = (request: IncomingMessage, response: ServerResponse) => { void serve(request, response).catch(() => response.destroy()); };
	const server = createServer({ key: options.key, cert: options.cert, minVersion: "TLSv1.2", handshakeTimeout: Math.min(5000, limits.idleMs), maxHeaderSize: 16384,
		headersTimeout: Math.min(5000, limits.idleMs, limits.timeoutMs), requestTimeout: limits.timeoutMs, connectionsCheckingInterval: 100 }, dispatch);
	server.maxHeadersCount = 0; // Preserve all raw fields within the parser byte cap so duplicates/count are checked, not truncated.
	server.maxRequestsPerSocket = 1; server.maxConnections = limits.maxConnections; server.keepAliveTimeout = 1;
	server.setTimeout(Math.min(5000, limits.idleMs), (socket) => socket.destroy());
	server.on("checkContinue", dispatch); server.on("checkExpectation", dispatch);
	server.on("connect", (_request, socket) => socket.destroy()); server.on("upgrade", (_request, socket) => socket.destroy());
	server.on("dropRequest", (_request, socket) => socket.destroy());
	server.on("clientError", (_error, socket) => {
		const current = exchanges.get(socket);
		if (current) { current.lease.fail(400); if (current.outgoing.writableFinished) socket.destroy(); return; }
		if (!socket.destroyed && !socket.writableEnded) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nCache-Control: private, no-store\r\nContent-Length: 0\r\n\r\n");
	});
	server.once("close", () => { for (const route of routes.values()) route.close(); });
	return server;
}
