import { readFileSync } from "node:fs";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceStore } from "../../src/lib/apps/workspaceStore";
import { AppStore } from "../../src/lib/apps/appStore";
import { databaseTestConnectionString, prepareDatabaseTestRoles, resetFoundationDatabase } from "./helpers.mjs";

const connectionString = databaseTestConnectionString();
const client = new Client({ connectionString });
const pool = new Pool({ connectionString, max: 4 });
const workspaces = new WorkspaceStore(pool);
const apps = new AppStore(pool);
const migration = readFileSync(new URL("../../supabase/migrations/20261023_app_use_grants.sql", import.meta.url), "utf8");
let workspaceId: string;
let appId: string;

beforeAll(async () => { await client.connect(); await prepareDatabaseTestRoles(client); });
afterAll(async () => { await pool.end(); await client.end(); });
beforeEach(async () => {
	await resetFoundationDatabase(client);
	await client.query(readFileSync(new URL("../../supabase/migrations/20261023_workspace_invitations.sql", import.meta.url), "utf8"));
	await client.query(migration);
	workspaceId = (await workspaces.createWorkspace("alice", "Team")).id;
	const invite = await workspaces.createInvitation(workspaceId, "alice", "bob@example.test", "member");
	await workspaces.acceptInvitation("bob", invite.token);
	appId = (await apps.createApp(workspaceId, "alice", " Tracker ")).id;
});

describe("per-app use grants", () => {
	it("creates stable app identity without copying deployment configuration", async () => {
		await client.query(migration);
		expect(await apps.listApps(workspaceId, "alice")).toEqual([{ id: appId, workspaceId, name: "Tracker", createdBy: "alice", legacyDeploymentId: null }]);
		await expect(apps.createApp(workspaceId, "bob", "Unauthorized")).rejects.toMatchObject({ status: 403 });
		await expect(apps.createApp(workspaceId, "carol", "Unauthorized")).rejects.toMatchObject({ status: 404 });
		expect((await client.query("select app_id from public.deployments where id = 'deploy-a'")).rows[0].app_id).toBeNull();
	});

	it("does not turn workspace membership into access to every app", async () => {
		const other = await apps.createApp(workspaceId, "alice", "Other");
		expect(await apps.getUseIdentity(appId, "bob")).toBeNull();
		expect(await apps.listApps(workspaceId, "bob")).toEqual([]);
		await apps.grantUse(appId, "alice", "bob");
		expect(await apps.getUseIdentity(appId, "bob")).toEqual({ id: "bob", email: "bob@example.test" });
		expect(await apps.getUseIdentity(other.id, "bob")).toBeNull();
		expect((await apps.listApps(workspaceId, "bob")).map((app) => app.id)).toEqual([appId]);
	});

	it("does not confer app-management rights through a use grant", async () => {
		await apps.grantUse(appId, "alice", "bob");
		await expect(apps.grantUse(appId, "bob", "carol")).rejects.toMatchObject({ status: 403 });
		await expect(apps.revokeUse(appId, "bob", "bob")).rejects.toMatchObject({ status: 403 });
		await expect(apps.listGrants(appId, "bob")).rejects.toMatchObject({ status: 403 });
		await expect(apps.listAccessEvents(appId, "bob")).rejects.toMatchObject({ status: 403 });
	});

	it("rechecks live grant state for the same signed-in identity after revocation", async () => {
		await apps.grantUse(appId, "alice", "bob");
		expect(await apps.getUseIdentity(appId, "bob")).not.toBeNull();
		await apps.revokeUse(appId, "alice", "bob");
		expect(await apps.getUseIdentity(appId, "bob")).toBeNull();
		expect(await apps.listApps(workspaceId, "bob")).toEqual([]);
	});

	it("removes grants with membership and does not resurrect them after reinvitation", async () => {
		await apps.grantUse(appId, "alice", "bob");
		await workspaces.removeMember(workspaceId, "alice", "bob");
		expect(await apps.getUseIdentity(appId, "bob")).toBeNull();
		expect(await apps.listGrants(appId, "alice")).toEqual([]);
		const invitation = await workspaces.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await workspaces.acceptInvitation("bob", invitation.token);
		expect(await apps.getUseIdentity(appId, "bob")).toBeNull();
	});

	it("inherits owner/admin access and removes a former creator's authority on demotion", async () => {
		expect(await apps.getUseIdentity(appId, "alice")).not.toBeNull();
		await workspaces.setMemberRole(workspaceId, "alice", "bob", "admin");
		const created = await apps.createApp(workspaceId, "bob", "Admin tool");
		expect(await apps.getUseIdentity(created.id, "bob")).not.toBeNull();
		await expect(apps.grantUse(appId, "alice", "bob")).rejects.toMatchObject({ status: 409 });
		await expect(apps.revokeUse(appId, "alice", "bob")).rejects.toMatchObject({ status: 409 });
		await expect(apps.revokeUse(appId, "alice", "alice")).rejects.toMatchObject({ status: 409 });
		await workspaces.setMemberRole(workspaceId, "alice", "bob", "member");
		expect(await apps.getUseIdentity(created.id, "bob")).toBeNull();
	});

	it("requires verified current membership and fails closed after identity verification is lost", async () => {
		await expect(apps.grantUse(appId, "alice", "carol")).rejects.toMatchObject({ status: 409 });
		await client.query("update public.\"user\" set \"emailVerified\" = false where id = 'bob'");
		await expect(apps.grantUse(appId, "alice", "bob")).rejects.toMatchObject({ status: 409 });
		await client.query("update public.\"user\" set \"emailVerified\" = true where id = 'bob'");
		await apps.grantUse(appId, "alice", "bob");
		await client.query("update public.\"user\" set \"emailVerified\" = false where id in ('alice', 'bob')");
		expect(await apps.getUseIdentity(appId, "bob")).toBeNull();
		expect(await apps.getUseIdentity(appId, "alice")).toBeNull();
		expect(await apps.getUseIdentity(appId, "")).toBeNull();
	});

	it("denies cross-workspace management and mixed-tenant grant records", async () => {
		const other = await workspaces.createWorkspace("carol", "Other team");
		await expect(apps.listApps(workspaceId, "carol")).rejects.toMatchObject({ status: 404 });
		await expect(apps.grantUse(appId, "carol", "bob")).rejects.toMatchObject({ status: 404 });
		await expect(client.query("insert into public.app_use_grants (app_id, workspace_id, user_id, granted_by) values ($1, $2, 'bob', 'alice')", [appId, other.id])).rejects.toMatchObject({ code: "23503" });
		await expect(client.query("insert into public.app_use_grants (app_id, workspace_id, user_id, granted_by) values ($1, $2, 'carol', 'alice')", [appId, workspaceId])).rejects.toMatchObject({ code: "23503" });
	});

	it("records explicit grant/revoke changes once and preserves their provenance", async () => {
		await apps.grantUse(appId, "alice", "bob");
		await apps.grantUse(appId, "alice", "bob");
		expect(await apps.listGrants(appId, "alice")).toMatchObject([{ userId: "bob", email: "bob@example.test", grantedBy: "alice" }]);
		await apps.revokeUse(appId, "alice", "bob");
		await apps.revokeUse(appId, "alice", "bob");
		expect(await apps.listAccessEvents(appId, "alice")).toMatchObject([
			{ actorId: "alice", subjectId: "bob", action: "revoke" }, { actorId: "alice", subjectId: "bob", action: "grant" },
		]);
	});

	it("serializes concurrent grant/removal without leaving access behind", async () => {
		const results = await Promise.allSettled([apps.grantUse(appId, "alice", "bob"), workspaces.removeMember(workspaceId, "alice", "bob")]);
		expect(results[1].status).toBe("fulfilled");
		expect(await apps.getUseIdentity(appId, "bob")).toBeNull();
		expect(await apps.listGrants(appId, "alice")).toEqual([]);
	});

	it("denies client reads and makes explicit access-event writes append-only for service_role", async () => {
		await apps.grantUse(appId, "alice", "bob");
		await client.query("grant usage on schema public to foundation_client, service_role; grant select on public.app_use_grants, public.app_access_events to foundation_client; set role foundation_client");
		try {
			expect((await client.query("select * from public.app_use_grants")).rows).toEqual([]);
			expect((await client.query("select * from public.app_access_events")).rows).toEqual([]);
		} finally { await client.query("reset role"); }
		await client.query("set role service_role");
		try { await expect(client.query("delete from public.app_access_events")).rejects.toMatchObject({ code: "42501" }); }
		finally { await client.query("reset role"); }
	});
});
