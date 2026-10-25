import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { loadAppUseIdentity, type AppUseIdentity } from "./appStore";
import { requireId, withWorkspaceTransaction, WorkspaceError } from "./workspaceStore";
import type { AppEnvironment } from "./types";

export interface GatewayAuthLifetimes { codeSeconds: number; sessionSeconds: number }
export interface GatewayHandoff { code: string; callbackUrl: string; expiresAt: Date }
export interface GatewaySession { token: string; expiresAt: Date }
export interface PlatformSessionIdentity { userId: string; sessionId: string }
export interface GatewayAppInspection {
	bindingId: string;
	app: { id: string; name: string };
	workspace: { id: string; name: string };
	origin: string;
	environment: AppEnvironment;
	identity: AppUseIdentity;
}
interface GatewayBinding { id: string; appId: string; origin: string; environment: AppEnvironment }

const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CALLBACK_PATH = "/__smartdeploy/callback";

function secretHash(value: string): string {
	if (!SECRET_PATTERN.test(value)) throw new WorkspaceError(401, "Gateway credential unavailable.");
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function callbackUrl(origin: string): string {
	const url = new URL(origin);
	if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) {
		throw new WorkspaceError(503, "Gateway binding unavailable.");
	}
	return origin + CALLBACK_PATH;
}

/** Trusted server primitive only. Adapters must authenticate the browser for issue,
 * and authenticate the gateway independently for redeem/authorize/revoke. Binding
 * IDs, request Host headers, and possession of a code are not gateway authentication.
 */
export class GatewayAuthStore {
	private readonly lifetimes: GatewayAuthLifetimes;
	constructor(private readonly pool: Pool, lifetimes: GatewayAuthLifetimes) {
		if (!Number.isInteger(lifetimes.codeSeconds) || lifetimes.codeSeconds < 1 || lifetimes.codeSeconds > 120
			|| !Number.isInteger(lifetimes.sessionSeconds) || lifetimes.sessionSeconds < 1 || lifetimes.sessionSeconds > 3600) {
			throw new Error("Explicit gateway lifetimes required: code 1-120s, session 1-3600s.");
		}
		this.lifetimes = { ...lifetimes };
	}

	/** App-only waiting-list exception. Inherited management access is insufficient. */
	async isInvitedMember(bindingId: string, userId: string): Promise<boolean> {
		requireId(bindingId);
		const result = await this.pool.query(`
			select u.id from public.app_gateway_bindings b
			join public.apps a on a.id = b.app_id
			join public.app_workspaces w on w.id = a.workspace_id and w.kind = 'team' and w.owner_id <> $2
			join public.app_workspace_members m on m.workspace_id = w.id and m.user_id = $2 and m.role = 'member'
			join public."user" u on u.id = m.user_id and u."emailVerified" = true
			join public.app_use_grants g on g.app_id = a.id and g.user_id = u.id
			where b.id = $1 and b.disabled_at is null and b.environment = 'published' and exists (
				select 1 from public.app_workspace_invitations i where i.workspace_id = w.id
				and i.accepted_by = u.id and i.accepted_at is not null and i.revoked_at is null
				and i.role = 'member' and i.email = lower(trim(u.email))
			)
		`, [bindingId, userId]);
		return result.rowCount === 1;
	}

	private async binding(client: PoolClient, bindingId: string): Promise<GatewayBinding> {
		requireId(bindingId);
		// Match the workspace lock order used by role, grant, and membership mutations.
		const lookup = await client.query<{ workspaceId: string }>(`
			select a.workspace_id as "workspaceId" from public.app_gateway_bindings b
			join public.apps a on a.id = b.app_id where b.id = $1
		`, [bindingId]);
		if (!lookup.rows[0]) throw new WorkspaceError(401, "Gateway credential unavailable.");
		await client.query("select id from public.app_workspaces where id = $1 for update", [lookup.rows[0].workspaceId]);
		const result = await client.query<GatewayBinding>(`
			select b.id, b.app_id as "appId", b.origin, b.environment from public.app_gateway_bindings b
			join public.apps a on a.id = b.app_id
			where b.id = $1 and b.disabled_at is null and a.workspace_id = $2 for share of b, a
		`, [bindingId, lookup.rows[0].workspaceId]);
		if (!result.rows[0]) throw new WorkspaceError(401, "Gateway credential unavailable.");
		if (result.rows[0].environment !== "published" && result.rows[0].environment !== "preview") {
			throw new WorkspaceError(503, "Gateway binding unavailable.");
		}
		callbackUrl(result.rows[0].origin);
		return result.rows[0];
	}

	private async identity(client: PoolClient, binding: GatewayBinding, userId: string): Promise<AppUseIdentity> {
		await client.query('select id from public."user" where id = $1 for share', [userId]);
		const identity = await loadAppUseIdentity(client, binding.appId, userId, binding.environment);
		if (!identity) throw new WorkspaceError(403, "App access unavailable.");
		return identity;
	}

	private async authorizedPlatformSession(client: PoolClient, binding: GatewayBinding, principal: PlatformSessionIdentity, expectedIdentity: AppUseIdentity | null = null): Promise<Date> {
		// Lock the platform session before the user, matching logout's delete/trigger.
		const result = await client.query<{ userId: string; expiresAt: Date }>(`
			select "userId", "expiresAt" from public.session where id = $1 and "userId" = $2
			and "expiresAt" > clock_timestamp() for share
		`, [principal.sessionId, principal.userId]);
		if (!result.rows[0]) throw new WorkspaceError(401, "Platform session unavailable.");
		const identity = await this.identity(client, binding, result.rows[0].userId);
		if (expectedIdentity && (identity.id !== expectedIdentity.id || identity.email !== expectedIdentity.email)) {
			throw new WorkspaceError(409, "Your account changed. Restart app sign-in.");
		}
		return result.rows[0].expiresAt;
	}

	/** Read-only display snapshot, protected by the same current session/role locks as issuance. */
	async inspect(bindingId: string, principal: PlatformSessionIdentity): Promise<GatewayAppInspection> {
		return withWorkspaceTransaction(this.pool, async (client) => {
			const binding = await this.binding(client, bindingId);
			await this.authorizedPlatformSession(client, binding, principal);
			const result = await client.query<{ appName: string; workspaceId: string; workspaceName: string; email: string }>(`
				select a.name as "appName", w.id as "workspaceId", w.name as "workspaceName", u.email
				from public.apps a join public.app_workspaces w on w.id = a.workspace_id
				join public."user" u on u.id = $2 where a.id = $1
			`, [binding.appId, principal.userId]);
			const details = result.rows[0];
			if (!details) throw new WorkspaceError(403, "App access unavailable.");
			return { bindingId: binding.id, app: { id: binding.appId, name: details.appName },
				workspace: { id: details.workspaceId, name: details.workspaceName }, origin: binding.origin,
				environment: binding.environment, identity: { id: principal.userId, email: details.email } };
		});
	}

	async issue(bindingId: string, principal: PlatformSessionIdentity, challenge: string, expectedIdentity: AppUseIdentity | null = null): Promise<GatewayHandoff> {
		if (!SECRET_PATTERN.test(challenge)) throw new WorkspaceError(400, "S256 challenge required.");
		return withWorkspaceTransaction(this.pool, async (client) => {
			const binding = await this.binding(client, bindingId);
			const platformExpiry = await this.authorizedPlatformSession(client, binding, principal, expectedIdentity);
			const code = randomBytes(32).toString("base64url");
			const result = await client.query<{ expiresAt: Date }>(`
				insert into public.app_gateway_codes (token_hash, binding_id, app_id, user_id, challenge, created_at, expires_at, platform_session_id)
				select $1, $2, $3, $4, $5, t, least(t + $6 * interval '1 second', $7::timestamptz), $8
				from (select clock_timestamp() as t) ts where $7::timestamptz > t
				returning expires_at as "expiresAt"
			`, [secretHash(code), bindingId, binding.appId, principal.userId, challenge, this.lifetimes.codeSeconds, platformExpiry, principal.sessionId]);
			if (!result.rows[0]) throw new WorkspaceError(401, "Platform session unavailable.");
			return { code, callbackUrl: callbackUrl(binding.origin), expiresAt: result.rows[0].expiresAt };
		});
	}

	async redeem(bindingId: string, exactCallbackUrl: string, code: string, verifier: string): Promise<GatewaySession> {
		const hash = secretHash(code);
		secretHash(verifier);
		const challenge = createHash("sha256").update(verifier, "utf8").digest("base64url");
		return withWorkspaceTransaction(this.pool, async (client) => {
			const binding = await this.binding(client, bindingId);
			if (exactCallbackUrl !== callbackUrl(binding.origin)) throw new WorkspaceError(401, "Gateway credential unavailable.");
			const lookup = await client.query<{ userId: string; sessionId: string }>(`
				select user_id as "userId", platform_session_id as "sessionId" from public.app_gateway_codes
				where token_hash = $1 and binding_id = $2 and app_id = $3 and challenge = $4 and expires_at > clock_timestamp()
			`, [hash, bindingId, binding.appId, challenge]);
			if (!lookup.rows[0]) throw new WorkspaceError(401, "Gateway credential unavailable.");
			const platformExpiry = await this.authorizedPlatformSession(client, binding, lookup.rows[0]);
			const consumed = await client.query(`
				delete from public.app_gateway_codes where token_hash = $1 and expires_at > clock_timestamp() returning token_hash
			`, [hash]);
			if (!consumed.rowCount) throw new WorkspaceError(401, "Gateway credential unavailable.");
			const token = randomBytes(32).toString("base64url");
			const result = await client.query<{ expiresAt: Date }>(`
				insert into public.app_gateway_sessions (token_hash, binding_id, app_id, user_id, created_at, expires_at, platform_session_id)
				select $1, $2, $3, $4, t, least(t + $5 * interval '1 second', $6::timestamptz), $7
				from (select clock_timestamp() as t) ts where $6::timestamptz > t
				returning expires_at as "expiresAt"
			`, [secretHash(token), bindingId, binding.appId, lookup.rows[0].userId, this.lifetimes.sessionSeconds, platformExpiry, lookup.rows[0].sessionId]);
			if (!result.rows[0]) throw new WorkspaceError(401, "Platform session unavailable.");
			return { token, expiresAt: result.rows[0].expiresAt };
		});
	}

	async authorize(bindingId: string, token: string): Promise<AppUseIdentity | null> {
		requireId(bindingId);
		if (!SECRET_PATTERN.test(token)) return null;
		// One current database snapshot for session, binding, identity, and policy.
		const result = await this.pool.query<AppUseIdentity>(`
			select u.id, u.email from public.app_gateway_sessions s
			join public.app_gateway_bindings b on b.id = s.binding_id and b.app_id = s.app_id and b.disabled_at is null
			and b.environment in ('published', 'preview')
			join public.apps a on a.id = s.app_id join public.app_workspaces w on w.id = a.workspace_id
			join public."user" u on u.id = s.user_id and u."emailVerified" = true
			join public.session p on p.id = s.platform_session_id and p."userId" = u.id and p."expiresAt" > clock_timestamp()
			left join public.app_workspace_members m on m.workspace_id = w.id and m.user_id = u.id
			where s.token_hash = $1 and s.binding_id = $2 and s.expires_at > clock_timestamp()
			and (w.owner_id = u.id or m.role = 'admin' or (b.environment = 'published' and m.role = 'member' and exists (
			  select 1 from public.app_use_grants g where g.app_id = a.id and g.user_id = u.id
			)))
		`, [secretHash(token), bindingId]);
		return result.rows[0] ?? null;
	}

	async revoke(bindingId: string, token: string): Promise<void> {
		requireId(bindingId);
		if (!SECRET_PATTERN.test(token)) return;
		await this.pool.query("delete from public.app_gateway_sessions where binding_id = $1 and token_hash = $2", [bindingId, secretHash(token)]);
	}

	async pruneExpired(): Promise<void> {
		await this.pool.query("delete from public.app_gateway_codes where expires_at <= clock_timestamp()");
		await this.pool.query("delete from public.app_gateway_sessions where expires_at <= clock_timestamp()");
	}
}
