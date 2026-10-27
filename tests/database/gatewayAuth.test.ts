import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppStore } from "../../src/lib/apps/appStore";
import { GatewayAuthStore, type GatewayHandoff } from "../../src/lib/apps/gatewayAuthStore";
import { WorkspaceStore } from "../../src/lib/apps/workspaceStore";
import { databaseTestConnectionString, prepareDatabaseTestRoles, resetFoundationDatabase } from "./helpers.mjs";

const connectionString = databaseTestConnectionString();
const client = new Client({ connectionString });
const pool = new Pool({ connectionString, max: 4 });
const workspaces = new WorkspaceStore(pool);
const apps = new AppStore(pool);
const auth = new GatewayAuthStore(pool, { codeSeconds: 60, sessionSeconds: 900 });
const migration = readFileSync(new URL("../../supabase/migrations/20261023_app_gateway_auth.sql", import.meta.url), "utf8");
let workspaceId: string;
let appId: string;
let bindingId: string;
let otherBindingId: string;

function principal(userId: string) { return { userId, sessionId: `${userId}-session` }; }

function proof(): { verifier: string; challenge: string } {
	const verifier = randomBytes(32).toString("base64url");
	return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function handoff(userId = "bob", targetBindingId = bindingId): Promise<GatewayHandoff & { verifier: string }> {
	const { verifier, challenge } = proof();
	return { ...await auth.issue(targetBindingId, principal(userId), challenge), verifier };
}

async function session(userId = "bob", targetBindingId = bindingId): Promise<string> {
	const issued = await handoff(userId, targetBindingId);
	return (await auth.redeem(targetBindingId, issued.callbackUrl, issued.code, issued.verifier)).token;
}

async function previewBinding(): Promise<string> {
	return (await client.query<{ id: string }>("insert into public.app_gateway_bindings (app_id, origin) values ($1, 'https://preview.apps.example.test') returning id", [appId])).rows[0].id;
}

beforeAll(async () => { await client.connect(); await prepareDatabaseTestRoles(client); });
afterAll(async () => { await pool.end(); await client.end(); });
beforeEach(async () => {
	await resetFoundationDatabase(client);
	for (const name of ["workspace_invitations", "app_use_grants", "app_gateway_auth", "gateway_platform_sessions"]) {
		await client.query(readFileSync(new URL(`../../supabase/migrations/20261023_${name}.sql`, import.meta.url), "utf8"));
	}
	await client.query(readFileSync(new URL("../../supabase/migrations/20261024_gateway_environments.sql", import.meta.url), "utf8"));
	workspaceId = (await workspaces.createWorkspace("alice", "Team")).id;
	const invite = await workspaces.createInvitation(workspaceId, "alice", "bob@example.test", "member");
	await workspaces.acceptInvitation("bob", invite.token);
	appId = (await apps.createApp(workspaceId, "alice", "Tracker")).id;
	const other = await apps.createApp(workspaceId, "alice", "Other");
	await apps.grantUse(appId, "alice", "bob");
	bindingId = (await client.query<{ id: string }>("insert into public.app_gateway_bindings (app_id, environment, origin) values ($1, 'published', 'https://tracker.apps.example.test') returning id", [appId])).rows[0].id;
	otherBindingId = (await client.query<{ id: string }>("insert into public.app_gateway_bindings (app_id, environment, origin) values ($1, 'published', 'https://other.apps.example.test') returning id", [other.id])).rows[0].id;
});

describe("gateway handoff and session store", () => {
	it("inspects only current authorized bindings without minting credentials", async () => {
		expect(await auth.inspect(bindingId, principal("bob"))).toEqual({ bindingId, app: { id: appId, name: "Tracker" },
			workspace: { id: workspaceId, name: "Team" }, origin: "https://tracker.apps.example.test", environment: "published",
			identity: { id: "bob", email: "bob@example.test" } });
		for (const table of ["app_gateway_codes", "app_gateway_sessions"]) expect((await client.query(`select count(*) from public.${table}`)).rows[0].count).toBe("0");
		await expect(auth.inspect(otherBindingId, principal("bob"))).rejects.toMatchObject({ status: 403 });
		await expect(auth.inspect(await previewBinding(), principal("bob"))).rejects.toMatchObject({ status: 403 });
		await expect(auth.inspect(bindingId, principal("carol"))).rejects.toMatchObject({ status: 403 });
		await client.query('update public."user" set "emailVerified" = false where id = \'bob\'');
		await expect(auth.inspect(bindingId, principal("bob"))).rejects.toMatchObject({ status: 403 });
	});
	it("rechecks the displayed identity under the issuance locks when database identity changes", async () => {
		const display = await auth.inspect(bindingId, principal("bob"));
		await client.query('update public."user" set email = \'new@example.test\' where id = \'bob\'');
		await expect(auth.issue(bindingId, principal("bob"), proof().challenge, display.identity)).rejects.toMatchObject({ status: 409 });
		expect((await client.query("select count(*) from public.app_gateway_codes")).rows[0].count).toBe("0");
		expect(await auth.issue(bindingId, principal("bob"), proof().challenge, { id: "bob", email: "new@example.test" })).toHaveProperty("code");
	});
	it("denies inspection after platform-session expiry or binding disable", async () => {
		await client.query('update public.session set "expiresAt" = clock_timestamp() - interval \'1 second\' where id = \'bob-session\'');
		await expect(auth.inspect(bindingId, principal("bob"))).rejects.toMatchObject({ status: 401 });
		await client.query("update public.app_gateway_bindings set disabled_at = clock_timestamp() where id = $1", [bindingId]);
		await expect(auth.inspect(bindingId, principal("alice"))).rejects.toMatchObject({ status: 401 });
	});
	it("defaults new bindings to preview and limits previews to verified owners/admins", async () => {
		const preview = await previewBinding();
		expect((await client.query("select environment from public.app_gateway_bindings where id = $1", [preview])).rows[0].environment).toBe("preview");
		await expect(handoff("bob", preview)).rejects.toMatchObject({ status: 403 });
		await expect(handoff("carol", preview)).rejects.toMatchObject({ status: 403 });
		expect(await auth.authorize(bindingId, await session())).toEqual({ id: "bob", email: "bob@example.test" });
		expect(await auth.authorize(preview, await session("alice", preview))).toEqual({ id: "alice", email: "alice@example.test" });
		await workspaces.setMemberRole(workspaceId, "alice", "bob", "admin");
		const token = await session("bob", preview);
		expect(await auth.authorize(preview, token)).toEqual({ id: "bob", email: "bob@example.test" });
		await client.query('update public."user" set "emailVerified" = false where id = \'bob\'');
		expect(await auth.authorize(preview, token)).toBeNull();
		await expect(handoff("bob", preview)).rejects.toMatchObject({ status: 403 });
	});

	it("does not carry published codes or sessions into another environment of the same app", async () => {
		const preview = await previewBinding();
		const issued = await handoff("alice");
		await expect(auth.redeem(preview, "https://preview.apps.example.test/__smartdeploy/callback", issued.code, issued.verifier)).rejects.toMatchObject({ status: 401 });
		const published = await auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier);
		expect(await auth.authorize(preview, published.token)).toBeNull();
		const previewToken = await session("alice", preview);
		expect(await auth.authorize(bindingId, previewToken)).toBeNull();
		expect(await auth.authorize(preview, previewToken)).not.toBeNull();
	});

	it("restricts the invited-member waiting-list exception to published bindings", async () => {
		const preview = await previewBinding();
		expect(await auth.isInvitedMember(bindingId, "bob")).toBe(true);
		expect(await auth.isInvitedMember(preview, "bob")).toBe(false);
		expect(await auth.isInvitedMember(preview, "alice")).toBe(false);
	});

	it("rechecks preview policy at redemption and authorization even for preexisting member credentials", async () => {
		const preview = await previewBinding();
		const code = randomBytes(32).toString("base64url");
		const token = randomBytes(32).toString("base64url");
		const hash = (value: string) => createHash("sha256").update(value).digest("hex");
		const { verifier, challenge } = proof();
		// Simulate credentials from an older issuer, bypassing the current issue-time guard.
		await client.query(`insert into public.app_gateway_codes (token_hash, binding_id, app_id, user_id, challenge, expires_at, platform_session_id)
			values ($1, $2, $3, 'bob', $4, clock_timestamp() + interval '1 minute', 'bob-session')`, [hash(code), preview, appId, challenge]);
		await client.query(`insert into public.app_gateway_sessions (token_hash, binding_id, app_id, user_id, expires_at, platform_session_id)
			values ($1, $2, $3, 'bob', clock_timestamp() + interval '1 minute', 'bob-session')`, [hash(token), preview, appId]);
		await expect(auth.redeem(preview, "https://preview.apps.example.test/__smartdeploy/callback", code, verifier)).rejects.toMatchObject({ status: 403 });
		expect(await auth.authorize(preview, token)).toBeNull();
		expect((await client.query("select count(*)::int as count from public.app_gateway_sessions where binding_id = $1", [preview])).rows[0].count).toBe(1);
	});

	it("invalidates a binding's codes/sessions on environment changes without reviving them on reversal", async () => {
		const member = await session();
		const owner = await session("alice");
		const issued = await handoff();
		const unaffected = await session("alice", otherBindingId);
		await client.query("update public.app_gateway_bindings set environment = 'preview' where id = $1", [bindingId]);
		expect(await auth.authorize(bindingId, member)).toBeNull();
		expect(await auth.authorize(bindingId, owner)).toBeNull();
		await expect(auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier)).rejects.toMatchObject({ status: 401 });
		await expect(handoff()).rejects.toMatchObject({ status: 403 });
		expect(await auth.authorize(otherBindingId, unaffected)).not.toBeNull();
		await client.query("update public.app_gateway_bindings set environment = 'published' where id = $1", [bindingId]);
		expect(await auth.authorize(bindingId, member)).toBeNull();
		expect(await auth.authorize(bindingId, owner)).toBeNull();
		expect(await auth.authorize(bindingId, await session())).not.toBeNull();
	});

	it("removes preview access after admin demotion even when published app-use access remains", async () => {
		const preview = await previewBinding();
		await workspaces.setMemberRole(workspaceId, "alice", "bob", "admin");
		const token = await session("bob", preview);
		const issued = await handoff("bob", preview);
		await workspaces.setMemberRole(workspaceId, "alice", "bob", "member");
		await apps.grantUse(appId, "alice", "bob");
		expect(await auth.authorize(preview, token)).toBeNull();
		await expect(auth.redeem(preview, issued.callbackUrl, issued.code, issued.verifier)).rejects.toMatchObject({ status: 401 });
		await expect(handoff("bob", preview)).rejects.toMatchObject({ status: 403 });
		expect(await auth.authorize(bindingId, await session())).not.toBeNull();
	});

	it("rejects invalid environment values and prevents service-role classification changes", async () => {
		await expect(client.query("update public.app_gateway_bindings set environment = 'unknown' where id = $1", [bindingId])).rejects.toMatchObject({ code: "23514" });
		await expect(client.query("update public.app_gateway_bindings set environment = null where id = $1", [bindingId])).rejects.toMatchObject({ code: "23502" });
		await client.query("grant usage on schema public to service_role; set role service_role");
		try {
			await expect(client.query("update public.app_gateway_bindings set environment = 'preview' where id = $1", [bindingId])).rejects.toMatchObject({ code: "42501" });
			expect((await client.query("select environment from public.app_gateway_bindings where id = $1", [bindingId])).rows[0].environment).toBe("published");
		} finally { await client.query("reset role"); }
	});

	it("upgrades unclassified bindings conservatively, expires old app credentials once and preserves reruns", async () => {
		const token = await session();
		const issued = await handoff();
		// Recreate the pre-environment schema in this disposable database only.
		await client.query("alter table public.app_gateway_bindings drop column environment cascade");
		await client.query(migration);
		const upgrade = readFileSync(new URL("../../supabase/migrations/20261024_gateway_environments.sql", import.meta.url), "utf8");
		await client.query(upgrade);
		expect((await client.query("select distinct environment from public.app_gateway_bindings")).rows).toEqual([{ environment: "preview" }]);
		expect(await auth.authorize(bindingId, token)).toBeNull();
		await expect(auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier)).rejects.toMatchObject({ status: 401 });
		await expect(handoff()).rejects.toMatchObject({ status: 403 });
		expect((await client.query("select count(*)::int as count from public.session")).rows[0].count).toBe(4);
		await client.query("update public.app_gateway_bindings set environment = 'published' where id = $1", [bindingId]);
		const fresh = await session();
		await client.query(upgrade);
		await client.query("update public.app_gateway_bindings set environment = environment where id = $1", [bindingId]);
		expect(await auth.authorize(bindingId, fresh)).not.toBeNull();
	});

	it("serializes environment reclassification with member issuance and redemption", async () => {
		const issued = await handoff();
		const result = await Promise.allSettled([
			auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier),
			client.query("update public.app_gateway_bindings set environment = 'preview' where id = $1", [bindingId]),
		]);
		expect(result[1].status).toBe("fulfilled");
		if (result[0].status === "rejected") expect([401, 403]).toContain(result[0].reason.status);
		expect((await client.query("select * from public.app_gateway_sessions where binding_id = $1", [bindingId])).rows).toEqual([]);
		await client.query("update public.app_gateway_bindings set environment = 'published' where id = $1", [bindingId]);
		const issuance = await Promise.allSettled([
			handoff(), client.query("update public.app_gateway_bindings set environment = 'preview' where id = $1", [bindingId]),
		]);
		expect(issuance[1].status).toBe("fulfilled");
		if (issuance[0].status === "rejected") expect(issuance[0].reason).toMatchObject({ status: 403 });
		expect((await client.query("select * from public.app_gateway_codes where binding_id = $1", [bindingId])).rows).toEqual([]);
	});

	it("purges only unbound legacy credentials on upgrade and preserves bound credentials on rerun", async () => {
		const bound = await session();
		await client.query("alter table public.app_gateway_codes alter column platform_session_id drop not null; alter table public.app_gateway_sessions alter column platform_session_id drop not null");
		await client.query(`insert into public.app_gateway_codes (token_hash, binding_id, app_id, user_id, challenge, expires_at)
			values ($1, $2, $3, 'bob', $4, clock_timestamp() + interval '1 minute')`, ["a".repeat(64), bindingId, appId, proof().challenge]);
		await client.query(`insert into public.app_gateway_sessions (token_hash, binding_id, app_id, user_id, expires_at)
			values ($1, $2, $3, 'bob', clock_timestamp() + interval '1 minute')`, ["b".repeat(64), bindingId, appId]);
		const upgrade = readFileSync(new URL("../../supabase/migrations/20261023_gateway_platform_sessions.sql", import.meta.url), "utf8");
		await client.query(upgrade);
		await client.query(upgrade);
		expect((await client.query("select * from public.app_gateway_codes where platform_session_id is null")).rows).toEqual([]);
		expect((await client.query("select * from public.app_gateway_sessions")).rows).toHaveLength(1);
		expect(await auth.authorize(bindingId, bound)).not.toBeNull();
	});
	it("revokes all app credentials across platform sessions without affecting another user", async () => {
		const first = await session();
		await client.query("insert into public.session (id, \"userId\", \"expiresAt\") values ('bob-other-session', 'bob', clock_timestamp() + interval '1 day')");
		const otherApp = (await client.query<{ app_id: string }>("select app_id from public.app_gateway_bindings where id = $1", [otherBindingId])).rows[0].app_id;
		await apps.grantUse(otherApp, "alice", "bob");
		const secondProof = proof();
		const issued = await auth.issue(otherBindingId, { userId: "bob", sessionId: "bob-other-session" }, secondProof.challenge);
		const second = await auth.redeem(otherBindingId, issued.callbackUrl, issued.code, secondProof.verifier);
		const pending = await handoff();
		const owner = await session("alice");
		await client.query("delete from public.session where id = 'bob-session'");
		expect(await auth.authorize(bindingId, first)).toBeNull();
		expect(await auth.authorize(otherBindingId, second.token)).toBeNull();
		await expect(auth.redeem(bindingId, pending.callbackUrl, pending.code, pending.verifier)).rejects.toMatchObject({ status: 401 });
		expect(await auth.authorize(bindingId, owner)).not.toBeNull();
		expect((await client.query("select id from public.session where id = 'bob-other-session'")).rows).toHaveLength(1);
	});

	it("requires the authenticated platform session to belong to the principal and remain active", async () => {
		await expect(auth.issue(bindingId, { userId: "bob", sessionId: "alice-session" }, proof().challenge)).rejects.toMatchObject({ status: 401 });
		await expect(auth.issue(bindingId, { userId: "bob", sessionId: "missing" }, proof().challenge)).rejects.toMatchObject({ status: 401 });
		const token = await session();
		await client.query("update public.session set \"expiresAt\" = clock_timestamp() - interval '1 minute' where id = 'bob-session'");
		await expect(auth.issue(bindingId, principal("bob"), proof().challenge)).rejects.toMatchObject({ status: 401 });
		expect(await auth.authorize(bindingId, token)).toBeNull();
		await client.query("update public.session set \"expiresAt\" = clock_timestamp() + interval '1 day' where id = 'bob-session'");
		expect(await auth.authorize(bindingId, token)).toBeNull();
	});

	it("caps app credentials at the originating platform-session expiry", async () => {
		const expiry = (await client.query<{ expiresAt: Date }>("update public.session set \"expiresAt\" = clock_timestamp() + interval '30 seconds' where id = 'bob-session' returning \"expiresAt\"")).rows[0].expiresAt;
		const issued = await handoff();
		expect(issued.expiresAt.getTime()).toBeLessThanOrEqual(expiry.getTime());
		const redeemed = await auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier);
		expect(redeemed.expiresAt.getTime()).toBeLessThanOrEqual(expiry.getTime());
	});

	it("serializes logout with issuance and cannot use a stale principal after deletion", async () => {
		const results = await Promise.allSettled([auth.issue(bindingId, principal("bob"), proof().challenge), client.query("delete from public.session where id = 'bob-session'")]);
		expect(results[1].status).toBe("fulfilled");
		if (results[0].status === "rejected") expect(results[0].reason).toMatchObject({ status: 401 });
		expect((await client.query("select * from public.app_gateway_codes where user_id = 'bob'")).rows).toEqual([]);
		await expect(auth.issue(bindingId, principal("bob"), proof().challenge)).rejects.toMatchObject({ status: 401 });
	});

	it("serializes logout with code redemption without leaving a live app session", async () => {
		const issued = await handoff();
		const results = await Promise.allSettled([auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier), client.query("delete from public.session where id = 'bob-session'")]);
		expect(results[1].status).toBe("fulfilled");
		if (results[0].status === "rejected") expect(results[0].reason).toMatchObject({ status: 401 });
		expect((await client.query("select * from public.app_gateway_sessions where user_id = 'bob'")).rows).toEqual([]);
	});

	it("requires explicit bounded lifetimes and does not retain mutable caller configuration", async () => {
		for (const lifetimes of [{ codeSeconds: 0, sessionSeconds: 1 }, { codeSeconds: 121, sessionSeconds: 1 }, { codeSeconds: 60, sessionSeconds: 3601 }, { codeSeconds: 1.5, sessionSeconds: 1 }]) {
			expect(() => new GatewayAuthStore(pool, lifetimes)).toThrow("Explicit gateway lifetimes required");
		}
		const lifetimes = { codeSeconds: 60, sessionSeconds: 900 };
		const isolated = new GatewayAuthStore(pool, lifetimes);
		lifetimes.codeSeconds = 9999;
		await expect(isolated.issue(bindingId, principal("bob"), proof().challenge)).resolves.toHaveProperty("code");
	});

	it("stores hashes only, uses a fixed callback, and rechecks current verified identity", async () => {
		await client.query(migration);
		const issued = await handoff();
		expect(issued.callbackUrl).toBe("https://tracker.apps.example.test/__smartdeploy/callback");
		const codes = (await client.query("select * from public.app_gateway_codes")).rows;
		expect(codes[0].token_hash).toBe(createHash("sha256").update(issued.code).digest("hex"));
		expect(JSON.stringify(codes)).not.toContain(issued.code);
		expect(JSON.stringify(codes)).not.toContain(issued.verifier);
		const redeemed = await auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier);
		expect(redeemed.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect((await client.query("select * from public.app_gateway_codes")).rows).toEqual([]);
		expect(JSON.stringify((await client.query("select * from public.app_gateway_sessions")).rows)).not.toContain(redeemed.token);
		expect(await auth.authorize(bindingId, redeemed.token)).toEqual({ id: "bob", email: "bob@example.test" });
		await client.query("update public.\"user\" set email = 'new@example.test' where id = 'bob'");
		expect(await auth.authorize(bindingId, redeemed.token)).toBeNull();
		expect(await auth.authorize(bindingId, await session())).toEqual({ id: "bob", email: "new@example.test" });
	});

	it("requires current app use at issuance and never accepts an outsider or bare membership", async () => {
		await expect(auth.issue(bindingId, principal("carol"), proof().challenge)).rejects.toMatchObject({ status: 403 });
		await expect(auth.issue(otherBindingId, principal("bob"), proof().challenge)).rejects.toMatchObject({ status: 403 });
		await expect(auth.issue(bindingId, principal(""), proof().challenge)).rejects.toMatchObject({ status: 401 });
		await expect(auth.issue(bindingId, principal("bob"), "plain-verifier")).rejects.toMatchObject({ status: 400 });
		expect(await auth.authorize(bindingId, await session("alice"))).toEqual({ id: "alice", email: "alice@example.test" });
	});

	it("binds codes and sessions to one gateway/app and the exact callback URL", async () => {
		const issued = await handoff();
		for (const callback of ["https://evil.example.test/__smartdeploy/callback", issued.callbackUrl + "/", issued.callbackUrl + "?next=https://evil.test", issued.callbackUrl.replace("https:", "http:")]) {
			await expect(auth.redeem(bindingId, callback, issued.code, issued.verifier)).rejects.toMatchObject({ status: 401 });
		}
		await expect(auth.redeem(otherBindingId, "https://other.apps.example.test/__smartdeploy/callback", issued.code, issued.verifier)).rejects.toMatchObject({ status: 401 });
		await expect(auth.redeem(bindingId, issued.callbackUrl, issued.code, proof().verifier)).rejects.toMatchObject({ status: 401 });
		const redeemed = await auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier);
		expect(await auth.authorize(otherBindingId, redeemed.token)).toBeNull();
		await auth.revoke(otherBindingId, redeemed.token);
		expect(await auth.authorize(bindingId, redeemed.token)).not.toBeNull();
		await auth.revoke(bindingId, redeemed.token);
		expect(await auth.authorize(bindingId, redeemed.token)).toBeNull();
	});

	it("consumes a code only once under concurrent redemption", async () => {
		const issued = await handoff();
		const results = await Promise.allSettled(Array.from({ length: 3 }, () => auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier)));
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect((await client.query("select count(*)::int as count from public.app_gateway_sessions")).rows[0].count).toBe(1);
	});

	it("rolls code consumption back if session creation fails", async () => {
		const issued = await handoff();
		await client.query(`create function public.reject_test_session() returns trigger language plpgsql as $$
			begin raise exception 'test session insert failure'; end $$;
			create trigger reject_test_session before insert on public.app_gateway_sessions for each row execute function public.reject_test_session()`);
		await expect(auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier)).rejects.toThrow("test session insert failure");
		expect((await client.query("select * from public.app_gateway_codes")).rows).toHaveLength(1);
		await client.query("drop trigger reject_test_session on public.app_gateway_sessions");
		const redeemed = await auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier);
		await expect(auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier)).rejects.toMatchObject({ status: 401 });
		expect(await auth.authorize(bindingId, redeemed.token)).not.toBeNull();
	});

	it("rejects expired, unknown, malformed, and replayed credentials and prunes expired records", async () => {
		const issued = await handoff();
		await client.query("update public.app_gateway_codes set created_at = clock_timestamp() - interval '2 minutes', expires_at = clock_timestamp() - interval '1 minute'");
		await expect(auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier)).rejects.toMatchObject({ status: 401 });
		await expect(auth.redeem(bindingId, issued.callbackUrl, "bad", issued.verifier)).rejects.toMatchObject({ status: 401 });
		await expect(auth.redeem(bindingId, issued.callbackUrl, proof().verifier, issued.verifier)).rejects.toMatchObject({ status: 401 });
		const token = await session();
		await client.query("update public.app_gateway_sessions set created_at = clock_timestamp() - interval '2 minutes', expires_at = clock_timestamp() - interval '1 minute'");
		expect(await auth.authorize(bindingId, token)).toBeNull();
		expect(await auth.authorize(bindingId, "bad")).toBeNull();
		expect(await auth.authorize(bindingId, proof().verifier)).toBeNull();
		const active = await session();
		await auth.pruneExpired();
		expect((await client.query("select * from public.app_gateway_codes")).rows).toEqual([]);
		expect((await client.query("select * from public.app_gateway_sessions")).rows).toHaveLength(1);
		expect(await auth.authorize(bindingId, active)).not.toBeNull();
	});

	it("permanently invalidates both codes and sessions on revoke/regrant", async () => {
		const issued = await handoff();
		const token = await session();
		await apps.revokeUse(appId, "alice", "bob");
		await apps.grantUse(appId, "alice", "bob");
		await expect(auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier)).rejects.toMatchObject({ status: 401 });
		expect(await auth.authorize(bindingId, token)).toBeNull();
		expect(await auth.authorize(bindingId, await session())).not.toBeNull();
	});

	it("does not revive credentials after removal/reinvite, role changes, or restored verification", async () => {
		const removed = await session();
		await workspaces.removeMember(workspaceId, "alice", "bob");
		const invite = await workspaces.createInvitation(workspaceId, "alice", "bob@example.test", "admin");
		await workspaces.acceptInvitation("bob", invite.token);
		expect(await auth.authorize(bindingId, removed)).toBeNull();
		const admin = await session();
		await workspaces.setMemberRole(workspaceId, "alice", "bob", "member");
		await apps.grantUse(appId, "alice", "bob");
		expect(await auth.authorize(bindingId, admin)).toBeNull();
		const verified = await session();
		await client.query("update public.\"user\" set \"emailVerified\" = false where id = 'bob'");
		await expect(auth.issue(bindingId, principal("bob"), proof().challenge)).rejects.toMatchObject({ status: 403 });
		await client.query("update public.\"user\" set \"emailVerified\" = true where id = 'bob'");
		expect(await auth.authorize(bindingId, verified)).toBeNull();
	});

	it("invalidates credentials on binding disable, origin replacement, and owner transfer", async () => {
		const token = await session();
		const issued = await handoff();
		await client.query("update public.app_gateway_bindings set disabled_at = clock_timestamp() where id = $1", [bindingId]);
		await expect(auth.issue(bindingId, principal("alice"), proof().challenge)).rejects.toMatchObject({ status: 401 });
		await client.query("update public.app_gateway_bindings set disabled_at = null where id = $1", [bindingId]);
		expect(await auth.authorize(bindingId, token)).toBeNull();
		await expect(auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier)).rejects.toMatchObject({ status: 401 });
		const replacement = await session();
		await client.query("update public.app_gateway_bindings set origin = 'https://replacement.apps.example.test' where id = $1", [bindingId]);
		expect(await auth.authorize(bindingId, replacement)).toBeNull();
		const owner = await session("alice");
		await client.query("update public.app_workspaces set owner_id = 'carol' where id = $1", [workspaceId]);
		expect(await auth.authorize(bindingId, owner)).toBeNull();
	});

	it("serializes issuance and redemption with grant revocation", async () => {
		const issued = await handoff();
		const redemption = await Promise.allSettled([auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier), apps.revokeUse(appId, "alice", "bob")]);
		expect(redemption[1].status).toBe("fulfilled");
		if (redemption[0].status === "rejected") expect(redemption[0].reason).toMatchObject({ status: 401 });
		expect((await client.query("select * from public.app_gateway_sessions")).rows).toEqual([]);
		await apps.grantUse(appId, "alice", "bob");
		const issuance = await Promise.allSettled([auth.issue(bindingId, principal("bob"), proof().challenge), apps.revokeUse(appId, "alice", "bob")]);
		expect(issuance[1].status).toBe("fulfilled");
		if (issuance[0].status === "rejected") expect(issuance[0].reason).toMatchObject({ status: 403 });
		expect((await client.query("select * from public.app_gateway_codes")).rows).toEqual([]);
	});

	it("invalidates credentials when an app moves to another workspace", async () => {
		await apps.revokeUse(appId, "alice", "bob");
		const token = await session("alice");
		const issued = await handoff("alice");
		const destination = await workspaces.createWorkspace("alice", "Another team");
		await client.query("delete from public.app_access_events where app_id = $1", [appId]);
		await client.query("update public.apps set workspace_id = $2 where id = $1", [appId, destination.id]);
		expect(await auth.authorize(bindingId, token)).toBeNull();
		await expect(auth.redeem(bindingId, issued.callbackUrl, issued.code, issued.verifier)).rejects.toMatchObject({ status: 401 });
	});

	it("rejects mixed-app bindings, noncanonical origins, and excess database lifetimes", async () => {
		await expect(client.query("insert into public.app_gateway_bindings (app_id, environment, origin) values ($1, 'published', 'https://apps.test/path')", [appId])).rejects.toMatchObject({ code: "23514" });
		await expect(client.query(`insert into public.app_gateway_codes (token_hash, binding_id, app_id, user_id, challenge, expires_at, platform_session_id)
			values ($1, $2, $3, 'bob', $4, clock_timestamp() + interval '3 minutes', 'bob-session')`, ["a".repeat(64), bindingId, appId, proof().challenge])).rejects.toMatchObject({ code: "23514" });
		const otherAppId = (await client.query<{ app_id: string }>("select app_id from public.app_gateway_bindings where id = $1", [otherBindingId])).rows[0].app_id;
		await expect(client.query(`insert into public.app_gateway_sessions (token_hash, binding_id, app_id, user_id, expires_at, platform_session_id)
			values ($1, $2, $3, 'bob', clock_timestamp() + interval '1 minute', 'bob-session')`, ["b".repeat(64), bindingId, otherAppId])).rejects.toMatchObject({ code: "23503" });
	});

	it("denies client reads/writes and prevents service-role origin registration", async () => {
		await session();
		await client.query("grant usage on schema public to foundation_client, service_role; grant select on public.app_gateway_bindings, public.app_gateway_codes, public.app_gateway_sessions to foundation_client; set role foundation_client");
		try {
			for (const table of ["app_gateway_bindings", "app_gateway_codes", "app_gateway_sessions"]) expect((await client.query(`select * from public.${table}`)).rows).toEqual([]);
			await expect(client.query("delete from public.app_gateway_sessions")).rejects.toMatchObject({ code: "42501" });
		} finally { await client.query("reset role"); }
		await client.query("set role service_role");
		try {
			await expect(client.query("insert into public.app_gateway_bindings (app_id, environment, origin) values ($1, 'published', 'https://attacker.test')", [appId])).rejects.toMatchObject({ code: "42501" });
			await expect(client.query("update public.app_gateway_bindings set origin = 'https://attacker.test'")).rejects.toMatchObject({ code: "42501" });
			expect((await client.query("select id from public.app_gateway_bindings where id = $1 for share", [bindingId])).rows).toHaveLength(1);
			await client.query("update public.app_gateway_bindings set disabled_at = clock_timestamp() where id = $1", [bindingId]);
			expect((await client.query("select * from public.app_gateway_sessions")).rows).toEqual([]);
		} finally { await client.query("reset role"); }
	});
});
