import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client, Pool } from "pg";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/lib/apps/appStore";
import { GatewayAuthStore } from "../../src/lib/apps/gatewayAuthStore";
import { verifiedPlatformLogout } from "../../src/lib/apps/platformLogout";
import { WorkspaceStore } from "../../src/lib/apps/workspaceStore";
import { databaseTestConnectionString, prepareDatabaseTestRoles, resetFoundationDatabase } from "./helpers.mjs";

const connectionString = databaseTestConnectionString();
const client = new Client({ connectionString });
const pool = new Pool({ connectionString, max: 3 });
const options = { database: pool, baseURL: "https://control.test", secret: "local-postgres-logout-test-only-secret-never-for-production", emailAndPassword: { enabled: true }, logger: { disabled: true } };
const auth = betterAuth(options);
const sessions = new GatewayAuthStore(pool, { codeSeconds: 60, sessionSeconds: 900 });
const workspaces = new WorkspaceStore(pool);
const apps = new AppStore(pool);
let userId: string;
let cookie: string;
let platformSessionId: string;
let bindingId: string;

function authRequest(path: string, body: unknown, cookieValue = ""): Request {
	return new Request(`https://control.test/api/auth/${path}`, { method: "POST", headers: { origin: "https://control.test", "content-type": "application/json", cookie: cookieValue }, body: JSON.stringify(body) });
}
async function signIn(): Promise<{ cookie: string; sessionId: string }> {
	const response = await auth.handler(authRequest("sign-in/email", { email: "owner@example.test", password: "local-test-password-123" }));
	expect(response.status).toBe(200);
	const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
	const principal = await auth.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true, disableRefresh: true } });
	if (!principal) throw new Error("Fixture platform login unavailable.");
	return { cookie, sessionId: principal.session.id };
}
async function appSession(sessionId = platformSessionId): Promise<string> {
	const verifier = randomBytes(32).toString("base64url");
	const handoff = await sessions.issue(bindingId, { userId, sessionId }, createHash("sha256").update(verifier).digest("base64url"));
	return (await sessions.redeem(bindingId, handoff.callbackUrl, handoff.code, verifier)).token;
}
function logout() {
	const request = authRequest("sign-out", {}, cookie);
	return verifiedPlatformLogout(request, {
		getPool: () => pool,
		loadSession: () => auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } }),
		post: (req) => auth.handler(req),
	});
}

beforeAll(async () => { await client.connect(); await prepareDatabaseTestRoles(client); });
afterAll(async () => { await pool.end(); await client.end(); });
beforeEach(async () => {
	await resetFoundationDatabase(client);
	await client.query('delete from public."user"');
	// Library-generated schema in the disposable database, never production.
	await (await getMigrations(options)).runMigrations();
	for (const name of ["app_use_grants", "app_gateway_auth", "gateway_platform_sessions"]) await client.query(readFileSync(new URL(`../../supabase/migrations/20261023_${name}.sql`, import.meta.url), "utf8"));
	const signup = await auth.handler(authRequest("sign-up/email", { name: "Owner", email: "owner@example.test", password: "local-test-password-123" }));
	expect(signup.status).toBe(200);
	const body = await signup.json() as { user: { id: string } };
	userId = body.user.id;
	await client.query('update public."user" set "emailVerified" = true where id = $1', [userId]);
	const login = await signIn();
	cookie = login.cookie;
	platformSessionId = login.sessionId;
	const workspace = await workspaces.createWorkspace(userId, "Team");
	const app = await apps.createApp(workspace.id, userId, "App");
	bindingId = (await client.query<{ id: string }>("insert into public.app_gateway_bindings (app_id, origin) values ($1, 'https://app.test') returning id", [app.id])).rows[0].id;
});

describe("Better Auth and PostgreSQL global app logout", () => {
	it("uses the real signed login and handler to revoke app sessions from all platform logins", async () => {
		const first = await appSession();
		const secondLogin = await signIn();
		const second = await appSession(secondLogin.sessionId);
		const response = await logout();
		expect(response.status).toBe(200);
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(await sessions.authorize(bindingId, first)).toBeNull();
		expect(await sessions.authorize(bindingId, second)).toBeNull();
		expect(await auth.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true, disableRefresh: true } })).toBeNull();
		expect(await auth.api.getSession({ headers: new Headers({ cookie: secondLogin.cookie }), query: { disableCookieCache: true, disableRefresh: true } })).not.toBeNull();
	});

	it("rolls back both platform and app revocation on failure and does not clear the cookie", async () => {
		const token = await appSession();
		await client.query(`create function public.fail_logout_test() returns trigger language plpgsql as $$ begin raise exception 'test revoke failure'; end $$;
			create trigger fail_logout_test before delete on public.app_gateway_sessions for each row execute function public.fail_logout_test()`);
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const response = await logout();
			expect(response.status).toBe(503);
			expect(response.headers.get("set-cookie")).toBeNull();
			expect(await sessions.authorize(bindingId, token)).not.toBeNull();
			expect(await auth.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true, disableRefresh: true } })).not.toBeNull();
			// Reproduce the installed library's swallowed deletion error separately.
			const raw = await auth.handler(authRequest("sign-out", {}, cookie));
			expect(raw.status).toBe(200);
			expect((await client.query("select id from public.session where id = $1", [platformSessionId])).rows).toHaveLength(1);
		} finally { log.mockRestore(); }
	});

	it("does not globally revoke other active logins when an expired session is cleaned up", async () => {
		const token = await appSession();
		await client.query(`insert into public.session (id, "userId", token, "expiresAt", "createdAt", "updatedAt")
			values ('expired-cleanup', $1, 'local-expired-token', clock_timestamp() - interval '1 day', clock_timestamp() - interval '2 days', clock_timestamp() - interval '2 days')`, [userId]);
		await client.query("delete from public.session where id = 'expired-cleanup'");
		expect(await sessions.authorize(bindingId, token)).not.toBeNull();
	});

	it("rejects cross-origin logout before revoking the authenticated user's apps", async () => {
		const token = await appSession();
		const req = authRequest("sign-out", {}, cookie);
		req.headers.set("origin", "https://attacker.test");
		const response = await verifiedPlatformLogout(req, { getPool: () => pool, loadSession: () => auth.api.getSession({ headers: req.headers }), post: (request) => auth.handler(request) });
		expect(response.status).toBe(403);
		expect(await sessions.authorize(bindingId, token)).not.toBeNull();
	});
});
