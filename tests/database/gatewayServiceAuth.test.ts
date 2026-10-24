import { readFileSync } from "node:fs";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/lib/apps/appStore";
import { GatewayAuthStore } from "../../src/lib/apps/gatewayAuthStore";
import { authenticateGateway, createGatewayServiceCredential, type GatewayServiceCredential } from "../../src/lib/apps/gatewayServiceAuth";
import { WorkspaceStore } from "../../src/lib/apps/workspaceStore";
import { databaseTestConnectionString, prepareDatabaseTestRoles, resetFoundationDatabase } from "./helpers.mjs";
import { createHash, randomBytes } from "node:crypto";

vi.mock("@/config", () => ({ default: { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, WAITING_LIST_ENABLED: false, GATEWAY_CODE_TTL_SECONDS: "60", GATEWAY_SESSION_TTL_SECONDS: "900" } }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: () => pool }));
vi.mock("@/db-helper", () => ({ dbHelper: { isApprovedUser: () => Promise.resolve({ approved: true }) } }));
import { POST as authorize } from "../../src/app/api/gateway/authorize/route";
import { POST as redeem } from "../../src/app/api/gateway/redeem/route";
import { POST as logout } from "../../src/app/api/gateway/logout/route";

const connectionString = databaseTestConnectionString();
const client = new Client({ connectionString });
const pool = new Pool({ connectionString, max: 2 });
const apps = new AppStore(pool);
const workspaces = new WorkspaceStore(pool);
const sessions = new GatewayAuthStore(pool, { codeSeconds: 60, sessionSeconds: 900 });
const migration = readFileSync(new URL("../../supabase/migrations/20261023_gateway_service_credentials.sql", import.meta.url), "utf8");
let bindingId: string;
let otherBindingId: string;
let credential: GatewayServiceCredential;
let appId: string;

function request(body: unknown, token = credential.token): Request {
	return new Request("https://control.test/api/gateway/test", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeAll(async () => { await client.connect(); await prepareDatabaseTestRoles(client); });
afterAll(async () => { await pool.end(); await client.end(); });
beforeEach(async () => {
	await resetFoundationDatabase(client);
	for (const name of ["app_use_grants", "app_gateway_auth", "gateway_service_credentials", "gateway_platform_sessions"]) await client.query(readFileSync(new URL(`../../supabase/migrations/20261023_${name}.sql`, import.meta.url), "utf8"));
	const workspace = await workspaces.createWorkspace("alice", "Team");
	const app = await apps.createApp(workspace.id, "alice", "App");
	appId = app.id;
	await client.query("insert into public.app_workspace_members (workspace_id, user_id, role) values ($1, 'bob', 'member')", [workspace.id]);
	await apps.grantUse(appId, "alice", "bob");
	const other = await apps.createApp(workspace.id, "alice", "Other");
	bindingId = (await client.query<{ id: string }>("insert into public.app_gateway_bindings (app_id, origin) values ($1, 'https://app.test') returning id", [app.id])).rows[0].id;
	otherBindingId = (await client.query<{ id: string }>("insert into public.app_gateway_bindings (app_id, origin) values ($1, 'https://other.test') returning id", [other.id])).rows[0].id;
	credential = createGatewayServiceCredential();
	await client.query("insert into public.app_gateway_service_credentials (id, binding_id, secret_hash, expires_at) values ($1, $2, $3, clock_timestamp() + interval '1 hour')", [credential.id, bindingId, credential.secretHash]);
});

describe("operator-owned gateway service authentication", () => {
	it("runs creator/member redemption, authorization, and logout through real routes and PostgreSQL", async () => {
		for (const userId of ["alice", "bob"]) {
			const verifier = randomBytes(32).toString("base64url");
			const handoff = await sessions.issue(bindingId, { userId, sessionId: `${userId}-session` }, createHash("sha256").update(verifier).digest("base64url"));
			const response = await redeem(request({ code: handoff.code, callbackUrl: handoff.callbackUrl, verifier }));
			expect(response.status).toBe(200);
			const body = await response.json() as { token: string; identity: { id: string } };
			expect(body.identity.id).toBe(userId);
			expect(await (await authorize(request({ token: body.token }))).json()).toEqual({ identity: { id: userId, email: `${userId}@example.test` } });
			expect((await logout(request({ token: body.token }))).status).toBe(200);
			expect((await authorize(request({ token: body.token }))).status).toBe(403);
		}
		await expect(sessions.issue(bindingId, { userId: "carol", sessionId: "carol-session" }, createHash("sha256").update(randomBytes(32)).digest("base64url"))).rejects.toMatchObject({ status: 403 });
	});

	it("denies real API decisions after user grant or service key revocation", async () => {
		const verifier = randomBytes(32).toString("base64url");
		const handoff = await sessions.issue(bindingId, { userId: "bob", sessionId: "bob-session" }, createHash("sha256").update(verifier).digest("base64url"));
		const response = await redeem(request({ code: handoff.code, callbackUrl: handoff.callbackUrl, verifier }));
		expect(response.status).toBe(200);
		const body = await response.json() as { token: string };
		await apps.revokeUse(appId, "alice", "bob");
		expect((await authorize(request({ token: body.token }))).status).toBe(403);
		await client.query("update public.app_gateway_service_credentials set revoked_at = clock_timestamp() where id = $1", [credential.id]);
		expect((await logout(request({ token: body.token }))).status).toBe(401);
	});

	it("authenticates hash-only credentials and derives the binding from database state", async () => {
		await client.query(migration);
		expect(await authenticateGateway(pool, `Bearer ${credential.token}`)).toEqual({ bindingId });
		expect(JSON.stringify((await client.query("select * from public.app_gateway_service_credentials")).rows)).not.toContain(credential.token);
		const second = createGatewayServiceCredential();
		expect(second.id).not.toBe(credential.id);
		expect(second.token).not.toBe(credential.token);
	});

	it("rejects missing, malformed, unknown, mismatched and expired credentials", async () => {
		for (const value of [null, "", `Basic ${credential.token}`, `Bearer ${bindingId}`, `Bearer ${createGatewayServiceCredential().token}`, `Bearer sd_gateway_${credential.id}.${"x".repeat(43)}`]) {
			await expect(authenticateGateway(pool, value)).rejects.toMatchObject({ status: 401 });
		}
		await client.query("update public.app_gateway_service_credentials set created_at = clock_timestamp() - interval '2 minutes', expires_at = clock_timestamp() - interval '1 minute'");
		await expect(authenticateGateway(pool, `Bearer ${credential.token}`)).rejects.toMatchObject({ status: 401 });
	});

	it("rechecks key revocation and binding disable without caching positive authentication", async () => {
		expect(await authenticateGateway(pool, `Bearer ${credential.token}`)).toEqual({ bindingId });
		await client.query("update public.app_gateway_service_credentials set revoked_at = clock_timestamp() where id = $1", [credential.id]);
		await expect(authenticateGateway(pool, `Bearer ${credential.token}`)).rejects.toMatchObject({ status: 401 });
		await client.query("update public.app_gateway_service_credentials set revoked_at = null where id = $1", [credential.id]);
		await client.query("update public.app_gateway_bindings set disabled_at = clock_timestamp() where id = $1", [bindingId]);
		await expect(authenticateGateway(pool, `Bearer ${credential.token}`)).rejects.toMatchObject({ status: 401 });
	});

	it("cannot use the authenticated binding to redeem or authorize another app's credentials", async () => {
		const verifier = randomBytes(32).toString("base64url");
		const handoff = await sessions.issue(otherBindingId, { userId: "alice", sessionId: "alice-session" }, createHash("sha256").update(verifier).digest("base64url"));
		const principal = await authenticateGateway(pool, `Bearer ${credential.token}`);
		await expect(sessions.redeem(principal.bindingId, handoff.callbackUrl, handoff.code, verifier)).rejects.toMatchObject({ status: 401 });
		const session = await sessions.redeem(otherBindingId, handoff.callbackUrl, handoff.code, verifier);
		expect(await sessions.authorize(principal.bindingId, session.token)).toBeNull();
	});

	it("denies browser-client reads/writes and keeps service-role registration/revocation operator-only", async () => {
		await client.query("grant usage on schema public to foundation_client, service_role; grant select on public.app_gateway_service_credentials to foundation_client; set role foundation_client");
		try {
			expect((await client.query("select * from public.app_gateway_service_credentials")).rows).toEqual([]);
			await expect(client.query("delete from public.app_gateway_service_credentials")).rejects.toMatchObject({ code: "42501" });
		} finally { await client.query("reset role"); }
		await client.query("set role service_role");
		try {
			expect((await client.query("select id from public.app_gateway_service_credentials")).rows).toHaveLength(1);
			await expect(client.query("update public.app_gateway_service_credentials set revoked_at = clock_timestamp()")).rejects.toMatchObject({ code: "42501" });
			await expect(client.query("insert into public.app_gateway_service_credentials (id, binding_id, secret_hash, expires_at) values (gen_random_uuid(), $1, $2, clock_timestamp() + interval '1 hour')", [bindingId, credential.secretHash])).rejects.toMatchObject({ code: "42501" });
		} finally { await client.query("reset role"); }
	});
});
