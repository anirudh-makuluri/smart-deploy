import { z } from "zod";

export const GatewayHttpLimits = z.strictObject({
	maxRequestBytes: z.number().int().min(1).max(1048576), maxResponseBytes: z.number().int().min(1).max(10485760),
	timeoutMs: z.number().int().min(1).max(30000), idleMs: z.number().int().min(1).max(5000),
	maxConnections: z.number().int().min(1).max(32),
});
export type GatewayHttpLimits = z.infer<typeof GatewayHttpLimits>;
export class GatewayProxyError extends Error {
	constructor(public readonly status: 400 | 413 | 502 | 503 | 504) { super("App request unavailable."); }
}

/** Lifetime includes TLS, upload, response headers, and consumption of the body. */
export class HttpLease {
	readonly #controller = new AbortController();
	readonly #input: AbortSignal;
	readonly #idleMs: number;
	readonly #deadline: ReturnType<typeof setTimeout>;
	readonly #release: (lease: HttpLease) => void;
	#idle: ReturnType<typeof setTimeout>;
	#done = false;
	error: GatewayProxyError | null = null;
	get signal(): AbortSignal { return this.#controller.signal; }
	constructor(input: AbortSignal, limits: GatewayHttpLimits, release: (lease: HttpLease) => void) {
		this.#input = input; this.#idleMs = limits.idleMs; this.#release = release;
		this.#deadline = setTimeout(() => this.fail(504), limits.timeoutMs);
		this.#idle = setTimeout(() => this.fail(504), limits.idleMs);
		input.addEventListener("abort", this.#cancel, { once: true });
		if (input.aborted) this.#cancel();
	}
	#cancel = () => this.fail(503);
	assert(): void { if (this.#done) throw this.error ?? new GatewayProxyError(503); }
	touch(): void { if (!this.#done) { clearTimeout(this.#idle); this.#idle = setTimeout(() => this.fail(504), this.#idleMs); } }
	fail(status: GatewayProxyError["status"]): void { if (!this.#done) { this.error = new GatewayProxyError(status); this.finish(); } }
	finish(): void {
		if (this.#done) return;
		this.#done = true; clearTimeout(this.#deadline); clearTimeout(this.#idle);
		this.#input.removeEventListener("abort", this.#cancel); this.#controller.abort(); this.#release(this);
	}
}

export function contentLength(headers: Headers, maximum: number, status: 400 | 502): number | null {
	const length = headers.get("content-length");
	if (length === null) return null;
	if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) throw new GatewayProxyError(status);
	if (Number(length) > maximum) throw new GatewayProxyError(status === 400 ? 413 : 502);
	return Number(length);
}
