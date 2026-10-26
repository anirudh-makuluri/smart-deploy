import { defineConfig, devices } from "@playwright/test";

if (process.env.RUN_PUBLIC_BROWSER_TESTS !== "1" || process.env.RUN_PROXY_BROWSER_TESTS !== "1"
	|| process.env.POSTHOG_UPSTREAM_HOST !== "http://127.0.0.1:45557"
	|| process.env.DATABASE_URL || process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY) {
	throw new Error("Public browser tests require an explicit local analytics fixture and no platform database credentials.");
}

export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: ["public-pages.spec.ts", "analytics-proxy.spec.ts"],
	workers: 1,
	timeout: 45_000,
	expect: { timeout: 10_000 },
	use: { baseURL: "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
	webServer: {
		command: "node node_modules/next/dist/bin/next start -p 3000",
		url: "http://localhost:3000/api/health",
		reuseExistingServer: false,
		timeout: 60_000,
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
