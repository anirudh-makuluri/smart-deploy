import type { ServerResponse } from "node:http";
import { contentLength, GatewayProxyError, HttpLease } from "./httpLease";

async function end(outgoing: ServerResponse, body: string | null = null): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const failed = () => { cleanup(); reject(new GatewayProxyError(503)); };
		const complete = () => { cleanup(); resolve(); };
		const cleanup = () => { outgoing.removeListener("finish", complete); outgoing.removeListener("close", failed); outgoing.removeListener("error", failed); };
		outgoing.once("finish", complete); outgoing.once("close", failed); outgoing.once("error", failed);
		if (body === null) outgoing.end(); else outgoing.end(body);
	});
}
function setHeaders(response: Response, outgoing: ServerResponse, maximum: number): void {
	let size = 0; let count = 0;
	for (const [name, value] of response.headers) { size += Buffer.byteLength(name + value) + 4; count++; }
	if (size > 32768 || count > 128) throw new GatewayProxyError(502);
	contentLength(response.headers, maximum, 502);
	for (const [name, value] of response.headers) if (name !== "set-cookie" && name !== "connection" && name !== "transfer-encoding") outgoing.setHeader(name, value);
	const cookies = response.headers.getSetCookie(); if (cookies.length) outgoing.setHeader("Set-Cookie", cookies);
	outgoing.setHeader("Cache-Control", "private, no-store"); outgoing.setHeader("Connection", "close"); outgoing.statusCode = response.status;
}

export async function nativeResponse(response: Response, outgoing: ServerResponse, method: string, lease: HttpLease, maximum: number): Promise<void> {
	const bodyless = method === "HEAD" || [204, 205, 304].includes(response.status);
	if (!response.body || bodyless) { void response.body?.cancel().catch(() => {}); lease.assert(); setHeaders(response, outgoing, maximum); await end(outgoing); return; }
	const declared = contentLength(response.headers, maximum, 502);
	const reader = response.body.getReader(); let size = 0;
	const cancel = () => { void reader.cancel().catch(() => {}); };
	lease.signal.addEventListener("abort", cancel, { once: true });
	try {
		// Validate/read the first bounded chunk before committing client headers.
		let first = true;
		while (true) {
			lease.assert(); const chunk = await reader.read(); lease.assert();
			if (!chunk.done) size += chunk.value.byteLength;
			if (size > maximum || (declared !== null && (size > declared || (chunk.done && size !== declared)))) throw new GatewayProxyError(502);
			if (first) { setHeaders(response, outgoing, maximum); first = false; }
			if (chunk.done) break;
			await new Promise<void>((resolve, reject) => outgoing.write(chunk.value, (error) => error ? reject(new GatewayProxyError(503)) : resolve()));
			lease.touch();
		}
		await end(outgoing);
	} finally { lease.signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function nativeFailure(outgoing: ServerResponse, status: number): Promise<void> {
	if (outgoing.headersSent) { outgoing.destroy(); return; }
	for (const name of outgoing.getHeaderNames()) outgoing.removeHeader(name);
	outgoing.setTimeout(1000, () => outgoing.destroy());
	outgoing.writeHead(status, { "Cache-Control": "private, no-store", "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer", Connection: "close" });
	await end(outgoing, JSON.stringify({ error: "App access unavailable." }));
}
