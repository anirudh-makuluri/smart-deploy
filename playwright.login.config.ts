import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e", testMatch: "app-login-confirmation.spec.ts", workers: 1, timeout: 90_000,
	use: { baseURL: "https://localhost:34433", ignoreHTTPSErrors: true, trace: "retain-on-failure" },
	globalSetup: "./tests/e2e/prepare-app-login.mjs",
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--no-proxy-server", "--host-resolver-rules=MAP app.localhost:443 127.0.0.1:34434,MAP preview.localhost:443 127.0.0.1:34434,MAP localhost 127.0.0.1"] } } }],
});
