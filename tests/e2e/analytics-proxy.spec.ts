import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { expect, test } from "@playwright/test";

interface CapturedAnalyticsRequest { headers: IncomingHttpHeaders; body: string; path: string }

test.describe("analytics proxy network credential boundary", () => {
	test.skip(process.env.RUN_PROXY_BROWSER_TESTS !== "1", "Requires the local fake analytics upstream.");
	let upstream: Server;
	const captured: CapturedAnalyticsRequest[] = [];
	test.beforeAll(async () => {
		if (process.env.POSTHOG_UPSTREAM_HOST !== "http://127.0.0.1:45557" || process.env.DATABASE_URL) {
			throw new Error("Proxy browser tests require the exact local fake upstream and no platform database.");
		}
		upstream = createServer((request, response) => {
			const chunks: Buffer[] = [];
			request.on("data", (chunk: Buffer) => chunks.push(chunk));
			request.on("end", () => {
				captured.push({ headers: request.headers, body: Buffer.concat(chunks).toString("utf8"), path: request.url ?? "" });
				response.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1",
					"Set-Cookie": "better-auth.session_token=injected-test-only; Path=/",
					"Clear-Site-Data": '"cookies"' });
				response.end(JSON.stringify({ error: "Local upstream rate limit" }));
			});
		});
		await new Promise<void>((resolve, reject) => {
			upstream.once("error", reject);
			upstream.listen(45557, "127.0.0.1", resolve);
		});
	});
	test.afterAll(async () => { if (upstream) await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve())); });

	test("isolates a browser's cookie and bearer token while relaying the analytics body and error status", async ({ page, context }) => {
		await page.goto("/docs");
		await context.addCookies([{ name: "better-auth.session_token", value: "local-browser-only", url: "http://localhost:3000", httpOnly: true }]);
		const body = JSON.stringify({ api_key: "phc_local_test_only", event: "local-network-regression" });
		const result = await page.evaluate(async (payload) => {
			const response = await fetch("/ph/e?ip=1", { method: "POST", credentials: "include", headers: {
				"Content-Type": "application/json", Authorization: "Bearer local-browser-only",
				"X-SmartDeploy-User-Id": "private-user",
			}, body: payload });
			return { status: response.status, body: await response.json(), clearSiteData: response.headers.get("clear-site-data"), retryAfter: response.headers.get("retry-after") };
		}, body);
		expect(result).toEqual({ status: 429, body: { error: "Local upstream rate limit" }, clearSiteData: null, retryAfter: "1" });
		expect(captured).toHaveLength(1);
		expect(captured[0]?.path).toBe("/e?ip=1");
		expect(captured[0]?.body).toBe(body);
		for (const name of ["cookie", "authorization", "proxy-authorization", "x-smartdeploy-user-id", "referer"]) {
			expect(captured[0]?.headers[name]).toBeUndefined();
		}
		expect((await context.cookies("http://localhost:3000")).find((cookie) => cookie.name === "better-auth.session_token")?.value).toBe("local-browser-only");
	});
});
