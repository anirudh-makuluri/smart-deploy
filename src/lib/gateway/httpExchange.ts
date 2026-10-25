import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import type { TLSSocket } from "node:tls";
import { GatewayHttpIsolation } from "./httpIsolation";
import { contentLength, GatewayProxyError, HttpLease, type GatewayHttpLimits } from "./httpLease";

async function upload(input: Request, outgoing: ClientRequest, lease: HttpLease, maximum: number, declared: number | null): Promise<void> {
	if (!input.body) { if (declared !== null && declared !== 0) { lease.fail(400); return; } outgoing.end(); return; }
	const reader = input.body.getReader(); let size = 0;
	const cancel = () => { void reader.cancel().catch(() => {}); };
	lease.signal.addEventListener("abort", cancel, { once: true });
	try {
		while (true) {
			lease.assert(); const chunk = await reader.read(); lease.assert();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > maximum) { lease.fail(413); return; }
			if (declared !== null && size > declared) { lease.fail(400); return; }
			await new Promise<void>((resolve, reject) => outgoing.write(chunk.value, (error) => error ? reject(error) : resolve()));
			lease.touch();
		}
		if (declared !== null && size !== declared) { lease.fail(400); return; }
		outgoing.end();
	} catch { lease.fail(400); }
	finally { lease.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

function responseHeaders(incoming: IncomingMessage): Headers {
	if (incoming.rawHeaders.length > 256) throw new GatewayProxyError(502);
	const result = new Headers();
	for (let index = 0; index < incoming.rawHeaders.length; index += 2) result.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
	return result;
}

function responseBody(incoming: IncomingMessage, lease: HttpLease, maximum: number): ReadableStream<Uint8Array> {
	const iterator: AsyncIterator<Buffer> = incoming[Symbol.asyncIterator](); let size = 0;
	return new ReadableStream<Uint8Array>({
		start(controller) {
			lease.signal.addEventListener("abort", () => controller.error(lease.error ?? new GatewayProxyError(502)), { once: true });
			if (lease.signal.aborted) controller.error(lease.error ?? new GatewayProxyError(502));
		},
		async pull(controller) {
			try {
				lease.assert(); const chunk = await iterator.next(); lease.assert();
				if (chunk.done) { controller.close(); lease.finish(); return; }
				size += chunk.value.byteLength;
				if (size > maximum) { lease.fail(502); return; }
				lease.touch(); controller.enqueue(chunk.value);
			} catch { lease.fail(502); }
		},
		cancel() { lease.fail(503); },
	});
}

/** The socket must have completed workload TLS verification before this function is called. */
export function httpExchange(input: Request, socket: TLSSocket, headers: Headers, policy: GatewayHttpIsolation, limits: GatewayHttpLimits, lease: HttpLease, declared: number | null): Promise<Response> {
	return new Promise<Response>((resolve, reject) => {
		const url = new URL(input.url); let incoming: IncomingMessage | null = null;
		const outgoing = httpRequest({ method: input.method, path: url.pathname + url.search,
			headers: Object.fromEntries(headers), createConnection: () => socket,
			maxHeaderSize: 32768, insecureHTTPParser: false, joinDuplicateHeaders: false });
		const abort = () => { outgoing.destroy(); incoming?.destroy(); reject(lease.error ?? new GatewayProxyError(502)); };
		lease.signal.addEventListener("abort", abort, { once: true });
		outgoing.on("error", () => lease.fail(502));
		outgoing.on("upgrade", (_response, upgraded) => { upgraded.destroy(); lease.fail(502); });
		outgoing.once("response", (response) => {
			incoming = response; lease.touch();
			try {
				lease.assert(); const source = responseHeaders(response);
				contentLength(source, limits.maxResponseBytes, 502);
				const safe = policy.responseHeaders(source); const status = response.statusCode ?? 0;
				if (status < 200 || status > 599) throw new GatewayProxyError(502);
				const bodyless = input.method === "HEAD" || [204, 205, 304].includes(status);
				const body = bodyless ? null : responseBody(response, lease, limits.maxResponseBytes);
				const result = new Response(body, { status, headers: safe });
				resolve(result); if (bodyless) lease.finish();
			} catch { lease.fail(502); }
		});
		if (lease.signal.aborted) { abort(); return; }
		void upload(input, outgoing, lease, limits.maxRequestBytes, declared);
	});
}
