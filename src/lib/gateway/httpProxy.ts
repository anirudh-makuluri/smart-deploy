import { connect } from "node:tls";
import { GatewayHttpError, GatewayHttpIsolation, type GatewayHttpContext } from "./httpIsolation";
import { contentLength, GatewayHttpLimits, GatewayProxyError, HttpLease } from "./httpLease";
import { httpExchange } from "./httpExchange";
import { GatewayUpstreamTls, GatewayUpstreamError, type GatewayTlsDial, type GatewayUpstreamOptions } from "./upstreamTls";
import type { GatewayIdentity } from "./controlClient";

export interface GatewayHttpProxyOptions { context: GatewayHttpContext; upstream: GatewayUpstreamOptions; limits: GatewayHttpLimits }

/** Trusted fixed runtime only. Caller must freshly authorize identity and resolve
 * the current runtime before forwarding; handle reserved browser routes first. */
export class GatewayHttpProxy {
	readonly #policy: GatewayHttpIsolation;
	readonly #upstream: GatewayUpstreamTls;
	readonly #limits: GatewayHttpLimits;
	readonly #leases = new Set<HttpLease>();
	#closed = false;
	constructor(options: GatewayHttpProxyOptions, dial: GatewayTlsDial = (configuration) => connect(configuration)) {
		try {
			this.#policy = new GatewayHttpIsolation(options.context); this.#upstream = new GatewayUpstreamTls(options.upstream, dial);
			if (options.context.bindingId.toLowerCase() !== options.upstream.bindingId.toLowerCase() || options.context.environment !== options.upstream.environment) throw new GatewayProxyError(503);
			this.#limits = GatewayHttpLimits.parse(options.limits);
		} catch { throw new GatewayProxyError(503); }
	}

	async forward(request: Request, currentIdentity: GatewayIdentity): Promise<Response> {
		let lease: HttpLease | null = null;
		try {
			const headers = this.#policy.requestHeaders(request, currentIdentity);
			const declared = contentLength(request.headers, this.#limits.maxRequestBytes, 400);
			if (!request.body && declared !== null && declared !== 0) throw new GatewayProxyError(400);
			const encoding = request.headers.get("transfer-encoding");
			if (encoding !== null && (encoding.toLowerCase() !== "chunked" || declared !== null)) throw new GatewayProxyError(400);
			if (this.#closed || request.signal.aborted || this.#leases.size >= this.#limits.maxConnections) throw new GatewayProxyError(503);
			const active = new HttpLease(request.signal, this.#limits, (finished) => this.#leases.delete(finished));
			lease = active; active.assert(); this.#leases.add(active);
			const socket = await this.#upstream.connect(active.signal); active.assert(); active.touch();
			headers.set("connection", "close");
			return await httpExchange(request, socket, headers, this.#policy, this.#limits, active, declared);
		} catch (error) {
			lease?.finish(); void request.body?.cancel().catch(() => {});
			if (lease?.error) throw lease.error;
			if (error instanceof GatewayUpstreamError) throw new GatewayProxyError(error.status);
			if (error instanceof GatewayHttpError || error instanceof GatewayProxyError) throw error;
			throw new GatewayProxyError(502);
		}
	}

	/** Registry must retire this instance on runtime/route replacement. */
	close(): void { this.#closed = true; for (const lease of this.#leases) lease.fail(503); }
}
