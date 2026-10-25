import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: ["platform-cookies.spec.ts", "gateway-browser-transactions.spec.ts", "gateway-browser-auth.spec.ts", "gateway-http-isolation.spec.ts"],
	workers: 1,
	timeout: 45_000,
	use: {
		...devices["Desktop Chrome"],
		ignoreHTTPSErrors: true,
		launchOptions: { args: ["--host-resolver-rules=MAP control.test 127.0.0.1, MAP app.control.test 127.0.0.1, MAP other.control.test 127.0.0.1", "--no-proxy-server"] },
	},
});
