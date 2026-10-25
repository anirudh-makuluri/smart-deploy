import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { readFileSync } from "node:fs";

// Better Auth initializes schema inspection when Next loads auth. Prepare its
// complete shape before starting that process, rather than racing a beforeAll.
const connectionString = process.env.TEST_DATABASE_URL;
const loginTest = process.env.RUN_APP_LOGIN_BROWSER_TESTS === "1";
const enabled = process.env.RUN_DATABASE_BROWSER_TESTS === "1" || process.env.RUN_INVITEE_BROWSER_TESTS === "1" || loginTest;
if (!enabled || !connectionString || process.env.DATABASE_URL !== connectionString
	|| process.env.BETTER_AUTH_URL !== (loginTest ? "https://localhost:34433" : "http://localhost:3000") || !process.env.BETTER_AUTH_SECRET) {
	throw new Error("Explicit disposable browser-test configuration required.");
}
const target = new URL(connectionString);
if (!["postgres:", "postgresql:"].includes(target.protocol)
	|| !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
	|| target.pathname !== "/smartdeploy_foundation_test" || target.search !== "") {
	throw new Error("Only the disposable local smartdeploy_foundation_test database may be reset.");
}
const pool = new Pool({ connectionString, max: 1 });
try {
	await pool.query("drop schema public cascade; create schema public");
	await (await getMigrations({ database: pool, secret: process.env.BETTER_AUTH_SECRET,
		baseURL: process.env.BETTER_AUTH_URL, emailAndPassword: { enabled: true } })).runMigrations();
	await pool.query(`
		create schema if not exists auth;
		create or replace function auth.uid() returns uuid language sql as 'select null::uuid';
		do $$ begin
		  if not exists (select 1 from pg_roles where rolname = 'service_role') then
		    create role service_role nologin bypassrls;
		  end if;
		end $$;
	`);
	await pool.query(readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8"));
	for (const name of ["app_workspaces", "workspace_invitations", "app_use_grants", "app_gateway_auth", "gateway_service_credentials", "gateway_platform_sessions"]) {
		await pool.query(readFileSync(new URL(`../../supabase/migrations/20261023_${name}.sql`, import.meta.url), "utf8"));
	}
	await pool.query(readFileSync(new URL("../../supabase/migrations/20261024_gateway_environments.sql", import.meta.url), "utf8"));
} finally {
	await pool.end();
}
