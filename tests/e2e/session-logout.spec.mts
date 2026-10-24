import { readFileSync } from "node:fs";
import { Client, Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { expect, test, type Page } from "@playwright/test";
import { databaseTestConnectionString, prepareDatabaseTestRoles, resetFoundationDatabase } from "../database/helpers.mjs";

test.describe("real client and server logout recovery", () => {
	test.skip(process.env.RUN_DATABASE_BROWSER_TESTS !== "1", "Requires an explicitly enabled disposable local database and app server.");
	test.describe.configure({ mode: "serial" });
	// First authenticated navigation compiles the dashboard in the development server.
	test.setTimeout(90_000);
	let client: Client;
	let pool: Pool;

	test.beforeAll(async () => {
		const connectionString = databaseTestConnectionString();
		if (process.env.DATABASE_URL !== connectionString || process.env.WORKSPACE_APPS_ENABLED !== "true"
			|| process.env.PRIVATE_APP_GATEWAY_ENABLED !== "true" || process.env.WAITING_LIST_ENABLED !== "false"
			|| process.env.BETTER_AUTH_URL !== "http://localhost:3000" || !process.env.BETTER_AUTH_SECRET) {
			throw new Error("Browser logout tests require the local server's explicit database, auth, and feature-flag environment.");
		}
		client = new Client({ connectionString });
		pool = new Pool({ connectionString, max: 2 });
		await client.connect();
		await prepareDatabaseTestRoles(client);
		await resetFoundationDatabase(client);
		await client.query('delete from public."user"');
		await (await getMigrations({ database: pool, secret: process.env.BETTER_AUTH_SECRET,
			baseURL: process.env.BETTER_AUTH_URL, emailAndPassword: { enabled: true } })).runMigrations();
		for (const name of ["app_use_grants", "app_gateway_auth", "gateway_platform_sessions"]) {
			await client.query(readFileSync(new URL(`../../supabase/migrations/20261023_${name}.sql`, import.meta.url), "utf8"));
		}
	});
	test.afterEach(async () => {
		if (client) await client.query("drop trigger if exists browser_test_logout_failure on public.session; drop function if exists public.browser_test_fail_logout()");
	});
	test.afterAll(async () => { await pool?.end(); await client?.end(); });

	async function signIn(page: Page, email: string) {
		// Unrelated platform overview and cloud health calls are stubbed; auth and logout use the real server/database.
		await page.route("**/api/graphql", (route) => route.fulfill({ json: { data: {
			appOverview: { repoList: [], deployments: [], repoRecords: [] }, repoRecords: [],
			deploymentHistoryAll: { history: [], total: 0, page: 1, limit: 10 },
		} } }));
		await page.route("**/api/ws-token", (route) => route.fulfill({ status: 503, json: { error: "Worker disabled in local browser test" } }));
		await page.route("**/api/system-health", (route) => route.fulfill({ status: 503, json: {} }));
		await page.route("**/api/github/installations/status", (route) => route.fulfill({ json: { installed: true } }));
		const signup = await page.request.post("/api/auth/sign-up/email", { headers: { origin: "http://localhost:3000" },
			data: { email, name: "Browser Tester", password: "browser-local-password-123" } });
		expect(signup.status()).toBe(200);
		await page.goto("/home", { waitUntil: "domcontentloaded" });
		await expect(page.getByRole("button", { name: "Open profile menu" })).toBeVisible();
	}
	async function failLogout() {
		await client.query(`create function public.browser_test_fail_logout() returns trigger language plpgsql as $$
			begin raise exception 'local browser fixture rejects logout'; end $$;
			create trigger browser_test_logout_failure before delete on public.session for each row execute function public.browser_test_fail_logout()`);
	}
	async function clickSignOut(page: Page) {
		await page.getByRole("button", { name: "Open profile menu" }).click();
		await page.getByRole("menuitem", { name: "Sign out" }).click();
	}

	test("header preserves the real login on failed revocation, then completes a retry", async ({ page }) => {
		await signIn(page, "header-browser@example.test");
		await failLogout();
		await clickSignOut(page);
		await expect(page.getByText("Sign-out could not be completed. Please retry.", { exact: true })).toBeVisible();
		await expect(page).toHaveURL(/\/home$/);
		await page.screenshot({ path: test.info().outputPath("logout-failure.png"), fullPage: true });
		expect((await page.request.get("/api/auth/get-session")).status()).toBe(200);
		expect((await client.query('select count(*)::int as count from public.session')).rows[0].count).toBe(1);
		await client.query("drop trigger browser_test_logout_failure on public.session");
		await clickSignOut(page);
		await expect(page).toHaveURL(/\/auth$/);
		expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
		expect((await client.query('select count(*)::int as count from public.session')).rows[0].count).toBe(0);
	});

	test("broken-session guard exposes an actionable retry when the actual server rejects logout", async ({ page }) => {
		await signIn(page, "guard-browser@example.test");
		await failLogout();
		await page.route("**/api/auth/get-session**", (route) => route.fulfill({ status: 500,
			json: { code: "FAILED_TO_GET_SESSION", message: "Local browser fixture session failure" } }));
		await page.reload();
		await expect(page.getByRole("button", { name: "Retry sign-out" })).toBeVisible();
		await expect(page).toHaveURL(/\/home$/);
		await page.screenshot({ path: test.info().outputPath("recovery-retry.png"), fullPage: true });
		expect((await client.query('select count(*)::int as count from public.session')).rows[0].count).toBe(1);
		await client.query("drop trigger browser_test_logout_failure on public.session");
		await page.unroute("**/api/auth/get-session**");
		await page.getByRole("button", { name: "Retry sign-out" }).click();
		await expect(page).toHaveURL(/\/auth$/);
		expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
		expect((await client.query('select count(*)::int as count from public.session')).rows[0].count).toBe(0);
	});
});
