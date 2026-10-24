import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { databaseTestConnectionString, prepareDatabaseTestRoles, resetFoundationDatabase } from "./helpers.mjs";

const client = new Client({ connectionString: databaseTestConnectionString() });
const migration = readFileSync(new URL("../../supabase/migrations/20261023_app_workspaces.sql", import.meta.url), "utf8");
const backfill = readFileSync(new URL("../../supabase/migrations/20261023_backfill_personal_apps.sql", import.meta.url), "utf8");

beforeAll(async () => {
	await client.connect();
	await prepareDatabaseTestRoles(client);
});

afterAll(async () => { await client.end(); });

beforeEach(async () => { await resetFoundationDatabase(client); });

describe("app workspace PostgreSQL foundation", () => {
	it("is additive and rerunnable without associating or changing existing deployments", async () => {
		await client.query(migration);
		const result = await client.query("select app_id, workspace_id, cloud_resources from public.deployments where id = 'deploy-a'");
		expect(result.rows[0]).toEqual({ app_id: null, workspace_id: null, cloud_resources: { target: "ecs", service: "existing-service" } });
		expect((await client.query("select count(*)::int as count from public.apps")).rows[0].count).toBe(0);
	});

	it("backfills each owner's apps and release associations idempotently", async () => {
		await client.query(backfill);
		const initial = (await client.query("select id, app_id, workspace_id from public.deployments order by id")).rows;
		await client.query(backfill);
		expect((await client.query("select id, app_id, workspace_id from public.deployments order by id")).rows).toEqual(initial);
		expect(initial[0].workspace_id).not.toBe(initial[1].workspace_id);
		expect((await client.query("select count(*)::int as count from public.app_workspaces")).rows[0].count).toBe(2);
		expect((await client.query("select count(*)::int as count from public.apps")).rows[0].count).toBe(2);
		const runs = (await client.query("select user_id, app_id, workspace_id, release_artifact from public.deployment_runs order by user_id")).rows;
		expect(runs[0]).toMatchObject({ user_id: "alice", app_id: initial[0].app_id, workspace_id: initial[0].workspace_id, release_artifact: { kind: "ecr_image", imageTag: "original" } });
		expect(runs[1]).toMatchObject({ user_id: "bob", app_id: initial[1].app_id, workspace_id: initial[1].workspace_id });
	});

	it("resumes for later deployments without overwriting existing app names", async () => {
		await client.query(backfill);
		await client.query("update public.apps set name = 'Renamed tracker' where legacy_deployment_id = 'deploy-a'");
		await client.query("insert into public.deployments (id, repo_name, service_name, owner_id) values ('deploy-c', 'acme/new', 'api', 'alice')");
		await client.query(backfill);
		expect((await client.query("select name from public.apps where legacy_deployment_id = 'deploy-a'")).rows[0].name).toBe("Renamed tracker");
		expect((await client.query("select count(distinct workspace_id)::int as count from public.deployments where owner_id = 'alice'")).rows[0].count).toBe(1);
		expect((await client.query("select count(*)::int as count from public.apps")).rows[0].count).toBe(3);
	});

	it("leaves ambiguous historical runs unassociated", async () => {
		await client.query("insert into public.deployments (id, repo_name, service_name, owner_id) values ('duplicate', 'acme/tracker', 'web', 'alice')");
		await client.query(backfill);
		expect((await client.query("select app_id, workspace_id from public.deployment_runs where user_id = 'alice'")).rows[0]).toEqual({ app_id: null, workspace_id: null });
		expect((await client.query("select app_id from public.deployment_runs where user_id = 'bob'")).rows[0].app_id).not.toBeNull();
	});

	it("rejects cross-workspace deployment and historical release associations", async () => {
		await client.query(backfill);
		const rows = (await client.query("select app_id, workspace_id from public.deployments order by id")).rows;
		await expect(client.query("update public.deployments set workspace_id = $1 where id = 'deploy-a'", [rows[1].workspace_id])).rejects.toMatchObject({ code: "23503" });
		await expect(client.query("update public.deployment_runs set workspace_id = $1 where user_id = 'alice'", [rows[1].workspace_id])).rejects.toMatchObject({ code: "23503" });
		await expect(client.query("update public.deployments set workspace_id = null where id = 'deploy-a'")).rejects.toMatchObject({ code: "23514" });
		await expect(client.query("update public.deployment_runs set app_id = null where user_id = 'alice'")).rejects.toMatchObject({ code: "23514" });
	});

	it("enforces membership uniqueness, valid roles, and a single personal workspace", async () => {
		await client.query(backfill);
		const workspaceId = (await client.query("select id from public.app_workspaces where owner_id = 'alice'")).rows[0].id;
		await client.query("insert into public.app_workspace_members (workspace_id, user_id, role) values ($1, 'carol', 'member')", [workspaceId]);
		await expect(client.query("insert into public.app_workspace_members (workspace_id, user_id, role) values ($1, 'carol', 'admin')", [workspaceId])).rejects.toMatchObject({ code: "23505" });
		await expect(client.query("update public.app_workspace_members set role = 'owner' where user_id = 'carol'")).rejects.toMatchObject({ code: "23514" });
		await expect(client.query("insert into public.app_workspaces (name, kind, owner_id) values ('Duplicate', 'personal', 'alice')")).rejects.toMatchObject({ code: "23505" });
	});

	it("denies direct client access even when table privileges are granted", async () => {
		await client.query(backfill);
		await client.query("insert into public.app_workspace_members (workspace_id, user_id, role) select id, 'carol', 'member' from public.app_workspaces where owner_id = 'alice'");
		await client.query("grant usage on schema public to foundation_client; grant select, insert on public.apps, public.app_workspaces, public.app_workspace_members to foundation_client");
		await client.query("set role foundation_client");
		try {
			for (const table of ["apps", "app_workspaces", "app_workspace_members"]) {
				expect((await client.query(`select * from public.${table}`)).rows).toEqual([]);
			}
			await expect(client.query("insert into public.app_workspaces (name, kind, owner_id) values ('Intrusion', 'team', 'alice')")).rejects.toMatchObject({ code: "42501" });
		} finally {
			await client.query("reset role");
		}
	});

	it("retains associated release history after deleting a legacy deployment", async () => {
		await client.query(backfill);
		const appId = (await client.query("select app_id from public.deployments where id = 'deploy-a'")).rows[0].app_id;
		await expect(client.query("delete from public.apps where id = $1", [appId])).rejects.toMatchObject({ code: "23503" });
		await client.query("delete from public.deployments where id = 'deploy-a'");
		expect((await client.query("select legacy_deployment_id from public.apps where id = $1", [appId])).rows[0].legacy_deployment_id).toBeNull();
		expect((await client.query("select app_id from public.deployment_runs where user_id = 'alice'")).rows[0].app_id).toBe(appId);
		await expect(client.query("delete from public.apps where id = $1", [appId])).rejects.toMatchObject({ code: "23503" });
	});
});
