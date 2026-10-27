import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
let application: ChildProcess | null = null;
let exited: Promise<number | null> = Promise.resolve(null);
async function start(release: string) {
  // Keep the actual ESM application outside Playwright's CommonJS transform hooks.
  application = spawn(process.execPath, [path.resolve("demo/notes/server.mjs")], { windowsHide: true, env: { NODE_ENV: "production", PORT: "34436", NOTES_RELEASE: release }, stdio: ["ignore", "pipe", "pipe"] });
  exited = new Promise((resolve, reject) => { application!.once("exit", resolve); application!.once("error", reject); }); void exited.catch(() => {});
  await expect.poll(async () => { try { return (await fetch("http://127.0.0.1:34436/health", { signal: AbortSignal.timeout(500) })).status; } catch { return 0; } }, { timeout: 10000 }).toBe(200);
}
async function stop() {
  const child = application; application = null; if (!child) return;
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000); timer.unref();
  try { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); await exited; } finally { clearTimeout(timer); }
}
test.beforeAll(async () => { await start("v1"); }); test.afterAll(stop);
test("renders the actual app assets/CSP and retains a note across a v2 restart using a controlled document-broker fixture", async ({ page }, info) => {
  // The document service is controlled here; this is browser/CSP proof, not AWS persistence or authentication.
  let stored: { collection: string; id: string; version: string; json: string } | null = null; let failNext = false; let writes = 0;
  await page.route("**/__smartdeploy/documents", async route => {
    const operation = route.request().postDataJSON(); expect(operation.collection).toBe("team-notes"); expect(operation.id).toBe("shared");
    if (operation.action === "put") {
      writes++; if (failNext) { failNext = false; await route.fulfill({ status: 503, json: { error: "Controlled unavailable response" } }); return; }
      expect(operation.expectedVersion).toBe(stored?.version ?? null); stored = { collection: "team-notes", id: "shared", version: randomUUID(), json: operation.json };
    }
    await route.fulfill({ status: 200, json: { document: stored } });
  });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/"); await expect(page.getByLabel("What should the team remember?")).toBeEnabled(); await expect(page.locator(".release")).toHaveText("v1"); expect(writes).toBe(0);
  await page.getByLabel("What should the team remember?").fill("Keep this decision through the next release."); await page.getByRole("button", { name: "Save note", exact: true }).click(); await expect(page.getByRole("status")).toContainText("Saved."); expect(writes).toBe(1);
  await stop(); await start("v2"); await page.reload(); await expect(page.locator(".release")).toHaveText("v2"); await expect(page.getByLabel("What should the team remember?")).toHaveValue("Keep this decision through the next release.");
  failNext = true; await page.getByLabel("What should the team remember?").fill("Unconfirmed draft"); await page.getByRole("button", { name: "Save note", exact: true }).click(); await expect(page.getByRole("status")).toContainText("may have completed"); await expect(page.getByRole("button", { name: "Save note", exact: true })).toBeDisabled(); expect(writes).toBe(2);
  await page.getByRole("button", { name: "Reload saved note", exact: true }).click(); await expect(page.getByLabel("What should the team remember?")).toHaveValue("Keep this decision through the next release."); await expect(page.getByRole("button", { name: "Save note", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]); await page.screenshot({ path: info.outputPath("curated-notes-mobile.png"), fullPage: true });
});
