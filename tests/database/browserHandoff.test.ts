import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client, Pool } from "pg";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/lib/apps/appStore";
import { GatewayAuthStore } from "../../src/lib/apps/gatewayAuthStore";
import { WorkspaceStore } from "../../src/lib/apps/workspaceStore";
import { databaseTestConnectionString, prepareDatabaseTestRoles, resetFoundationDatabase } from "./helpers";

const mocks = vi.hoisted(() => ({ approved: vi.fn() }));
vi.mock("@/config", () => ({ default: { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, WAITING_LIST_ENABLED: true,
	BETTER_AUTH_URL: "https://control.test", GATEWAY_CODE_TTL_SECONDS: "60", GATEWAY_SESSION_TTL_SECONDS: "900" } }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: () => pool }));
vi.mock("@/db-helper", () => ({ dbHelper: { isApprovedUser: mocks.approved } }));
vi.mock("@/lib/auth", () => ({ auth: { api: {
	getSession: (input: { headers: Headers; query: { disableCookieCache: boolean; disableRefresh: boolean } }) => fixtureAuth.api.getSession(input),
} } }));
import { POST } from "../../src/app/api/apps/handoff/route";

const connectionString = databaseTestConnectionString();
const client = new Client({ connectionString });
const pool = new Pool({ connectionString, max: 3 });
const options = { database: pool, baseURL: "https://control.test", secret: "local-handoff-test-secret-only-never-for-production-123456",
	emailAndPassword: { enabled: true }, logger: { disabled: true } };
const fixtureAuth = betterAuth(options);
const apps = new AppStore(pool);
const workspaces = new WorkspaceStore(pool);
const sessions = new GatewayAuthStore(pool, { codeSeconds: 60, sessionSeconds: 900 });
let userId: string;
let cookie: string;
let sessionId: string;
let bindingId: string;
let workspaceId: string;
let appId: string;

async function login(email: string): Promise<{ userId: string; sessionId: string; cookie: string }> {
	const response = await fixtureAuth.handler(new Request("https://control.test/api/auth/sign-up/email", { method: "POST",
		headers: { origin: "https://control.test", "content-type": "application/json" },
		body: JSON.stringify({ name: "Fixture user", email, password: "local-password-for-tests-123" }),
	}));
	expect(response.status).toBe(200);
	const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
	const principal = await fixtureAuth.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true, disableRefresh: true } });
	if (!principal) throw new Error("Fixture login unavailable.");
	await client.query('update public."user" set "emailVerified" = true where id = $1', [principal.user.id]);
	return { userId: principal.user.id, sessionId: principal.session.id, cookie };
}
function transaction() {
	const verifier = randomBytes(32).toString("base64url");
	return { verifier, input: { bindingId, challenge: createHash("sha256").update(verifier).digest("base64url"), state: randomBytes(32).toString("base64url") } };
}
function request(body: unknown, cookieValue = cookie): Request {
	return new Request("https://control.test/api/apps/handoff", { method: "POST", headers: {
		origin: "https://control.test", "sec-fetch-site": "same-origin", "content-type": "application/json", cookie: cookieValue,
	}, body: JSON.stringify(body) });
}
async function codes(): Promise<number> {
	return Number((await client.query<{ count: string }>("select count(*) from public.app_gateway_codes")).rows[0].count);
}

beforeAll(async () => { await client.connect(); await prepareDatabaseTestRoles(client); });
afterAll(async () => { await pool.end(); await client.end(); });
beforeEach(async () => {
	await resetFoundationDatabase(client);
	await client.query('delete from public."user"');
	await (await getMigrations(options)).runMigrations();
	for (const name of ["app_use_grants", "app_gateway_auth", "gateway_platform_sessions"]) {
		await client.query(readFileSync(new URL(`../../supabase/migrations/20261023_${name}.sql`, import.meta.url), "utf8"));
	}
	({ userId, cookie, sessionId } = await login("owner@example.test"));
	const workspace = await workspaces.createWorkspace(userId, "Team");
	workspaceId = workspace.id;
	const app = await apps.createApp(workspaceId, userId, "App");
	appId = app.id;
	bindingId = (await client.query<{ id: string }>("insert into public.app_gateway_bindings (app_id, origin) values ($1, 'https://app.test') returning id", [appId])).rows[0].id;
	mocks.approved.mockReset().mockResolvedValue({ approved: true });
});

describe("signed Better Auth browser issuance with PostgreSQL", () => {
	it("issues a hash-only platform-bound code and redeems it once with the correct proof", async () => {
		const tx = transaction();
		const response = await POST(request(tx.input));
		expect(response.status).toBe(200);
		const handoff = await response.json() as { code: string; callbackUrl: string; state: string };
		expect(handoff.callbackUrl).toBe("https://app.test/__smartdeploy/callback");
		expect(handoff.state).toBe(tx.input.state);
		const row = (await client.query("select * from public.app_gateway_codes")).rows[0];
		expect(row.platform_session_id).toBe(sessionId);
		expect(JSON.stringify(row)).not.toContain(handoff.code);
		await expect(sessions.redeem(bindingId, handoff.callbackUrl, handoff.code, randomBytes(32).toString("base64url"))).rejects.toMatchObject({ status: 401 });
		const session = await sessions.redeem(bindingId, handoff.callbackUrl, handoff.code, tx.verifier);
		expect((await sessions.authorize(bindingId, session.token))?.id).toBe(userId);
		await expect(sessions.redeem(bindingId, handoff.callbackUrl, handoff.code, tx.verifier)).rejects.toMatchObject({ status: 401 });
	});
	it("denies outsiders and ordinary members without a grant, and permits a current explicit grant", async () => {
		const member = await login("member@example.test");
		const tx = transaction();
		expect((await POST(request(tx.input, member.cookie))).status).toBe(403);
		await client.query("insert into public.app_workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')", [workspaceId, member.userId]);
		expect((await POST(request(tx.input, member.cookie))).status).toBe(403);
		expect(await codes()).toBe(0);
		await apps.grantUse(appId, userId, member.userId);
		const response = await POST(request(tx.input, member.cookie));
		expect(response.status).toBe(200);
		const handoff = await response.json() as { code: string; callbackUrl: string };
		await apps.revokeUse(appId, userId, member.userId);
		await expect(sessions.redeem(bindingId, handoff.callbackUrl, handoff.code, tx.verifier)).rejects.toMatchObject({ status: 401 });
		expect(await codes()).toBe(0);
	});
	it("does not trust a signed cookie after verification is removed or the platform session expires", async () => {
		await client.query('update public."user" set "emailVerified" = false where id = $1', [userId]);
		expect((await POST(request(transaction().input))).status).toBe(403);
		await client.query('update public."user" set "emailVerified" = true where id = $1', [userId]);
		await client.query('update public.session set "expiresAt" = clock_timestamp() - interval \'1 second\' where id = $1', [sessionId]);
		expect((await POST(request(transaction().input))).status).toBe(401);
		expect(await codes()).toBe(0);
	});
	it("rejects missing/forged authentication, hostile origins, and callback overrides without creating records", async () => {
		const input = transaction().input;
		for (const value of ["", "__Secure-better-auth.session_token=forged"]) expect((await POST(request(input, value))).status).toBe(401);
		const hostile = request(input); hostile.headers.set("origin", "https://app.control.test");
		expect((await POST(hostile)).status).toBe(403);
		expect((await POST(request({ ...input, callbackUrl: "https://attacker.test" }))).status).toBe(400);
		expect(await codes()).toBe(0);
	});
	it("fails closed for unknown/disabled bindings and current platform approval denial/failure", async () => {
		const input = transaction().input;
		expect((await POST(request({ ...input, bindingId: "fa03e952-f705-42e2-9706-6a0b425de83d" }))).status).toBe(401);
		await client.query("update public.app_gateway_bindings set disabled_at = clock_timestamp() where id = $1", [bindingId]);
		expect((await POST(request(input))).status).toBe(401);
		mocks.approved.mockResolvedValueOnce({ approved: false });
		expect((await POST(request(input))).status).toBe(403);
		mocks.approved.mockResolvedValueOnce({ approved: true, error: "dependency failed" });
		expect((await POST(request(input))).status).toBe(503);
		expect(await codes()).toBe(0);
	});
	it("cannot redeem issued browser handoffs after platform logout", async () => {
		const tx = transaction();
		const response = await POST(request(tx.input));
		expect(response.status).toBe(200);
		const handoff = await response.json() as { code: string; callbackUrl: string };
		await client.query("delete from public.session where id = $1", [sessionId]);
		expect(await codes()).toBe(0);
		await expect(sessions.redeem(bindingId, handoff.callbackUrl, handoff.code, tx.verifier)).rejects.toMatchObject({ status: 401 });
		expect((await POST(request(tx.input))).status).toBe(401);
	});
});
