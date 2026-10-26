import { z } from "zod";
import { GatewayDocumentOperation } from "../apps/documentApiSchema";
import { DocumentAddress, documentJson, type AppDocument } from "../apps/documentSchema";

const Secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const Identity = z.strictObject({
	id: z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/),
	email: z.string().min(1).max(254).regex(/^[^\u0000-\u001f\u007f]+$/),
});
const Redemption = z.strictObject({ token: Secret, expiresAt: z.iso.datetime({ offset: true }), identity: Identity });
const Authorization = z.strictObject({ identity: Identity });
const Revocation = z.strictObject({ revoked: z.literal(true) });
const SERVICE_CREDENTIAL = /^sd_gateway_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/i;
const MAX_RESPONSE_BYTES = 4096;
const Document = z.strictObject({ collection: DocumentAddress.shape.collection, id: DocumentAddress.shape.id,
	version: z.uuid(), json: z.string().max(8192) });
const DocumentReply = z.strictObject({ document: Document.nullable() });
const DeletedReply = z.strictObject({ deleted: z.literal(true) });
export type GatewayDocumentResult = { document: AppDocument | null } | { deleted: true };
interface RequestPolicy { maxBytes: number; signal: AbortSignal | undefined; documents: boolean }
const AUTH_POLICY: RequestPolicy = { maxBytes: MAX_RESPONSE_BYTES, signal: undefined, documents: false };

export class GatewayDocumentError extends Error {
	constructor(public readonly status: number) { super("App data operation unavailable."); }
}

export interface GatewayIdentity { id: string; email: string }
export interface GatewayRedemption { token: string; expiresAt: Date; identity: GatewayIdentity }
export interface GatewayControlOptions { platformOrigin: string; bindingId: string; serviceCredential: string; timeoutMs: number }
export type GatewayFetch = (url: URL, init: RequestInit) => Promise<Response>;

export class GatewayControlError extends Error {
	constructor(public readonly status: 401 | 403 | 503) { super(status === 503 ? "App authorization unavailable." : "App access unavailable."); }
}

export function secureOrigin(value: string): URL {
	let url: URL;
	try { url = new URL(value); }
	catch { throw new Error("Canonical HTTPS gateway origins required."); }
	if (url.protocol !== "https:" || url.origin !== value || url.username || url.password) throw new Error("Canonical HTTPS gateway origins required.");
	return url;
}

async function boundedJson(response: Response, signal: AbortSignal, maxBytes: number): Promise<unknown> {
	if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !response.body) {
		void response.body?.cancel().catch(() => {});
		throw new GatewayControlError(503);
	}
	const length = response.headers.get("content-length");
	if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
		void response.body.cancel().catch(() => {});
		throw new GatewayControlError(503);
	}
	const reader = response.body.getReader();
	const abort = () => { void reader.cancel().catch(() => {}); };
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.byteLength;
			if (size > maxBytes) throw new GatewayControlError(503);
			chunks.push(part.value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
		if (signal.aborted) throw new GatewayControlError(503);
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} finally { signal.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Machine-only transport. Caller headers and redirect targets are never accepted. */
export class GatewayControlClient {
	readonly #origin: string;
	readonly #credential: string;
	readonly #bindingId: string;
	readonly #timeoutMs: number;
	readonly #fetch: GatewayFetch;
	readonly #now: () => number;

	constructor(options: GatewayControlOptions, transport: GatewayFetch = (url, init) => fetch(url, init), now: () => number = Date.now) {
		this.#origin = secureOrigin(options.platformOrigin).origin;
		if (!z.uuid().safeParse(options.bindingId).success || typeof options.serviceCredential !== "string" || !SERVICE_CREDENTIAL.test(options.serviceCredential) || !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 5000) {
			throw new Error("Explicit gateway service credential and bounded deadline required.");
		}
		this.#credential = options.serviceCredential;
		this.#bindingId = options.bindingId;
		this.#timeoutMs = options.timeoutMs;
		this.#fetch = transport;
		this.#now = now;
	}

	async redeem(code: string, verifier: string, callbackUrl: string): Promise<GatewayRedemption> {
		if (!Secret.safeParse(code).success || !Secret.safeParse(verifier).success) throw new GatewayControlError(401);
		const result = await this.#request("/api/gateway/redeem", { code, verifier, callbackUrl }, Redemption);
		const expiresAt = new Date(result.expiresAt);
		const remaining = expiresAt.getTime() - this.#now();
		if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 3600000) throw new GatewayControlError(503);
		return { token: result.token, expiresAt, identity: result.identity };
	}

	async authorize(token: string): Promise<GatewayIdentity> {
		if (!Secret.safeParse(token).success) throw new GatewayControlError(401);
		return (await this.#request("/api/gateway/authorize", { token }, Authorization)).identity;
	}

	async revoke(token: string): Promise<void> {
		if (!Secret.safeParse(token).success) throw new GatewayControlError(401);
		await this.#request("/api/gateway/logout", { token }, Revocation);
	}

	async document(token: string, operation: GatewayDocumentOperation, signal: AbortSignal): Promise<GatewayDocumentResult> {
		if (!Secret.safeParse(token).success) throw new GatewayDocumentError(401);
		const parsed = GatewayDocumentOperation.safeParse(operation);
		if (!parsed.success) throw new GatewayDocumentError(400);
		if (parsed.data.action === "put") {
			try { documentJson(parsed.data.json); } catch { throw new GatewayDocumentError(400); }
		}
		const policy: RequestPolicy = { maxBytes: 32768, signal, documents: true };
		if (parsed.data.action === "remove") return this.#request("/api/gateway/documents", { ...parsed.data, token }, DeletedReply, policy);
		const result = await this.#request("/api/gateway/documents", { ...parsed.data, token }, DocumentReply, policy);
		const document = result.document;
		if (!document) { if (parsed.data.action === "put") throw new GatewayDocumentError(503); return result; }
		try {
			if (document.collection !== parsed.data.collection || document.id !== parsed.data.id || document.json !== documentJson(document.json)) throw new Error();
			if (parsed.data.action === "put" && (document.json !== documentJson(parsed.data.json) || document.version === parsed.data.expectedVersion)) throw new Error();
		} catch { throw new GatewayDocumentError(503); }
		return result;
	}

	async #request<T>(path: string, body: unknown, schema: z.ZodType<T>, policy: RequestPolicy = AUTH_POLICY): Promise<T> {
		const controller = new AbortController();
		const failure = (status: number) => policy.documents ? new GatewayDocumentError([400, 401, 403, 404, 409, 410, 413, 415, 429].includes(status) ? status : 503)
			: new GatewayControlError(status === 401 || status === 403 ? status : 503);
		let timer: ReturnType<typeof setTimeout> | undefined;
		let abort: () => void = () => {};
		const deadline = new Promise<never>((_, reject) => {
			abort = () => { controller.abort(); reject(failure(503)); };
			timer = setTimeout(abort, this.#timeoutMs);
			policy.signal?.addEventListener("abort", abort, { once: true });
			if (policy.signal?.aborted) abort();
		});
		const work = async (): Promise<T> => {
			if (controller.signal.aborted) throw failure(503);
			const response = await this.#fetch(new URL(path, this.#origin), {
				method: "POST", headers: { authorization: `Bearer ${this.#credential}`, "content-type": "application/json", "x-smartdeploy-binding-id": this.#bindingId },
				body: JSON.stringify(body), redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal,
			});
			if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new GatewayControlError(503); }
			if (response.redirected || (response.url && response.url !== new URL(path, this.#origin).href)) {
				void response.body?.cancel().catch(() => {});
				throw new GatewayControlError(503);
			}
			if (response.status !== 200) {
				void response.body?.cancel().catch(() => {});
				throw failure(response.status);
			}
			const result = schema.safeParse(await boundedJson(response, controller.signal, policy.maxBytes));
			if (!result.success) throw new GatewayControlError(503);
			return result.data;
		};
		try { return await Promise.race([work(), deadline]); }
		catch (error) { throw error instanceof GatewayDocumentError || (!policy.documents && error instanceof GatewayControlError) ? error : failure(503); }
		finally { clearTimeout(timer); policy.signal?.removeEventListener("abort", abort); controller.abort(); }
	}
}
