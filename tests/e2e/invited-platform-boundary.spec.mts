import { createServer, type Server } from "node:http";
import { Client } from "pg";
import { expect, test } from "@playwright/test";
import { databaseTestConnectionString } from "../database/helpers.mjs";

test.describe("app-only login and actual platform API boundary", () => {
	test.skip(process.env.RUN_INVITEE_BROWSER_TESTS !== "1", "Requires the explicitly configured disposable database and local approval fixture.");
	test.setTimeout(90_000);
	test.describe.configure({ mode: "serial" });
	let client: Client;
	let approvals: Server;
	let approvedEmail: string | null = null;
	test.beforeAll(async () => {
		const connectionString = databaseTestConnectionString();
		if (process.env.DATABASE_URL !== connectionString || process.env.WORKSPACE_APPS_ENABLED !== "true"
			|| process.env.PRIVATE_APP_GATEWAY_ENABLED !== "true" || process.env.WAITING_LIST_ENABLED !== "true"
			|| process.env.BETTER_AUTH_URL !== "http://localhost:3000" || !process.env.BETTER_AUTH_SECRET
			|| process.env.SUPABASE_URL !== "http://127.0.0.1:45558" || process.env.SUPABASE_SERVICE_ROLE_KEY !== "local-approval-fixture-only") {
			throw new Error("Invitee browser tests require the exact local database, auth, flags and fake approval service.");
		}
		approvals = createServer((request, response) => {
			request.resume();
			const url = new URL(request.url ?? "/", "http://127.0.0.1:45558");
			const path = url.pathname;
			if (path === "/rest/v1/approved_users" && request.method === "GET") {
				const rows = approvedEmail && url.searchParams.get("email") === `eq.${approvedEmail}` ? [{ email: approvedEmail }] : [];
				response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(rows));
			} else if (path === "/rest/v1/waiting_list" && request.method === "POST") {
				response.writeHead(201, { "Content-Type": "application/json" }).end("{}");
			} else response.writeHead(404).end();
		});
		await new Promise<void>((resolve, reject) => { approvals.once("error", reject); approvals.listen(45558, "127.0.0.1", resolve); });
		client = new Client({ connectionString });
		await client.connect();
	});
	test.afterAll(async () => {
		await client?.end();
		if (approvals) await new Promise<void>((resolve, reject) => approvals.close((error) => error ? reject(error) : resolve()));
	});

	test("keeps an unapproved login for app handoff but denies real GraphQL, GitHub, worker and CLI approval requests", async ({ page, context }) => {
		const signup = await page.request.post("/api/auth/sign-up/email", { headers: { origin: "http://localhost:3000" },
			data: { email: "invited-browser@example.test", name: "Local invitee", password: "browser-local-password-123" } });
		expect(signup.status()).toBe(200);
		// This fixture establishes only a local verified identity, not real email/OAuth verification.
		await client.query('update public."user" set "emailVerified" = true where email = $1', ["invited-browser@example.test"]);
		await page.goto("/home", { waitUntil: "domcontentloaded" });
		await expect(page).toHaveURL(/\/waiting-list$/);
		expect((await context.cookies()).some((cookie) => cookie.name.endsWith("session_token"))).toBe(true);
		const decisions = await page.evaluate(async () => {
			const cases = [
				{ path: "/api/ws-token", method: "GET" },
				{ path: "/api/github/access-token", method: "GET" },
				{ path: "/api/graphql", method: "POST" },
				{ path: "/api/cli/device/approve", method: "POST" },
			];
			return Promise.all(cases.map(async ({ path, method }) => {
				const response = await fetch(path, { method, credentials: "same-origin",
					headers: { "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) });
				return { path, status: response.status, body: await response.json() };
			}));
		});
		for (const decision of decisions) expect(decision).toMatchObject({ status: 403, body: { error: "Platform approval is required." } });
		expect((await page.request.get("/api/auth/get-session")).status()).toBe(200);
		const session = await (await page.request.get("/api/auth/get-session")).json();
		expect(session.user.email).toBe("invited-browser@example.test");
		const logout = await page.request.post("/api/auth/sign-out", { headers: { origin: "http://localhost:3000" }, data: {} });
		expect(logout.status()).toBe(200);
		expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
		expect((await client.query("select count(*)::int as count from public.session")).rows[0].count).toBe(0);
	});

	test("keeps approved platform requests working and applies approval revocation on the next request", async ({ page }) => {
		approvedEmail = "approved-browser@example.test";
		const signup = await page.request.post("/api/auth/sign-up/email", { headers: { origin: "http://localhost:3000" },
			data: { email: approvedEmail, name: "Local approved user", password: "browser-local-password-123" } });
		expect(signup.status()).toBe(200);
		await client.query('update public."user" set "emailVerified" = true where email = $1', [approvedEmail]);
		await page.goto("/robots.txt");
		const accepted = await page.evaluate(async () => {
			const ws = await fetch("/api/ws-token");
			const graph = await fetch("/api/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ __typename }" }) });
			return { ws: ws.status, hasToken: typeof (await ws.json()).token === "string", graph: graph.status, data: (await graph.json()).data };
		});
		expect(accepted).toEqual({ ws: 200, hasToken: true, graph: 200, data: { __typename: "Query" } });
		approvedEmail = null;
		expect(await page.evaluate(async () => (await fetch("/api/ws-token")).status)).toBe(403);
		expect((await page.request.post("/api/auth/sign-out", { headers: { origin: "http://localhost:3000" }, data: {} })).status()).toBe(200);
	});
});
