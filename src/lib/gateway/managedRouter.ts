import { z } from "zod";
import type { ManagedGatewayRoute } from "./managedRoute";
import { ManagedGatewayError } from "./managedRouteSchema";
import type { GatewayNativeRoute } from "./nativeServer";

export interface ManagedRouteLoader { load(signal: AbortSignal): Promise<ManagedGatewayRoute> }
export const ManagedRouterTiming = z.strictObject({ refreshMs: z.number().int().min(100).max(5000),
	maxAgeMs: z.number().int().min(1000).max(10000), expiresAt: z.number().int().positive() })
	.refine(value => value.maxAgeMs >= value.refreshMs * 2);
export type ManagedRouterTiming = z.infer<typeof ManagedRouterTiming>;

function unavailable(): Response {
	return Response.json({ error: "App access unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store",
		"Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
		"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "X-Frame-Options": "DENY" } });
}

/** One fixed app origin. Fresh selection replaces and closes the old gateway.
 * The expiry stops serving; durable AWS resource teardown is still required. */
export class ManagedGatewayRouter implements GatewayNativeRoute {
	readonly origin: string;
	readonly #timing: ManagedRouterTiming;
	readonly #expiry: ReturnType<typeof setTimeout>;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#pending: AbortController | null = null;
	#route: ManagedGatewayRoute | null;
	#verifiedAt: number;
	#closed = false;
	private constructor(private readonly loader: ManagedRouteLoader, initial: ManagedGatewayRoute, timing: ManagedRouterTiming, private readonly now: () => number) {
		this.origin = initial.origin; this.#route = initial; this.#timing = timing; this.#verifiedAt = now();
		this.#expiry = setTimeout(() => this.close(), timing.expiresAt - now()); this.#expiry.unref(); this.#schedule();
	}
	static async open(loader: ManagedRouteLoader, timing: ManagedRouterTiming, signal: AbortSignal, now: () => number = Date.now): Promise<ManagedGatewayRouter> {
		let initial: ManagedGatewayRoute | null = null;
		try {
			const parsed = ManagedRouterTiming.parse(timing); const remaining = parsed.expiresAt - now();
			if (remaining <= 0 || remaining > 2 * 60 * 60 * 1000 || signal.aborted) throw new ManagedGatewayError();
			initial = await loader.load(signal);
			if (signal.aborted || now() >= parsed.expiresAt) throw new ManagedGatewayError();
			return new ManagedGatewayRouter(loader, initial, parsed, now);
		} catch { initial?.close(); throw new ManagedGatewayError(); }
	}
	#schedule(): void { if (!this.#closed) { this.#timer = setTimeout(() => { void this.refresh(); }, this.#timing.refreshMs); this.#timer.unref(); } }
	#drop(): void { this.#route?.close(); this.#route = null; }
	async refresh(): Promise<void> {
		if (this.#closed || this.#pending) return;
		clearTimeout(this.#timer); const controller = new AbortController(); this.#pending = controller;
		let candidate: ManagedGatewayRoute | null = null;
		try {
			candidate = await this.loader.load(controller.signal);
			if (this.#closed || this.now() >= this.#timing.expiresAt || candidate.origin !== this.origin) throw new ManagedGatewayError();
			if (this.#route?.runtimeId === candidate.runtimeId && this.#route.generation === candidate.generation) candidate.close();
			else { this.#drop(); this.#route = candidate; }
			candidate = null; this.#verifiedAt = this.now();
		} catch { candidate?.close(); this.#drop(); }
		finally { this.#pending = null; controller.abort(); this.#schedule(); }
	}
	async handle(request: Request): Promise<Response> {
		if (this.now() >= this.#timing.expiresAt) this.close();
		if (this.#closed || request.signal.aborted) return unavailable();
		if (this.now() - this.#verifiedAt > this.#timing.maxAgeMs) this.#drop();
		return this.#route ? this.#route.handle(request) : unavailable();
	}
	close(): void { if (this.#closed) return; this.#closed = true; clearTimeout(this.#timer); clearTimeout(this.#expiry); this.#pending?.abort(); this.#drop(); }
}
