import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ testDir: "./tests/e2e", testMatch: "curated-notes.spec.ts", workers: 1, timeout: 30000,
  use: { baseURL: "http://127.0.0.1:34436", trace: "retain-on-failure" }, projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }] });
