import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { Pool } from "pg";
import { z } from "zod";
import { authenticateGateway } from "../apps/gatewayServiceAuth";
import { AppRuntimeStore } from "../apps/runtimeStore";
import { getAwsClientConfig } from "../aws/sdkClients";
import { GatewayAuthenticatedHttp } from "./authenticatedHttp";
import { secureOrigin, type GatewayFetch } from "./controlClient";
import { ManagedGatewayError, ManagedGatewayOptions, managedSelection, managedUpstream } from "./managedRouteSchema";
import type { GatewayNativeRoute } from "./nativeServer";
import { GatewayUpstreamTls, type GatewayTlsDial } from "./upstreamTls";

export interface ManagedGatewayRoute extends GatewayNativeRoute { runtimeId: string; generation: number }
const Credential = /^sd_gateway_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/i;

/** Operator-owned loader only. No listener, polling, activation or provisioning. */
export class ManagedGatewayLoader {
	readonly #options: ManagedGatewayOptions;
	readonly #store: AppRuntimeStore;
	readonly #ssm: SSMClient;
	readonly #pending = new Set<AbortController>();
	readonly #routes = new Set<GatewayAuthenticatedHttp>();
	#closed = false;
	constructor(private readonly pool: Pool, options: ManagedGatewayOptions) {
		try { this.#options = ManagedGatewayOptions.parse(options); secureOrigin(this.#options.platformOrigin); this.#store = new AppRuntimeStore(pool, this.#options.scope); }
		catch { throw new ManagedGatewayError(); }
		this.#ssm = new SSMClient({ ...getAwsClientConfig(this.#options.scope.region), endpoint: `https://ssm.${this.#options.scope.region}.amazonaws.com`,
			maxAttempts: 1, requestHandler: { connectionTimeout: 1000, requestTimeout: 1800, throwOnRequestTimeout: true, httpsAgent: { keepAlive: true, maxSockets: 1 } } });
	}
	async load(signal: AbortSignal, transport: GatewayFetch = (url, init) => fetch(url, init), dial: GatewayTlsDial | undefined = undefined): Promise<ManagedGatewayRoute> {
		if (this.#closed || signal.aborted || this.#pending.size || this.#routes.size >= 2) throw new ManagedGatewayError();
		const controller = new AbortController(); this.#pending.add(controller);
		const expire = () => controller.abort();
		let rejectAborted = () => {};
		const aborted = new Promise<never>((_, reject) => { rejectAborted = () => reject(new ManagedGatewayError()); });
		const timer = setTimeout(expire, this.#options.timeoutMs); signal.addEventListener("abort", expire, { once: true });
		controller.signal.addEventListener("abort", rejectAborted, { once: true });
		if (signal.aborted) expire();
		const work = this.#load(controller.signal, transport, dial);
		void work.finally(() => this.#pending.delete(controller)).catch(() => {});
		try { return await Promise.race([work, aborted]); }
		catch { throw new ManagedGatewayError(); }
		finally { clearTimeout(timer); signal.removeEventListener("abort", expire); controller.signal.removeEventListener("abort", rejectAborted); controller.abort(); }
	}
	async #load(signal: AbortSignal, transport: GatewayFetch, dial: GatewayTlsDial | undefined): Promise<ManagedGatewayRoute> {
		signal.throwIfAborted(); const options = this.#options;
		const current = await this.#store.current(options.appId, options.environment); signal.throwIfAborted();
		if (!current) throw new ManagedGatewayError();
		const upstream = managedUpstream(current, options);
		const parameter = (await this.#ssm.send(new GetParameterCommand({ Name: current.credentialParameter, WithDecryption: true }), { abortSignal: signal })).Parameter;
		signal.throwIfAborted();
		const arn = `arn:aws:ssm:${options.scope.region}:${options.scope.accountId}:parameter${current.credentialParameter}`;
		const credential = Credential.exec(parameter?.Value ?? "");
		if (parameter?.Type !== "SecureString" || parameter.Name !== current.credentialParameter || parameter.ARN !== arn
			|| !z.number().int().positive().safeParse(parameter.Version).success || parameter.Selector || !parameter.Value
			|| !credential || credential[0] !== parameter.Value || credential[1].toLowerCase() !== current.credentialId.toLowerCase()) throw new ManagedGatewayError();
		const principal = await authenticateGateway(this.pool, "Bearer " + parameter.Value); signal.throwIfAborted();
		if (principal.bindingId !== current.bindingId) throw new ManagedGatewayError();
		const probe = await new GatewayUpstreamTls(upstream, dial).connect(signal); probe.destroy(); signal.throwIfAborted();
		const latest = await this.#store.current(options.appId, options.environment); signal.throwIfAborted();
		if (!latest || managedSelection(latest) !== managedSelection(current)) throw new ManagedGatewayError();
		const gateway = new GatewayAuthenticatedHttp({ context: { appOrigin: current.origin, bindingId: current.bindingId, environment: current.environment },
			browser: { appOrigin: current.origin, platformOrigin: options.platformOrigin, bindingId: current.bindingId, serviceCredential: parameter.Value,
				timeoutMs: options.controlTimeoutMs, transactions: { ttlSeconds: 60, maxEntries: 32 } }, upstream, limits: options.limits, documentsEnabled: options.documentsEnabled }, transport, dial);
		this.#routes.add(gateway);
		return { origin: current.origin, runtimeId: current.id, generation: current.generation, handle: request => gateway.handle(request),
			close: () => { gateway.close(); this.#routes.delete(gateway); } };
	}
	close(): void { if (this.#closed) return; this.#closed = true; for (const pending of this.#pending) pending.abort(); for (const route of this.#routes) route.close(); this.#routes.clear(); this.#ssm.destroy(); }
}
