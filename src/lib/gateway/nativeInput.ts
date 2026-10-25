import type { IncomingMessage } from "node:http";
import { contentLength, GatewayProxyError, HttpLease } from "./httpLease";

export function nativeHeaders(incoming: IncomingMessage): Headers {
	if (incoming.httpVersion !== "1.1" || incoming.rawHeaders.length > 256) throw new GatewayProxyError(400);
	const result = new Headers(); const single = new Set(["host", "content-length", "transfer-encoding", "cookie"]); const seen = new Set<string>();
	let size = 0;
	for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
		const name = incoming.rawHeaders[index].toLowerCase(); const value = incoming.rawHeaders[index + 1];
		size += Buffer.byteLength(name + value) + 4;
		if ((single.has(name) && seen.has(name)) || size > 16384) throw new GatewayProxyError(400);
		seen.add(name); result.append(name, value);
	}
	if (!seen.has("host")) throw new GatewayProxyError(400);
	return result;
}

/** Cancel pauses input. Only the HTTP response/connection lifecycle closes the
 * inbound socket, so an early 401/413 can still be delivered to the client. */
function nativeBody(incoming: IncomingMessage, lease: HttpLease, maximum: number): ReadableStream<Uint8Array> {
	let size = 0;
	let cancellation: () => void = () => { incoming.pause(); };
	return new ReadableStream<Uint8Array>({
		start(controller) {
			incoming.pause();
			const cleanup = () => { incoming.pause(); incoming.removeListener("data", data); incoming.removeListener("end", end); lease.signal.removeEventListener("abort", abort); };
			const data = (chunk: Buffer) => {
				incoming.pause(); size += chunk.byteLength;
				if (size > maximum) { lease.fail(413); return; }
				lease.touch(); controller.enqueue(chunk);
			};
			const end = () => { cleanup(); controller.close(); };
			const abort = () => { cleanup(); controller.error(lease.error ?? new GatewayProxyError(503)); };
			incoming.on("data", data); incoming.once("end", end); lease.signal.addEventListener("abort", abort, { once: true });
			// Retain cleanup for cancellation without destroying IncomingMessage.
			cancellation = cleanup;
			if (lease.signal.aborted) abort();
		},
		pull() { incoming.resume(); },
		cancel() { cancellation(); },
	}, { highWaterMark: 0 });
}

export function nativeRequest(incoming: IncomingMessage, origin: string, headers: Headers, lease: HttpLease, maximum: number): Request {
	const path = incoming.url ?? ""; const method = incoming.method ?? "";
	if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u0020\u007f#]/.test(path) || Buffer.byteLength(path) > 4096) throw new GatewayProxyError(400);
	if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method) || headers.has("expect") || headers.has("upgrade")) throw new GatewayProxyError(400);
	const declared = contentLength(headers, maximum, 400); const encoding = headers.get("transfer-encoding");
	if (encoding !== null && (encoding.toLowerCase() !== "chunked" || declared !== null)) throw new GatewayProxyError(400);
	const bodyless = method === "GET" || method === "HEAD";
	if (bodyless && (encoding !== null || (declared !== null && declared !== 0))) throw new GatewayProxyError(400);
	const init: RequestInit & { duplex: "half" } = { method, headers, signal: lease.signal, duplex: "half" };
	if (!bodyless) init.body = nativeBody(incoming, lease, maximum);
	return new Request(origin + path, init);
}
