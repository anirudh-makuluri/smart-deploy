import { NextResponse } from "next/server";
import { z } from "zod";
import config from "@/config";
import { dbHelper } from "@/db-helper";
import { getDbPool } from "@/lib/dbPool";
import { GatewayAuthStore } from "./gatewayAuthStore";
import { authenticateGateway } from "./gatewayServiceAuth";
import { WorkspaceError } from "./workspaceStore";
import type { AppUseIdentity } from "./appStore";

const Secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const GatewaySessionInput = z.strictObject({ token: Secret });
export const GatewayRedemptionInput = z.strictObject({ code: Secret, verifier: Secret, callbackUrl: z.string().max(300) });
const MAX_BODY_BYTES = 4096;
const BODY_TIMEOUT_MS = 5000;
interface GatewayApiContext { bindingId: string; store: GatewayAuthStore }

export function gatewayJson(value: unknown, status = 200): NextResponse {
	return NextResponse.json(value, { status, headers: {
		"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
		...(status === 401 ? { "WWW-Authenticate": 'Bearer realm="smartdeploy-gateway"' } : {}),
	} });
}

/** Bound actual streamed bytes, including when Content-Length is missing or false. */
export async function parseGatewayBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
	if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
		|| (request.headers.has("content-encoding") && request.headers.get("content-encoding") !== "identity")) {
		throw new WorkspaceError(415, "Uncompressed JSON required.");
	}
	const length = request.headers.get("content-length");
	if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new WorkspaceError(413, "Request body too large.");
	if (!request.body) throw new WorkspaceError(400, "Invalid JSON.");
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new WorkspaceError(408, "Request body timed out.")), BODY_TIMEOUT_MS); });
	try {
		while (true) {
			const part = await Promise.race([reader.read(), deadline]);
			if (part.done) break;
			size += part.value.byteLength;
			if (size > MAX_BODY_BYTES) throw new WorkspaceError(413, "Request body too large.");
			chunks.push(part.value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
		const result = schema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
		if (!result.success) throw new WorkspaceError(400, "Invalid request fields.");
		return result.data;
	} catch (error) {
		if (error instanceof WorkspaceError) throw error;
		throw new WorkspaceError(400, "Invalid JSON.");
	} finally {
		clearTimeout(timer);
		void reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

export function gatewayLifetimes() {
	const code = config.GATEWAY_CODE_TTL_SECONDS;
	const session = config.GATEWAY_SESSION_TTL_SECONDS;
	if (!/^\d+$/.test(code) || !/^\d+$/.test(session) || Number(code) < 1 || Number(code) > 120 || Number(session) < 1 || Number(session) > 3600) {
		throw new WorkspaceError(503, "Gateway configuration unavailable.");
	}
	return { codeSeconds: Number(code), sessionSeconds: Number(session) };
}

export async function requireGatewayIdentity(store: GatewayAuthStore, bindingId: string, token: string): Promise<AppUseIdentity> {
	const identity = await store.authorize(bindingId, token);
	if (!identity) throw new WorkspaceError(403, "App access unavailable.");
	if (config.WAITING_LIST_ENABLED) {
		const approval = await dbHelper.isApprovedUser(identity.email);
		if (approval.error) throw new WorkspaceError(503, "App authorization unavailable.");
		if (!approval.approved) throw new WorkspaceError(403, "App access unavailable.");
	}
	return identity;
}

export async function withGatewayApi(request: Request, action: (context: GatewayApiContext) => Promise<NextResponse>): Promise<NextResponse> {
	try {
		if (!config.WORKSPACE_APPS_ENABLED || !config.PRIVATE_APP_GATEWAY_ENABLED) throw new WorkspaceError(503, "Private gateway is not enabled.");
		if (request.method !== "POST" || new URL(request.url).protocol !== "https:" || new URL(request.url).search
			|| ["origin", "cookie", "sec-fetch-site"].some((name) => request.headers.has(name))) {
			throw new WorkspaceError(403, "A secure gateway service request is required.");
		}
		const limits = gatewayLifetimes();
		const pool = getDbPool();
		const principal = await authenticateGateway(pool, request.headers.get("authorization"));
		return await action({ bindingId: principal.bindingId, store: new GatewayAuthStore(pool, limits) });
	} catch (error) {
		if (error instanceof WorkspaceError) return gatewayJson({ error: error.message }, error.status);
		// Request bodies/credentials and database errors can contain secrets.
		console.error("Gateway authorization request failed.");
		return gatewayJson({ error: "Gateway authorization unavailable." }, 503);
	}
}
