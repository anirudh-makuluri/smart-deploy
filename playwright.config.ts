import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 30_000,
	expect: {
		timeout: 7_000,
	},
	use: {
		// Use localhost (not 127.0.0.1) so the Next.js dev client runtime hydrates;
		// a mismatched dev origin blocks HMR/refresh and leaves handlers unattached.
		baseURL: "http://localhost:3000",
		trace: "on-first-retry",
	},
	webServer: {
		command: "npm run dev",
		// Probe without initializing auth before the disposable schema is prepared.
		url: "http://localhost:3000/api/health",
		reuseExistingServer: process.env.RUN_DATABASE_BROWSER_TESTS !== "1" && process.env.RUN_PROXY_BROWSER_TESTS !== "1",
		timeout: 120_000,
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
