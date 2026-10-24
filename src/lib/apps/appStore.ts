import type { Pool, PoolClient } from "pg";
import type { WorkspaceApp, WorkspaceMemberRole } from "./types";
import { loadWorkspaceAccess, requireId, requireWorkspaceManager, withWorkspaceTransaction, WorkspaceError } from "./workspaceStore";

export interface AppUseIdentity { id: string; email: string }
export interface AppUseGrant { userId: string; email: string; grantedBy: string; createdAt: Date }
export interface AppAccessEvent { actorId: string; subjectId: string; action: "grant" | "revoke"; createdAt: Date }

const APP_FIELDS = 'id, workspace_id as "workspaceId", name, created_by as "createdBy", legacy_deployment_id as "legacyDeploymentId"';

export async function loadAppUseIdentity(client: Pool | PoolClient, appId: string, userId: string): Promise<AppUseIdentity | null> {
	if (!userId) return null;
	requireId(appId);
	const result = await client.query<AppUseIdentity>(`
		select u.id, u.email from public.apps a
		join public.app_workspaces w on w.id = a.workspace_id
		join public."user" u on u.id = $2 and u."emailVerified" = true
		left join public.app_workspace_members m on m.workspace_id = w.id and m.user_id = u.id
		where a.id = $1 and (w.owner_id = u.id or m.role = 'admin' or (
		  m.role = 'member' and exists (select 1 from public.app_use_grants g where g.app_id = a.id and g.user_id = u.id)
		))
	`, [appId, userId]);
	return result.rows[0] ?? null;
}

export class AppStore {
	constructor(private readonly pool: Pool) {}

	private async managedApp(client: PoolClient, appId: string, actorId: string): Promise<WorkspaceApp> {
		requireId(appId);
		const lookup = await client.query<{ workspaceId: string }>('select workspace_id as "workspaceId" from public.apps where id = $1', [appId]);
		const workspaceId = lookup.rows[0]?.workspaceId;
		if (!workspaceId) throw new WorkspaceError(404, "App not found.");
		requireWorkspaceManager(await loadWorkspaceAccess(client, workspaceId, actorId));
		const result = await client.query<WorkspaceApp>(`select ${APP_FIELDS} from public.apps where id = $1 and workspace_id = $2 for update`, [appId, workspaceId]);
		if (!result.rows[0]) throw new WorkspaceError(404, "App not found.");
		return result.rows[0];
	}

	async createApp(workspaceId: string, actorId: string, name: string): Promise<WorkspaceApp> {
		const normalized = name.trim();
		if (!normalized || normalized.length > 120) throw new WorkspaceError(400, "An app name of 1-120 characters is required.");
		return withWorkspaceTransaction(this.pool, async (client) => {
			requireWorkspaceManager(await loadWorkspaceAccess(client, workspaceId, actorId));
			const result = await client.query<WorkspaceApp>(`insert into public.apps (workspace_id, name, created_by) values ($1, $2, $3) returning ${APP_FIELDS}`, [workspaceId, normalized, actorId]);
			return result.rows[0];
		});
	}

	async listApps(workspaceId: string, actorId: string): Promise<WorkspaceApp[]> {
		return withWorkspaceTransaction(this.pool, async (client) => {
			const access = await loadWorkspaceAccess(client, workspaceId, actorId);
			const result = await client.query<WorkspaceApp>(`
				select ${APP_FIELDS} from public.apps a where workspace_id = $1
				and ($3::boolean or exists (select 1 from public.app_use_grants g where g.app_id = a.id and g.user_id = $2))
				order by created_at, id
			`, [workspaceId, actorId, access.role !== "member"]);
			return result.rows;
		});
	}

	async grantUse(appId: string, actorId: string, userId: string): Promise<void> {
		await withWorkspaceTransaction(this.pool, async (client) => {
			const app = await this.managedApp(client, appId, actorId);
			const member = await client.query<{ role: WorkspaceMemberRole }>(`
				select m.role from public.app_workspace_members m join public."user" u on u.id = m.user_id
				where m.workspace_id = $1 and m.user_id = $2 and u."emailVerified" = true for share of u
			`, [app.workspaceId, userId]);
			if (!member.rowCount || member.rows[0].role !== "member") throw new WorkspaceError(409, "Explicit app access requires a verified ordinary member of this workspace. Owners and admins inherit management access.");
			const granted = await client.query(`
				insert into public.app_use_grants (app_id, workspace_id, user_id, granted_by) values ($1, $2, $3, $4)
				on conflict (app_id, user_id) do nothing returning user_id
			`, [appId, app.workspaceId, userId, actorId]);
			if (granted.rowCount) await client.query("insert into public.app_access_events (app_id, workspace_id, actor_id, subject_id, action) values ($1, $2, $3, $4, 'grant')", [appId, app.workspaceId, actorId, userId]);
		});
	}

	async revokeUse(appId: string, actorId: string, userId: string): Promise<void> {
		await withWorkspaceTransaction(this.pool, async (client) => {
			const app = await this.managedApp(client, appId, actorId);
			const inherited = await client.query(`
				select id from public.app_workspaces where id = $1 and owner_id = $2
				union all select workspace_id from public.app_workspace_members where workspace_id = $1 and user_id = $2 and role = 'admin'
			`, [app.workspaceId, userId]);
			if (inherited.rowCount) throw new WorkspaceError(409, "Change the management role to remove inherited app access.");
			const revoked = await client.query("delete from public.app_use_grants where app_id = $1 and user_id = $2 returning user_id", [appId, userId]);
			if (revoked.rowCount) await client.query("insert into public.app_access_events (app_id, workspace_id, actor_id, subject_id, action) values ($1, $2, $3, $4, 'revoke')", [appId, app.workspaceId, actorId, userId]);
		});
	}

	async listGrants(appId: string, actorId: string): Promise<AppUseGrant[]> {
		return withWorkspaceTransaction(this.pool, async (client) => {
			await this.managedApp(client, appId, actorId);
			const result = await client.query<AppUseGrant>(`
				select g.user_id as "userId", u.email, g.granted_by as "grantedBy", g.created_at as "createdAt"
				from public.app_use_grants g join public."user" u on u.id = g.user_id where g.app_id = $1 order by g.created_at, g.user_id
			`, [appId]);
			return result.rows;
		});
	}

	async listAccessEvents(appId: string, actorId: string): Promise<AppAccessEvent[]> {
		return withWorkspaceTransaction(this.pool, async (client) => {
			await this.managedApp(client, appId, actorId);
			const result = await client.query<AppAccessEvent>(`
				select actor_id as "actorId", subject_id as "subjectId", action, created_at as "createdAt"
				from public.app_access_events where app_id = $1 order by created_at desc, id desc limit 100
			`, [appId]);
			return result.rows;
		});
	}

	/** Requires an authenticated principal ID, never a request-supplied identity. Does not protect traffic by itself. */
	async getUseIdentity(appId: string, userId: string): Promise<AppUseIdentity | null> {
		return loadAppUseIdentity(this.pool, appId, userId);
	}
}
