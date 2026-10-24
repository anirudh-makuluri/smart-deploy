import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AppWorkspace, WorkspaceMemberRole, WorkspaceMembership, WorkspaceRole } from "./types";
import { workspaceRoleForUser } from "./permissions";

export class WorkspaceError extends Error {
	constructor(public readonly status: number, message: string) { super(message); }
}

export interface WorkspaceAccess {
	workspace: AppWorkspace;
	role: WorkspaceRole;
}

export interface WorkspaceInvitation {
	id: string;
	email: string;
	role: WorkspaceMemberRole;
	expiresAt: Date;
}

interface StoredInvitation extends WorkspaceInvitation {
	workspaceId: string;
	invitedBy: string;
	active: boolean;
}

export function requireId(value: string): void {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
		throw new WorkspaceError(400, "Invalid identifier.");
	}
}

function normalizeInvitationEmail(value: string): string {
	const email = value.trim().toLowerCase();
	if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new WorkspaceError(400, "A valid invitation email is required.");
	}
	return email;
}

function tokenHash(token: string): string {
	if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new WorkspaceError(410, "Invitation unavailable.");
	return createHash("sha256").update(token, "utf8").digest("hex");
}

const WORKSPACE_FIELDS = 'id, name, kind, owner_id as "ownerId"';

export async function withWorkspaceTransaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		const result = await action(client);
		await client.query("commit");
		return result;
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally { client.release(); }
}

export async function loadWorkspaceAccess(client: PoolClient, workspaceId: string, userId: string): Promise<WorkspaceAccess> {
	requireId(workspaceId);
	const result = await client.query<AppWorkspace>(`select ${WORKSPACE_FIELDS} from public.app_workspaces where id = $1 for update`, [workspaceId]);
	const workspace = result.rows[0];
	if (!workspace || !userId) throw new WorkspaceError(404, "Workspace not found.");
	const membership = await client.query<WorkspaceMembership>(
		'select workspace_id as "workspaceId", user_id as "userId", role from public.app_workspace_members where workspace_id = $1 and user_id = $2',
		[workspaceId, userId]
	);
	const role = workspaceRoleForUser(workspace, userId, membership.rows[0] ?? null);
	if (!role) throw new WorkspaceError(404, "Workspace not found.");
	return { workspace, role };
}

export function requireWorkspaceManager(access: WorkspaceAccess): void {
	if (access.role === "member") throw new WorkspaceError(403, "Workspace management permission required.");
}

export class WorkspaceStore {
	constructor(private readonly pool: Pool) {}

	private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
		return withWorkspaceTransaction(this.pool, action);
	}

	private async access(client: PoolClient, workspaceId: string, userId: string): Promise<WorkspaceAccess> {
		return loadWorkspaceAccess(client, workspaceId, userId);
	}

	private requireManager(access: WorkspaceAccess): void {
		requireWorkspaceManager(access);
	}

	async createWorkspace(userId: string, name: string): Promise<AppWorkspace> {
		const normalized = name.trim();
		if (!userId || !normalized || normalized.length > 120) throw new WorkspaceError(400, "A workspace name of 1-120 characters is required.");
		const result = await this.pool.query<AppWorkspace>(
			`insert into public.app_workspaces (name, kind, owner_id) values ($1, 'team', $2) returning ${WORKSPACE_FIELDS}`,
			[normalized, userId]
		);
		return result.rows[0];
	}

	async listWorkspaces(userId: string): Promise<Array<AppWorkspace & { role: WorkspaceRole }>> {
		const result = await this.pool.query<AppWorkspace & { role: WorkspaceRole }>(`
			select w.id, w.name, w.kind, w.owner_id as "ownerId",
			       case when w.owner_id = $1 then 'owner' else m.role end as role
			from public.app_workspaces w
			left join public.app_workspace_members m on m.workspace_id = w.id and m.user_id = $1
			where w.owner_id = $1 or m.user_id = $1 order by w.created_at, w.id
		`, [userId]);
		return result.rows;
	}

	async listMembers(workspaceId: string, actorId: string): Promise<Array<{ userId: string; email: string; role: WorkspaceRole }>> {
		return this.transaction(async (client) => {
			const access = await this.access(client, workspaceId, actorId);
			this.requireManager(access);
			const result = await client.query<{ userId: string; email: string; role: WorkspaceRole }>(`
				select u.id as "userId", u.email, 'owner' as role from public."user" u where u.id = $2
				union all
				select u.id as "userId", u.email, m.role from public.app_workspace_members m
				join public."user" u on u.id = m.user_id where m.workspace_id = $1 and m.user_id <> $2
			`, [workspaceId, access.workspace.ownerId]);
			return result.rows;
		});
	}

	async createInvitation(workspaceId: string, actorId: string, emailInput: string, role: WorkspaceMemberRole): Promise<WorkspaceInvitation & { token: string }> {
		const email = normalizeInvitationEmail(emailInput);
		if (role !== "admin" && role !== "member") throw new WorkspaceError(400, "Invalid membership role.");
		return this.transaction(async (client) => {
			const access = await this.access(client, workspaceId, actorId);
			this.requireManager(access);
			if (access.workspace.kind !== "team") throw new WorkspaceError(409, "Create a team workspace before inviting colleagues.");
			if (role === "admin" && access.role !== "owner") throw new WorkspaceError(403, "Only the owner can invite administrators.");
			const existing = await client.query(`
				select u.id from public."user" u where lower(u.email) = $2 and (
				  u.id = $3 or exists (select 1 from public.app_workspace_members m where m.workspace_id = $1 and m.user_id = u.id)
				)
			`, [workspaceId, email, access.workspace.ownerId]);
			if (existing.rowCount) throw new WorkspaceError(409, "This identity already belongs to the workspace.");
			const pending = await client.query<{ role: WorkspaceMemberRole }>("select role from public.app_workspace_invitations where workspace_id = $1 and email = $2 and accepted_at is null and revoked_at is null", [workspaceId, email]);
			if (pending.rows[0]?.role === "admin" && access.role !== "owner") {
				throw new WorkspaceError(403, "Only the owner can replace administrator invitations.");
			}
			await client.query("update public.app_workspace_invitations set revoked_at = clock_timestamp() where workspace_id = $1 and email = $2 and accepted_at is null and revoked_at is null", [workspaceId, email]);
			const token = randomBytes(32).toString("base64url");
			const result = await client.query<WorkspaceInvitation>(`
				insert into public.app_workspace_invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
				values ($1, $2, $3, $4, $5, clock_timestamp() + interval '24 hours')
				returning id, email, role, expires_at as "expiresAt"
			`, [workspaceId, email, role, tokenHash(token), actorId]);
			return { ...result.rows[0], token };
		});
	}

	async listInvitations(workspaceId: string, actorId: string): Promise<WorkspaceInvitation[]> {
		return this.transaction(async (client) => {
			this.requireManager(await this.access(client, workspaceId, actorId));
			const result = await client.query<WorkspaceInvitation>(`
				select id, email, role, expires_at as "expiresAt" from public.app_workspace_invitations
				where workspace_id = $1 and accepted_at is null and revoked_at is null and expires_at > clock_timestamp()
				order by created_at
			`, [workspaceId]);
			return result.rows;
		});
	}

	async revokeInvitation(workspaceId: string, actorId: string, invitationId: string): Promise<void> {
		requireId(invitationId);
		await this.transaction(async (client) => {
			const access = await this.access(client, workspaceId, actorId);
			this.requireManager(access);
			const result = await client.query(`
				update public.app_workspace_invitations set revoked_at = clock_timestamp()
				where id = $1 and workspace_id = $2 and accepted_at is null and revoked_at is null
				and (role = 'member' or $3 = 'owner') returning id
			`, [invitationId, workspaceId, access.role]);
			if (!result.rowCount) throw new WorkspaceError(404, "Invitation not found.");
		});
	}

	async acceptInvitation(userId: string, token: string, memberOnly = false): Promise<WorkspaceAccess> {
		const hash = tokenHash(token);
		return this.transaction(async (client) => {
			const lookup = await client.query<{ workspaceId: string }>('select workspace_id as "workspaceId" from public.app_workspace_invitations where token_hash = $1', [hash]);
			const workspaceId = lookup.rows[0]?.workspaceId;
			if (!workspaceId) throw new WorkspaceError(410, "Invitation unavailable.");
			const workspaceResult = await client.query<AppWorkspace>(`select ${WORKSPACE_FIELDS} from public.app_workspaces where id = $1 for update`, [workspaceId]);
			const workspace = workspaceResult.rows[0];
			const result = await client.query<StoredInvitation>(`
				select id, workspace_id as "workspaceId", email, role, invited_by as "invitedBy", expires_at as "expiresAt",
				       (accepted_at is null and revoked_at is null and expires_at > clock_timestamp()) as active
				from public.app_workspace_invitations where token_hash = $1 for update
			`, [hash]);
			const invitation = result.rows[0];
			if (!workspace || workspace.kind !== "team" || !invitation?.active) throw new WorkspaceError(410, "Invitation unavailable.");
			const identity = await client.query<{ email: string; emailVerified: boolean }>('select email, "emailVerified" from public."user" where id = $1 for share', [userId]);
			const user = identity.rows[0];
			if (!user?.emailVerified || user.email.trim().toLowerCase() !== invitation.email) {
				throw new WorkspaceError(403, "Sign in with the invitation's verified email address.");
			}
			if (memberOnly && invitation.role !== "member") throw new WorkspaceError(403, "Platform approval is required for administrator invitations.");
			// Recheck the inviter's authority, so removal/demotion invalidates outstanding grants.
			let inviter: WorkspaceAccess;
			try { inviter = await this.access(client, workspaceId, invitation.invitedBy); }
			catch (error) {
				if (error instanceof WorkspaceError) throw new WorkspaceError(410, "Invitation unavailable.");
				throw error;
			}
			if (inviter.role === "member" || (invitation.role === "admin" && inviter.role !== "owner")) {
				throw new WorkspaceError(410, "Invitation unavailable.");
			}
			const consumed = await client.query(`
				update public.app_workspace_invitations set accepted_at = clock_timestamp(), accepted_by = $2
				where id = $1 and accepted_at is null and revoked_at is null and expires_at > clock_timestamp() returning id
			`, [invitation.id, userId]);
			if (!consumed.rowCount) throw new WorkspaceError(410, "Invitation unavailable.");
			if (userId !== workspace.ownerId) {
				await client.query("insert into public.app_workspace_members (workspace_id, user_id, role) values ($1, $2, $3) on conflict (workspace_id, user_id) do nothing", [workspaceId, userId, invitation.role]);
			}
			return this.access(client, workspaceId, userId);
		});
	}

	async setMemberRole(workspaceId: string, actorId: string, memberId: string, role: WorkspaceMemberRole): Promise<void> {
		if (role !== "admin" && role !== "member") throw new WorkspaceError(400, "Invalid membership role.");
		await this.transaction(async (client) => {
			const access = await this.access(client, workspaceId, actorId);
			if (access.role !== "owner") throw new WorkspaceError(403, "Only the owner can change membership roles.");
			if (memberId === access.workspace.ownerId) throw new WorkspaceError(409, "Workspace ownership cannot be changed through membership roles.");
			const result = await client.query("update public.app_workspace_members set role = $3 where workspace_id = $1 and user_id = $2 returning user_id", [workspaceId, memberId, role]);
			if (!result.rowCount) throw new WorkspaceError(404, "Member not found.");
			await client.query("update public.app_workspace_invitations set revoked_at = clock_timestamp() where workspace_id = $1 and invited_by = $2 and accepted_at is null and revoked_at is null", [workspaceId, memberId]);
		});
	}

	async removeMember(workspaceId: string, actorId: string, memberId: string): Promise<void> {
		await this.transaction(async (client) => {
			const access = await this.access(client, workspaceId, actorId);
			if (memberId === access.workspace.ownerId) throw new WorkspaceError(409, "The workspace owner cannot be removed.");
			if (memberId !== actorId) this.requireManager(access);
			const target = await client.query<{ role: WorkspaceMemberRole }>("select role from public.app_workspace_members where workspace_id = $1 and user_id = $2", [workspaceId, memberId]);
			if (!target.rows[0]) throw new WorkspaceError(404, "Member not found.");
			if (target.rows[0].role === "admin" && memberId !== actorId && access.role !== "owner") {
				throw new WorkspaceError(403, "Only the owner can remove administrators.");
			}
			await client.query("delete from public.app_workspace_members where workspace_id = $1 and user_id = $2", [workspaceId, memberId]);
			await client.query(`
				update public.app_workspace_invitations set revoked_at = clock_timestamp()
				where workspace_id = $1 and accepted_at is null and revoked_at is null
				and (invited_by = $2 or email = (select lower(btrim(email)) from public."user" where id = $2))
			`, [workspaceId, memberId]);
		});
	}
}
