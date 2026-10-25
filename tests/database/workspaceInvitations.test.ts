import { readFileSync } from "node:fs";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceStore } from "../../src/lib/apps/workspaceStore";
import { databaseTestConnectionString, prepareDatabaseTestRoles, resetFoundationDatabase } from "./helpers.mjs";

const connectionString = databaseTestConnectionString();
const client = new Client({ connectionString });
const pool = new Pool({ connectionString, max: 4 });
const store = new WorkspaceStore(pool);
const migration = readFileSync(new URL("../../supabase/migrations/20261023_workspace_invitations.sql", import.meta.url), "utf8");
let workspaceId: string;

beforeAll(async () => { await client.connect(); await prepareDatabaseTestRoles(client); });
afterAll(async () => { await pool.end(); await client.end(); });
beforeEach(async () => {
	await resetFoundationDatabase(client);
	await client.query(migration);
	workspaceId = (await store.createWorkspace("alice", " Team ")).id;
});

describe("workspace membership and invitation transactions", () => {
	it("inspects minimal details repeatedly without consuming, joining or granting app access", async () => {
		await client.query(readFileSync(new URL("../../supabase/migrations/20261023_app_use_grants.sql", import.meta.url), "utf8"));
		const invitation = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		const expected = { workspace: { id: workspaceId, name: "Team" }, role: "member", expiresAt: invitation.expiresAt };
		expect(await store.inspectInvitation("bob", invitation.token)).toEqual(expected);
		expect(await store.inspectInvitation("bob", invitation.token)).toEqual(expected);
		expect(await store.listWorkspaces("bob")).toEqual([]);
		const row = (await client.query("select accepted_at, accepted_by, revoked_at from public.app_workspace_invitations where id = $1", [invitation.id])).rows[0];
		expect(row).toEqual({ accepted_at: null, accepted_by: null, revoked_at: null });
		expect((await client.query("select count(*)::int as count from public.app_use_grants")).rows[0].count).toBe(0);
		expect((await store.acceptInvitation("bob", invitation.token)).role).toBe("member");
		await expect(store.inspectInvitation("bob", invitation.token)).rejects.toMatchObject({ status: 410 });
	});

	it("reveals no details to a wrong or unverified identity and uses current database identity", async () => {
		const invitation = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await expect(store.inspectInvitation("carol", invitation.token)).rejects.toMatchObject({ status: 403 });
		await expect(store.inspectInvitation("missing", invitation.token)).rejects.toMatchObject({ status: 403 });
		await client.query('update public."user" set "emailVerified" = false where id = \'bob\'');
		await expect(store.inspectInvitation("bob", invitation.token)).rejects.toMatchObject({ status: 403 });
		await client.query('update public."user" set "emailVerified" = true, email = \'changed@example.test\' where id = \'bob\'');
		await expect(store.inspectInvitation("bob", invitation.token)).rejects.toMatchObject({ status: 403 });
		await client.query('update public."user" set email = \'bob@example.test\' where id = \'bob\'');
		expect((await store.inspectInvitation("bob", invitation.token)).workspace.id).toBe(workspaceId);
	});

	it("denies malformed, expired, revoked and replaced invitation inspection", async () => {
		await expect(store.inspectInvitation("bob", "not-a-token")).rejects.toMatchObject({ status: 410 });
		await expect(store.inspectInvitation("bob", "s".repeat(43))).rejects.toMatchObject({ status: 410 });
		const first = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		const replacement = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await expect(store.inspectInvitation("bob", first.token)).rejects.toMatchObject({ status: 410 });
		await store.revokeInvitation(workspaceId, "alice", replacement.id);
		await expect(store.inspectInvitation("bob", replacement.token)).rejects.toMatchObject({ status: 410 });
		const expired = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await client.query("update public.app_workspace_invitations set created_at = clock_timestamp() - interval '2 days', expires_at = clock_timestamp() - interval '1 day' where id = $1", [expired.id]);
		await expect(store.inspectInvitation("bob", expired.token)).rejects.toMatchObject({ status: 410 });
	});

	it("inspection cannot reserve access across revocation before acceptance", async () => {
		const invitation = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await store.inspectInvitation("bob", invitation.token);
		await store.revokeInvitation(workspaceId, "alice", invitation.id);
		await expect(store.acceptInvitation("bob", invitation.token)).rejects.toMatchObject({ status: 410 });
		expect(await store.listWorkspaces("bob")).toEqual([]);
	});

	it("inspection rechecks inviter authority after demotion or removal", async () => {
		const admin = await store.createInvitation(workspaceId, "alice", "bob@example.test", "admin");
		await store.acceptInvitation("bob", admin.token);
		const invitation = await store.createInvitation(workspaceId, "bob", "carol@example.test", "member");
		await store.inspectInvitation("carol", invitation.token);
		await client.query("update public.app_workspace_members set role = 'member' where user_id = 'bob'");
		await expect(store.inspectInvitation("carol", invitation.token)).rejects.toMatchObject({ status: 410 });
		await client.query("update public.app_workspace_members set role = 'admin' where user_id = 'bob'");
		await store.removeMember(workspaceId, "alice", "bob");
		await expect(store.inspectInvitation("carol", invitation.token)).rejects.toMatchObject({ status: 410 });
	});

	it("member-only inspection cannot reveal or consume administrator invitations", async () => {
		const invitation = await store.createInvitation(workspaceId, "alice", "bob@example.test", "admin");
		await expect(store.inspectInvitation("bob", invitation.token, true)).rejects.toMatchObject({ status: 403 });
		expect((await store.inspectInvitation("bob", invitation.token, false)).role).toBe("admin");
		expect(await store.listWorkspaces("bob")).toEqual([]);
		await expect(store.acceptInvitation("bob", invitation.token, true)).rejects.toMatchObject({ status: 403 });
		expect((await store.acceptInvitation("bob", invitation.token, false)).role).toBe("admin");
	});

	it("lists only owned or joined workspaces", async () => {
		expect(await store.listWorkspaces("bob")).toEqual([]);
		expect(await store.listWorkspaces("alice")).toMatchObject([{ id: workspaceId, name: "Team", role: "owner" }]);
		const invitation = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await store.acceptInvitation("bob", invitation.token);
		expect(await store.listWorkspaces("bob")).toMatchObject([{ id: workspaceId, role: "member" }]);
	});

	it("stores only a token hash, normalizes identity, and omits secrets from listings", async () => {
		await client.query(migration);
		const invitation = await store.createInvitation(workspaceId, "alice", " BOB@EXAMPLE.TEST ", "member");
		expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const persisted = (await client.query("select * from public.app_workspace_invitations where id = $1", [invitation.id])).rows[0];
		expect(persisted.token_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.stringify(persisted)).not.toContain(invitation.token);
		expect(persisted.email).toBe("bob@example.test");
		expect(persisted.expires_at.getTime() - persisted.created_at.getTime()).toBeGreaterThan(86_399_000);
		expect(JSON.stringify(await store.listInvitations(workspaceId, "alice"))).not.toContain("token");
	});

	it("requires the intended verified identity and leaves a wrong-user attempt unconsumed", async () => {
		const invitation = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await expect(store.acceptInvitation("carol", invitation.token)).rejects.toMatchObject({ status: 403 });
		expect((await store.acceptInvitation("bob", invitation.token)).role).toBe("member");
		const unverified = await store.createInvitation(workspaceId, "alice", "dave@example.test", "member");
		await expect(store.acceptInvitation("dave", unverified.token)).rejects.toMatchObject({ status: 403 });
	});

	it("rejects expired, revoked, replaced, malformed, and replayed invitations", async () => {
		const first = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		const replacement = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await expect(store.acceptInvitation("bob", first.token)).rejects.toMatchObject({ status: 410 });
		await store.revokeInvitation(workspaceId, "alice", replacement.id);
		await expect(store.acceptInvitation("bob", replacement.token)).rejects.toMatchObject({ status: 410 });
		const expired = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await client.query("update public.app_workspace_invitations set created_at = clock_timestamp() - interval '2 days', expires_at = clock_timestamp() - interval '1 day' where id = $1", [expired.id]);
		await expect(store.acceptInvitation("bob", expired.token)).rejects.toMatchObject({ status: 410 });
		await expect(store.acceptInvitation("bob", "not-a-token")).rejects.toMatchObject({ status: 410 });
		const accepted = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await store.acceptInvitation("bob", accepted.token);
		await expect(store.acceptInvitation("bob", accepted.token)).rejects.toMatchObject({ status: 410 });
	});

	it("checks the current database email and verification state at acceptance time", async () => {
		const invitation = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await client.query("update public.\"user\" set email = 'changed@example.test' where id = 'bob'");
		await expect(store.acceptInvitation("bob", invitation.token)).rejects.toMatchObject({ status: 403 });
		await client.query("update public.\"user\" set email = 'bob@example.test', \"emailVerified\" = false where id = 'bob'");
		await expect(store.acceptInvitation("bob", invitation.token)).rejects.toMatchObject({ status: 403 });
		await client.query("update public.\"user\" set \"emailVerified\" = true where id = 'bob'");
		expect((await store.acceptInvitation("bob", invitation.token)).role).toBe("member");
	});

	it("allows exactly one concurrent token redemption", async () => {
		const invitation = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		const results = await Promise.allSettled([store.acceptInvitation("bob", invitation.token), store.acceptInvitation("bob", invitation.token)]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
		expect((await client.query("select count(*)::int as count from public.app_workspace_members")).rows[0].count).toBe(1);
	});

	it("prevents ordinary members and outsiders from creating invitations or reading rosters", async () => {
		const invitation = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await store.acceptInvitation("bob", invitation.token);
		await expect(store.createInvitation(workspaceId, "bob", "carol@example.test", "member")).rejects.toMatchObject({ status: 403 });
		await expect(store.listMembers(workspaceId, "bob")).rejects.toMatchObject({ status: 403 });
		await expect(store.listInvitations(workspaceId, "carol")).rejects.toMatchObject({ status: 404 });
	});

	it("reserves administrator invitations and removals for the owner", async () => {
		const adminInvite = await store.createInvitation(workspaceId, "alice", "bob@example.test", "admin");
		await store.acceptInvitation("bob", adminInvite.token);
		await expect(store.createInvitation(workspaceId, "bob", "carol@example.test", "admin")).rejects.toMatchObject({ status: 403 });
		const pendingAdmin = await store.createInvitation(workspaceId, "alice", "carol@example.test", "admin");
		await expect(store.createInvitation(workspaceId, "bob", "carol@example.test", "member")).rejects.toMatchObject({ status: 403 });
		await expect(store.revokeInvitation(workspaceId, "bob", pendingAdmin.id)).rejects.toMatchObject({ status: 404 });
		await store.acceptInvitation("carol", pendingAdmin.token);
		await expect(store.removeMember(workspaceId, "bob", "carol")).rejects.toMatchObject({ status: 403 });
		await expect(store.removeMember(workspaceId, "bob", "alice")).rejects.toMatchObject({ status: 409 });
		await store.removeMember(workspaceId, "alice", "carol");
	});

	it("rechecks current inviter authority after demotion and removal", async () => {
		const adminInvite = await store.createInvitation(workspaceId, "alice", "bob@example.test", "admin");
		await store.acceptInvitation("bob", adminInvite.token);
		const pending = await store.createInvitation(workspaceId, "bob", "carol@example.test", "member");
		await client.query("update public.app_workspace_members set role = 'member' where user_id = 'bob'");
		await expect(store.acceptInvitation("carol", pending.token)).rejects.toMatchObject({ status: 410 });
		await client.query("update public.app_workspace_members set role = 'admin' where user_id = 'bob'");
		await store.removeMember(workspaceId, "alice", "bob");
		await expect(store.acceptInvitation("carol", pending.token)).rejects.toMatchObject({ status: 410 });
		await expect(store.listMembers(workspaceId, "bob")).rejects.toMatchObject({ status: 404 });
	});

	it("does not let an invitation overwrite an existing member's role", async () => {
		const invitation = await store.createInvitation(workspaceId, "alice", "bob@example.test", "admin");
		await client.query("insert into public.app_workspace_members (workspace_id, user_id, role) values ($1, 'bob', 'member')", [workspaceId]);
		expect((await store.acceptInvitation("bob", invitation.token)).role).toBe("member");
		await expect(store.createInvitation(workspaceId, "alice", "bob@example.test", "admin")).rejects.toMatchObject({ status: 409 });
	});

	it("allows only the owner to change roles and invalidates the changed member's pending invitations", async () => {
		const invitation = await store.createInvitation(workspaceId, "alice", "bob@example.test", "admin");
		await store.acceptInvitation("bob", invitation.token);
		const pending = await store.createInvitation(workspaceId, "bob", "carol@example.test", "member");
		await expect(store.setMemberRole(workspaceId, "bob", "bob", "admin")).rejects.toMatchObject({ status: 403 });
		await expect(store.setMemberRole(workspaceId, "alice", "alice", "member")).rejects.toMatchObject({ status: 409 });
		await store.setMemberRole(workspaceId, "alice", "bob", "member");
		await expect(store.listMembers(workspaceId, "bob")).rejects.toMatchObject({ status: 403 });
		await expect(store.acceptInvitation("carol", pending.token)).rejects.toMatchObject({ status: 410 });
	});

	it("scopes revocation and membership management to one workspace", async () => {
		const other = await store.createWorkspace("carol", "Other");
		const invitation = await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await expect(store.revokeInvitation(other.id, "carol", invitation.id)).rejects.toMatchObject({ status: 404 });
		await store.acceptInvitation("bob", invitation.token);
		await expect(store.removeMember(workspaceId, "carol", "bob")).rejects.toMatchObject({ status: 404 });
		expect(await store.listMembers(workspaceId, "alice")).toHaveLength(2);
		await store.removeMember(workspaceId, "bob", "bob");
		expect(await store.listWorkspaces("bob")).toEqual([]);
	});

	it("does not invite into a personal workspace or expose invitation rows to clients", async () => {
		await client.query("update public.app_workspaces set kind = 'personal' where id = $1", [workspaceId]);
		await expect(store.createInvitation(workspaceId, "alice", "bob@example.test", "member")).rejects.toMatchObject({ status: 409 });
		await client.query("update public.app_workspaces set kind = 'team' where id = $1", [workspaceId]);
		await store.createInvitation(workspaceId, "alice", "bob@example.test", "member");
		await client.query("grant usage on schema public to foundation_client; grant select on public.app_workspace_invitations to foundation_client; set role foundation_client");
		try { expect((await client.query("select * from public.app_workspace_invitations")).rows).toEqual([]); }
		finally { await client.query("reset role"); }
	});
});
