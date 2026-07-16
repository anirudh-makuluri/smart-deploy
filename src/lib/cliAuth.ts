import { createHash, randomBytes } from "node:crypto";
import { getDbPool } from "@/lib/dbPool";

const DEVICE_AUTHORIZATION_LIFETIME_MS = 10 * 60 * 1000;
const CLI_TOKEN_PREFIX = "sd_cli_";

export type DeviceAuthorizationStatus = "pending" | "approved" | "consumed" | "expired";

export type DeviceAuthorizationSecrets = {
	deviceCode: string;
	approvalCode: string;
	expiresAt: Date;
};

export function hashCliSecret(secret: string): string {
	return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function createDeviceAuthorizationSecrets(now = new Date()): DeviceAuthorizationSecrets {
	return {
		deviceCode: randomBytes(32).toString("base64url"),
		approvalCode: randomBytes(32).toString("base64url"),
		expiresAt: new Date(now.getTime() + DEVICE_AUTHORIZATION_LIFETIME_MS),
	};
}

export function createCliAccessToken(): { token: string; tokenHash: string } {
	const token = CLI_TOKEN_PREFIX + randomBytes(32).toString("base64url");
	return { token, tokenHash: hashCliSecret(token) };
}

function codeHash(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error("Authentication code is required.");
	return hashCliSecret(normalized);
}

export async function startDeviceAuthorization(): Promise<DeviceAuthorizationSecrets> {
	const authorization = createDeviceAuthorizationSecrets();
	await getDbPool().query(
		"insert into public.cli_device_authorizations (device_code_hash, approval_code_hash, status, expires_at) values ($1, $2, 'pending', $3)",
		[hashCliSecret(authorization.deviceCode), hashCliSecret(authorization.approvalCode), authorization.expiresAt]
	);
	return authorization;
}

export async function getDeviceAuthorizationStatus(approvalCode: string): Promise<DeviceAuthorizationStatus | null> {
	const result = await getDbPool().query<{ status: DeviceAuthorizationStatus; expires_at: Date }>(
		"select status, expires_at from public.cli_device_authorizations where approval_code_hash = $1 limit 1",
		[codeHash(approvalCode)]
	);
	const authorization = result.rows[0];
	if (!authorization) return null;
	if (authorization.status === "pending" && authorization.expires_at.getTime() <= Date.now()) {
		await getDbPool().query("update public.cli_device_authorizations set status = 'expired' where approval_code_hash = $1 and status = 'pending'", [codeHash(approvalCode)]);
		return "expired";
	}
	return authorization.status;
}

export async function approveDeviceAuthorization(approvalCode: string, userId: string): Promise<DeviceAuthorizationStatus> {
	const result = await getDbPool().query<{ status: DeviceAuthorizationStatus }>(
		"update public.cli_device_authorizations set status = 'approved', user_id = $2, approved_at = now() where approval_code_hash = $1 and status = 'pending' and expires_at > now() returning status",
		[codeHash(approvalCode), userId]
	);
	if (result.rows[0]) return result.rows[0].status;
	const status = await getDeviceAuthorizationStatus(approvalCode);
	if (!status) throw new Error("This CLI approval request does not exist.");
	return status;
}

export async function consumeDeviceAuthorization(deviceCode: string): Promise<{ token: string; userId: string } | null> {
	const client = await getDbPool().connect();
	try {
		await client.query("begin");
		const consumed = await client.query<{ user_id: string }>(
			"update public.cli_device_authorizations set status = 'consumed', consumed_at = now() where device_code_hash = $1 and status = 'approved' and expires_at > now() returning user_id",
			[codeHash(deviceCode)]
		);
		const userId = consumed.rows[0]?.user_id;
		if (!userId) {
			await client.query("rollback");
			return null;
		}
		const accessToken = createCliAccessToken();
		await client.query("insert into public.cli_access_tokens (user_id, token_hash) values ($1, $2)", [userId, accessToken.tokenHash]);
		await client.query("commit");
		return { token: accessToken.token, userId };
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

export async function authenticateCliAccessToken(token: string): Promise<string | null> {
	const normalized = token.trim();
	if (!normalized.startsWith(CLI_TOKEN_PREFIX)) return null;
	const result = await getDbPool().query<{ user_id: string }>(
		"update public.cli_access_tokens set last_used_at = now() where token_hash = $1 and revoked_at is null and (expires_at is null or expires_at > now()) returning user_id",
		[hashCliSecret(normalized)]
	);
	return result.rows[0]?.user_id ?? null;
}

export async function revokeCliAccessToken(token: string): Promise<boolean> {
	const result = await getDbPool().query("update public.cli_access_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null", [codeHash(token)]);
	return result.rowCount === 1;
}

export function getCliBearerToken(headers: Headers): string | null {
	const authorization = headers.get("authorization")?.trim() ?? "";
	const match = authorization.match(/^Bearer\s+(sd_cli_[A-Za-z0-9_-]+)$/);
	return match ? match[1] : null;
}

export async function requireCliUser(headers: Headers): Promise<string> {
	const token = getCliBearerToken(headers);
	if (!token) throw new Error("Unauthorized");
	const userId = await authenticateCliAccessToken(token);
	if (!userId) throw new Error("Unauthorized");
	return userId;
}
