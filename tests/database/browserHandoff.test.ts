import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client, Pool } from "pg";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/lib/apps/appStore";
import { GatewayAuthStore } from "../../src/lib/apps/gatewayAuthStore";
import { WorkspaceStore } from "../../src/lib/apps/workspaceStore";
import { createGatewayServiceCredential } from "../../src/lib/apps/gatewayServiceAuth";
import { databaseTestConnectionString, prepareDatabaseTestRoles, resetFoundationDatabase } from "./helpers.mjs";

const mocks = vi.hoisted(() => ({ approved: vi.fn() }));
vi.mock("@/config", () => ({ default: { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, WAITING_LIST_ENABLED: true,
	BETTER_AUTH_URL: "https://control.test", GATEWAY_CODE_TTL_SECONDS: "60", GATEWAY_SESSION_TTL_SECONDS: "900" } }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: () => pool }));
vi.mock("@/db-helper", () => ({ dbHelper: { isApprovedUser: mocks.approved } }));
vi.mock("@/lib/auth", () => ({ auth: { api: {
	getSession: (input: { headers: Headers; query: { disableCookieCache: boolean; disableRefresh: boolean } }) => fixtureAuth.api.getSession(input),
} } }));
import { POST } from "../../src/app/api/apps/handoff/route";
import { POST as acceptInvitation } from "../../src/app/api/workspace-invitations/accept/route";
import { POST as inspectInvitation } from "../../src/app/api/workspace-invitations/inspect/route";
import { POST as redeem } from "../../src/app/api/gateway/redeem/route";
import { POST as authorize } from "../../src/app/api/gateway/authorize/route";
import { GET as listWorkspaces } from "../../src/app/api/workspaces/route";
import { POST as createWorkspace } from "../../src/app/api/workspaces/route";

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
	for (const name of ["workspace_invitations", "app_use_grants", "app_gateway_auth", "gateway_service_credentials", "gateway_platform_sessions"]) {
		await client.query(readFileSync(new URL(`../../supabase/migrations/20261023_${name}.sql`, import.meta.url), "utf8"));
	}
	await client.query(readFileSync(new URL("../../supabase/migrations/20261024_gateway_environments.sql", import.meta.url), "utf8"));
	({ userId, cookie, sessionId } = await login("owner@example.test"));
	const workspace = await workspaces.createWorkspace(userId, "Team");
	workspaceId = workspace.id;
	const app = await apps.createApp(workspaceId, userId, "App");
	appId = app.id;
	bindingId = (await client.query<{ id: string }>("insert into public.app_gateway_bindings (app_id, environment, origin) values ($1, 'published', 'https://app.test') returning id", [appId])).rows[0].id;
	mocks.approved.mockReset().mockResolvedValue({ approved: true });
});

describe("signed Better Auth browser issuance with PostgreSQL", () => {
	it("denies previews to an approved signed-in member with an app-use grant while allowing the published binding", async () => {
		const member = await login("published-only@example.test");
		const invitation = await workspaces.createInvitation(workspaceId, userId, "published-only@example.test", "member");
		await workspaces.acceptInvitation(member.userId, invitation.token);
		await apps.grantUse(appId, userId, member.userId);
		const preview = (await client.query<{ id: string }>("insert into public.app_gateway_bindings (app_id, origin) values ($1, 'https://preview.test') returning id", [appId])).rows[0].id;
		expect((await POST(request({ ...transaction().input, bindingId: preview }, member.cookie))).status).toBe(403);
		expect(await codes()).toBe(0);
		expect((await POST(request(transaction().input, member.cookie))).status).toBe(200);
	});

	it("permits approved owners/admins to initiate previews and rechecks management after demotion", async () => {
		const preview = (await client.query<{ id: string }>("insert into public.app_gateway_bindings (app_id, origin) values ($1, 'https://preview.test') returning id", [appId])).rows[0].id;
		const ownerTx = transaction();
		const ownerResponse = await POST(request({ ...ownerTx.input, bindingId: preview }));
		expect(ownerResponse.status).toBe(200);
		const ownerCode = await ownerResponse.json() as { code: string; callbackUrl: string };
		const ownerSession = await sessions.redeem(preview, ownerCode.callbackUrl, ownerCode.code, ownerTx.verifier);
		expect((await sessions.authorize(preview, ownerSession.token))?.id).toBe(userId);
		const admin = await login("preview-admin@example.test");
		const invitation = await workspaces.createInvitation(workspaceId, userId, "preview-admin@example.test", "admin");
		await workspaces.acceptInvitation(admin.userId, invitation.token);
		const adminTx = transaction();
		const adminResponse = await POST(request({ ...adminTx.input, bindingId: preview }, admin.cookie));
		expect(adminResponse.status).toBe(200);
		const adminCode = await adminResponse.json() as { code: string; callbackUrl: string };
		mocks.approved.mockResolvedValue({ approved: false });
		expect((await POST(request({ ...transaction().input, bindingId: preview }, admin.cookie))).status).toBe(403);
		mocks.approved.mockResolvedValue({ approved: true });
		await workspaces.setMemberRole(workspaceId, userId, admin.userId, "member");
		await apps.grantUse(appId, userId, admin.userId);
		await expect(sessions.redeem(preview, adminCode.callbackUrl, adminCode.code, adminTx.verifier)).rejects.toMatchObject({ status: 401 });
		expect((await POST(request({ ...transaction().input, bindingId: preview }, admin.cookie))).status).toBe(403);
	});

	it("inspects a member invitation with a real unapproved signed login without joining or consuming", async () => {
		const member = await login("inspect-member@example.test");
		const invitation = await workspaces.createInvitation(workspaceId, userId, "inspect-member@example.test", "member");
		mocks.approved.mockResolvedValue({ approved: false });
		const inspection = () => new Request("https://control.test/api/workspace-invitations/inspect", { method: "POST",
			headers: { origin: "https://control.test", "content-type": "application/json", cookie: member.cookie }, body: JSON.stringify({ token: invitation.token }) });
		for (let attempt = 0; attempt < 2; attempt++) {
			const response = await inspectInvitation(inspection());
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(await response.json()).toEqual({ workspace: { id: workspaceId, name: "Team" }, role: "member", expiresAt: invitation.expiresAt.toISOString() });
		}
		expect((await client.query("select accepted_at from public.app_workspace_invitations where id = $1", [invitation.id])).rows[0].accepted_at).toBeNull();
		expect((await client.query("select * from public.app_workspace_members where user_id = $1", [member.userId])).rowCount).toBe(0);
		expect((await POST(request(transaction().input, member.cookie))).status).toBe(403);
		await workspaces.revokeInvitation(workspaceId, userId, invitation.id);
		expect((await inspectInvitation(inspection())).status).toBe(410);
		const acceptance = new Request("https://control.test/api/workspace-invitations/accept", { method: "POST",
			headers: { origin: "https://control.test", "content-type": "application/json", cookie: member.cookie }, body: JSON.stringify({ token: invitation.token }) });
		expect((await acceptInvitation(acceptance)).status).toBe(410);
	});

	it("does not reveal invitation details from forged, wrong-user, unverified or expired signed logins", async () => {
		const member = await login("inspect-identity@example.test");
		const invitation = await workspaces.createInvitation(workspaceId, userId, "inspect-identity@example.test", "member");
		const inspection = (cookieValue: string) => new Request("https://control.test/api/workspace-invitations/inspect", { method: "POST",
			headers: { origin: "https://control.test", "content-type": "application/json", cookie: cookieValue }, body: JSON.stringify({ token: invitation.token }) });
		expect((await inspectInvitation(inspection(""))).status).toBe(401);
		expect((await inspectInvitation(inspection("__Secure-better-auth.session_token=forged"))).status).toBe(401);
		expect((await inspectInvitation(inspection(cookie))).status).toBe(403);
		await client.query('update public."user" set "emailVerified" = false where id = $1', [member.userId]);
		expect((await inspectInvitation(inspection(member.cookie))).status).toBe(403);
		await client.query('update public."user" set "emailVerified" = true where id = $1', [member.userId]);
		await client.query('update public.session set "expiresAt" = clock_timestamp() - interval \'1 second\' where id = $1', [member.sessionId]);
		expect((await inspectInvitation(inspection(member.cookie))).status).toBe(401);
		expect((await client.query("select accepted_at from public.app_workspace_invitations where id = $1", [invitation.id])).rows[0].accepted_at).toBeNull();
	});

	it("requires platform approval to inspect an admin invitation and does not consume it", async () => {
		const member = await login("inspect-admin@example.test");
		const invitation = await workspaces.createInvitation(workspaceId, userId, "inspect-admin@example.test", "admin");
		const inspection = () => new Request("https://control.test/api/workspace-invitations/inspect", { method: "POST",
			headers: { origin: "https://control.test", "content-type": "application/json", cookie: member.cookie }, body: JSON.stringify({ token: invitation.token }) });
		mocks.approved.mockResolvedValue({ approved: false });
		expect((await inspectInvitation(inspection())).status).toBe(403);
		mocks.approved.mockResolvedValue({ approved: true });
		const response = await inspectInvitation(inspection());
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ role: "admin" });
		expect((await client.query("select accepted_at from public.app_workspace_invitations where id = $1", [invitation.id])).rows[0].accepted_at).toBeNull();
		expect((await client.query("select * from public.app_workspace_members where user_id = $1", [member.userId])).rowCount).toBe(0);
	});

	it("accepts an unapproved verified invitee, limits access to the granted app, and denies management and revoked use", async () => {
		const member = await login("invitee@example.test");
		const invitation = await workspaces.createInvitation(workspaceId, userId, "invitee@example.test", "member");
		mocks.approved.mockResolvedValue({ approved: false });
		const acceptance = new Request("https://control.test/api/workspace-invitations/accept", { method: "POST",
			headers: { origin: "https://control.test", "content-type": "application/json", cookie: member.cookie }, body: JSON.stringify({ token: invitation.token }) });
		expect((await acceptInvitation(acceptance)).status).toBe(200);
		expect((await POST(request(transaction().input, member.cookie))).status).toBe(403);
		await apps.grantUse(appId, userId, member.userId);
		const tx = transaction();
		const preview = (await client.query<{ id: string }>("insert into public.app_gateway_bindings (app_id, origin) values ($1, 'https://preview.test') returning id", [appId])).rows[0].id;
		expect((await POST(request({ ...transaction().input, bindingId: preview }, member.cookie))).status).toBe(403);
		const issued = await POST(request(tx.input, member.cookie));
		expect(issued.status).toBe(200);
		const handoff = await issued.json() as { code: string; callbackUrl: string };
		const credential = createGatewayServiceCredential();
		await client.query("insert into public.app_gateway_service_credentials (id, binding_id, secret_hash, expires_at) values ($1, $2, $3, clock_timestamp() + interval '1 hour')", [credential.id, bindingId, credential.secretHash]);
		const serviceRequest = (body: unknown) => new Request("https://control.test/api/gateway/test", { method: "POST",
			headers: { authorization: `Bearer ${credential.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
		const redeemed = await redeem(serviceRequest({ code: handoff.code, callbackUrl: handoff.callbackUrl, verifier: tx.verifier }));
		expect(redeemed.status).toBe(200);
		const body = await redeemed.json() as { token: string };
		expect((await authorize(serviceRequest({ token: body.token }))).status).toBe(200);
		const other = await apps.createApp(workspaceId, userId, "Not shared");
		const otherBinding = (await client.query<{ id: string }>("insert into public.app_gateway_bindings (app_id, environment, origin) values ($1, 'published', 'https://not-shared.test') returning id", [other.id])).rows[0].id;
		expect((await POST(request({ ...transaction().input, bindingId: otherBinding }, member.cookie))).status).toBe(403);
		expect((await listWorkspaces(new Request("https://control.test/api/workspaces", { headers: { cookie: member.cookie } }))).status).toBe(403);
		expect((await createWorkspace(new Request("https://control.test/api/workspaces", { method: "POST", headers: { origin: "https://control.test", cookie: member.cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Denied" }) }))).status).toBe(403);
		await apps.revokeUse(appId, userId, member.userId);
		expect((await authorize(serviceRequest({ token: body.token }))).status).toBe(403);
		expect((await POST(request(transaction().input, member.cookie))).status).toBe(403);
	});

	it("does not consume an administrator invitation before platform approval", async () => {
		const member = await login("administrator@example.test");
		const invitation = await workspaces.createInvitation(workspaceId, userId, "administrator@example.test", "admin");
		mocks.approved.mockResolvedValue({ approved: false });
		const acceptance = () => new Request("https://control.test/api/workspace-invitations/accept", { method: "POST",
			headers: { origin: "https://control.test", "content-type": "application/json", cookie: member.cookie }, body: JSON.stringify({ token: invitation.token }) });
		expect((await acceptInvitation(acceptance())).status).toBe(403);
		expect((await client.query("select accepted_at from public.app_workspace_invitations where id = $1", [invitation.id])).rows[0].accepted_at).toBeNull();
		expect((await client.query("select user_id from public.app_workspace_members where user_id = $1", [member.userId])).rowCount).toBe(0);
		mocks.approved.mockResolvedValue({ approved: true });
		expect((await acceptInvitation(acceptance())).status).toBe(200);
		expect((await client.query("select role from public.app_workspace_members where user_id = $1", [member.userId])).rows[0].role).toBe("admin");
	});

	it("requires accepted invitation provenance, current verified email, ordinary membership, grant and enabled binding", async () => {
		const member = await login("member-bound@example.test");
		const invitation = await workspaces.createInvitation(workspaceId, userId, "member-bound@example.test", "member");
		await client.query("insert into public.app_workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')", [workspaceId, member.userId]);
		await apps.grantUse(appId, userId, member.userId);
		expect(await sessions.isInvitedMember(bindingId, member.userId)).toBe(false);
		await workspaces.acceptInvitation(member.userId, invitation.token, true);
		expect(await sessions.isInvitedMember(bindingId, member.userId)).toBe(true);
		expect(await sessions.isInvitedMember(bindingId, userId)).toBe(false);
		await client.query('update public."user" set email = \'changed@example.test\' where id = $1', [member.userId]);
		expect(await sessions.isInvitedMember(bindingId, member.userId)).toBe(false);
		await client.query('update public."user" set email = \'member-bound@example.test\', "emailVerified" = false where id = $1', [member.userId]);
		expect(await sessions.isInvitedMember(bindingId, member.userId)).toBe(false);
		await client.query('update public."user" set "emailVerified" = true where id = $1', [member.userId]);
		expect(await sessions.isInvitedMember(bindingId, member.userId)).toBe(true);
		await workspaces.setMemberRole(workspaceId, userId, member.userId, "admin");
		expect(await sessions.isInvitedMember(bindingId, member.userId)).toBe(false);
		await workspaces.setMemberRole(workspaceId, userId, member.userId, "member");
		await apps.grantUse(appId, userId, member.userId);
		await client.query("update public.app_gateway_bindings set disabled_at = clock_timestamp() where id = $1", [bindingId]);
		expect(await sessions.isInvitedMember(bindingId, member.userId)).toBe(false);
	});
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
