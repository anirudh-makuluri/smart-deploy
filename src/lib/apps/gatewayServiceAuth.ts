import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { WorkspaceError } from "./workspaceStore";

export interface GatewayServiceCredential { id: string; token: string; secretHash: string }
export interface GatewayPrincipal { bindingId: string }

/** Operator provisioning helper only. Do not log/commit the returned token. */
export function createGatewayServiceCredential(): GatewayServiceCredential {
	const id = randomUUID();
	const secret = randomBytes(32).toString("base64url");
	return { id, token: `sd_gateway_${id}.${secret}`, secretHash: createHash("sha256").update(secret, "utf8").digest("hex") };
}

export async function authenticateGateway(pool: Pool, authorization: string | null): Promise<GatewayPrincipal> {
	const match = /^Bearer sd_gateway_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i.exec(authorization ?? "");
	if (!match) throw new WorkspaceError(401, "Gateway authentication required.");
	const result = await pool.query<GatewayPrincipal>(`
		select binding_id as "bindingId" from public.authenticate_app_gateway_credential($1::uuid, $2::text)
	`, [match[1], createHash("sha256").update(match[2], "utf8").digest("hex")]);
	if (!result.rows[0]) throw new WorkspaceError(401, "Gateway authentication required.");
	return result.rows[0];
}
