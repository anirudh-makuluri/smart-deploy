import { GatewayDocumentOperation } from "../apps/documentApiSchema";
import { GatewayControlClient, GatewayDocumentError, secureOrigin, type GatewayControlOptions, type GatewayFetch } from "./controlClient";
import { sessionToken } from "./cookies";
import { GatewayHttpError, GatewayHttpIsolation, type GatewayHttpContext } from "./httpIsolation";

function reply(value: unknown, status = 200): Response {
	return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
		"X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
		"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "X-Frame-Options": "DENY" } });
}

async function readOperation(request: Request, signal: AbortSignal): Promise<GatewayDocumentOperation> {
	if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
		|| (request.headers.has("content-encoding") && request.headers.get("content-encoding") !== "identity")) throw new GatewayDocumentError(415);
	const length = request.headers.get("content-length");
	if (length !== null && (!/^\d+$/.test(length) || Number(length) > 32768)) throw new GatewayDocumentError(413);
	if (!request.body) throw new GatewayDocumentError(400);
	const reader = request.body.getReader();
	let abort: () => void = () => {};
	const cancelled = new Promise<never>((_, reject) => {
		abort = () => { void reader.cancel().catch(() => {}); reject(new GatewayDocumentError(503)); };
		signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
	});
	const parts: Uint8Array[] = []; let bytes = 0;
	try {
		while (true) {
			const part = await Promise.race([reader.read(), cancelled]); if (part.done) break;
			bytes += part.value.byteLength; if (bytes > 32768) throw new GatewayDocumentError(413); parts.push(part.value);
		}
		if (signal.aborted) throw new GatewayDocumentError(503);
		return GatewayDocumentOperation.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))));
	} catch (error) { throw error instanceof GatewayDocumentError ? error : new GatewayDocumentError(400); }
	finally { signal.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Reserved same-origin broker. Never forwards a data request to customer code. */
export class GatewayBrowserDocuments {
	readonly #control: GatewayControlClient;
	readonly #policy: GatewayHttpIsolation;
	readonly #lifetime = new AbortController();
	#pending = 0;
	constructor(context: GatewayHttpContext, control: GatewayControlOptions, transport: GatewayFetch = (url, init) => fetch(url, init)) {
		if (context.bindingId.toLowerCase() !== control.bindingId.toLowerCase()
			|| secureOrigin(context.appOrigin).hostname === secureOrigin(control.platformOrigin).hostname) throw new GatewayDocumentError(503);
		this.#policy = new GatewayHttpIsolation(context); this.#control = new GatewayControlClient(control, transport);
	}
	async handle(request: Request): Promise<Response | null> {
		if (new URL(request.url).pathname !== "/__smartdeploy/documents") return null;
		if (this.#lifetime.signal.aborted || request.signal.aborted || this.#pending >= 2) return reply({ error: "App data operation unavailable." }, 503);
		this.#pending++;
		const controller = new AbortController(); const stop = () => controller.abort();
		const timer = setTimeout(stop, 5000);
		request.signal.addEventListener("abort", stop, { once: true }); this.#lifetime.signal.addEventListener("abort", stop, { once: true });
		try {
			if (request.signal.aborted || this.#lifetime.signal.aborted) stop();
			this.#policy.assertDocumentRequest(request);
			const token = sessionToken(request.headers.get("cookie")); if (!token) throw new GatewayDocumentError(401);
			const operation = await readOperation(request, controller.signal);
			return reply(await this.#control.document(token, operation, controller.signal));
		} catch (error) { return reply({ error: "App data operation unavailable." }, error instanceof GatewayDocumentError || error instanceof GatewayHttpError ? error.status : 503); }
		finally {
			this.#pending--; clearTimeout(timer); controller.abort(); request.signal.removeEventListener("abort", stop);
			this.#lifetime.signal.removeEventListener("abort", stop); void request.body?.cancel().catch(() => {});
		}
	}
	close(): void { this.#lifetime.abort(); }
}
