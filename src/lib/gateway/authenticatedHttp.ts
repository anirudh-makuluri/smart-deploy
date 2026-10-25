import { connect } from "node:tls";
import { GatewayBrowserAuth, type GatewayBrowserOptions } from "./browserAuth";
import { GatewayControlError, type GatewayFetch } from "./controlClient";
import { GatewayHttpError, GatewayHttpIsolation } from "./httpIsolation";
import { GatewayHttpLimits, GatewayProxyError } from "./httpLease";
import { GatewayHttpProxy, type GatewayHttpProxyOptions } from "./httpProxy";
import type { GatewayTlsDial } from "./upstreamTls";

export interface GatewayAuthenticatedHttpOptions extends GatewayHttpProxyOptions { browser: GatewayBrowserOptions }

function failure(status: number): Response {
	return Response.json({ error: "App access unavailable." }, { status, headers: {
		"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
		"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "X-Frame-Options": "DENY", "Cross-Origin-Resource-Policy": "same-origin",
	} });
}
function documentNavigation(request: Request): boolean {
	if (request.method !== "GET") return false;
	const mode = request.headers.get("sec-fetch-mode"); const destination = request.headers.get("sec-fetch-dest");
	return (mode === "navigate" && destination === "document") || (mode === null && destination === null && request.headers.get("accept")?.includes("text/html") === true);
}

/** One trusted registered runtime. Identity has no caller-supplied override.
 * Registry must retire this instance when the authoritative route changes. */
export class GatewayAuthenticatedHttp {
	readonly #auth: GatewayBrowserAuth;
	readonly #policy: GatewayHttpIsolation;
	readonly #proxy: GatewayHttpProxy;
	readonly #origin: string;
	readonly #maximum: number;
	#pending = 0;
	#closed = false;
	constructor(options: GatewayAuthenticatedHttpOptions, transport: GatewayFetch = (url, init) => fetch(url, init), dial: GatewayTlsDial = (configuration) => connect(configuration)) {
		try {
			if (options.browser.appOrigin !== options.context.appOrigin || options.browser.bindingId.toLowerCase() !== options.context.bindingId.toLowerCase()) throw new Error();
			this.#auth = new GatewayBrowserAuth(options.browser, transport);
			this.#policy = new GatewayHttpIsolation(options.context); this.#proxy = new GatewayHttpProxy(options, dial);
			this.#origin = options.context.appOrigin; this.#maximum = GatewayHttpLimits.parse(options.limits).maxConnections;
		} catch { throw new GatewayProxyError(503); }
	}

	async handle(request: Request): Promise<Response> {
		let forwarding = false;
		if (this.#closed || request.signal.aborted || this.#pending >= this.#maximum) { void request.body?.cancel().catch(() => {}); return failure(503); }
		this.#pending++;
		try {
			const reserved = await this.#auth.handle(request);
			if (this.#closed || request.signal.aborted) return failure(503);
			if (reserved) return reserved;
			this.#policy.assertBrowserRequest(request);
			const identity = await this.#auth.identity(request);
			if (this.#closed || request.signal.aborted) return failure(503);
			if (!identity) return await this.#login(request);
			forwarding = true;
			return await this.#proxy.forward(request, identity);
		} catch (error) {
			return failure(error instanceof GatewayControlError || error instanceof GatewayHttpError || error instanceof GatewayProxyError ? error.status : 503);
		} finally { this.#pending--; if (!forwarding) void request.body?.cancel().catch(() => {}); }
	}

	async #login(request: Request): Promise<Response> {
		if (!documentNavigation(request)) return failure(401);
		const current = new URL(request.url); const login = new URL("/__smartdeploy/login", this.#origin);
		login.searchParams.set("returnPath", current.pathname + current.search);
		return await this.#auth.handle(new Request(login, { headers: request.headers, signal: request.signal })) ?? failure(503);
	}

	close(): void { this.#closed = true; this.#proxy.close(); }
}
