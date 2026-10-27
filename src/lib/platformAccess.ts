import config from "@/config";
import { dbHelper } from "@/db-helper";
import { getDbPool } from "@/lib/dbPool";
import type { QueryConfig } from "pg";

export interface PlatformIdentity { id: string; email: string; emailVerified: boolean }
// pg implements this per-query deadline, but its installed typings expose it only on connection options.
interface PlatformIdentityQuery extends QueryConfig<string[]> { query_timeout: number }

export class PlatformAccessError extends Error {
	constructor(readonly status: number, message: string) { super(message); }
}

/** Identity must come from a fresh auth/database lookup, never request fields or JWT claims. */
export async function requirePlatformAccess(identity: PlatformIdentity): Promise<void> {
	if (!identity.id || !identity.email) throw new PlatformAccessError(401, "Unauthorized.");
	if (identity.emailVerified !== true) throw new PlatformAccessError(403, "Verify your email before managing deployments.");
	if (!config.WAITING_LIST_ENABLED) return;
	try {
		const approval = await dbHelper.isApprovedUser(identity.email);
		if (approval.error) throw new PlatformAccessError(503, "Platform authorization unavailable.");
		if (!approval.approved) throw new PlatformAccessError(403, "Platform approval is required.");
	} catch (error) {
		if (error instanceof PlatformAccessError) throw error;
		throw new PlatformAccessError(503, "Platform authorization unavailable.");
	}
}

async function loadIdentity(text: string, values: string[]): Promise<PlatformIdentity> {
	try {
		const query: PlatformIdentityQuery = { text, values, query_timeout: 5000 };
		const result = await getDbPool().query<PlatformIdentity>(query);
		if (!result.rows[0]) throw new PlatformAccessError(401, "Unauthorized.");
		return result.rows[0];
	} catch (error) {
		if (error instanceof PlatformAccessError) throw error;
		throw new PlatformAccessError(503, "Platform authorization unavailable.");
	}
}

export async function requirePlatformUser(userId: string): Promise<PlatformIdentity> {
	const identity = await loadIdentity('select id, email, "emailVerified" from public."user" where id = $1', [userId]);
	await requirePlatformAccess(identity);
	return identity;
}

export async function requirePlatformSession(userId: string, sessionId: string): Promise<PlatformIdentity> {
	const identity = await loadIdentity(`
		select u.id, u.email, u."emailVerified" from public.session s
		join public."user" u on u.id = s."userId"
		where s.id = $1 and s."userId" = $2 and s."expiresAt" > clock_timestamp()
	`, [sessionId, userId]);
	await requirePlatformAccess(identity);
	return identity;
}
