import { expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { privateDemoWorkerFixture } from "../helpers/privateDemoWorkerFixture";
import { fixtureProcess, unusedWorkloadPort, waitWorkloadExit } from "../helpers/workloadTlsProcess";

it("fails the compiled demo worker generically when configuration or production origin is missing", async () => {
  const environments: Record<string, string>[] = [{}, { NEXT_PUBLIC_WS_URL: "wss://foreign.example.test/ws", WS_ALLOWED_ORIGINS: "https://smart-deploy.xyz", BETTER_AUTH_SECRET: "fixture" }];
  for (const environment of environments) {
    const child = fixtureProcess(["dist/private-demo-worker.js"], environment); const exited = waitWorkloadExit(child); let output = "";
    child.stdout?.on("data", chunk => { output += String(chunk); }); child.stderr?.on("data", chunk => { output += String(chunk); });
    try { expect((await exited).code).toBe(1); expect(output).toBe("Private app demo control worker startup failed.\n"); }
    finally { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; }
  }
});
it("runs the compiled CLI without a live database or AWS credentials and exits at its configured expiry", async () => {
  const port = await unusedWorkloadPort(); const value = await privateDemoWorkerFixture(Date.now() + 12000, port, null);
  const child = fixtureProcess(["dist/private-demo-worker.js"], value.environment); const exited = waitWorkloadExit(child); let output = "";
  child.stdout?.on("data", chunk => { output += String(chunk); }); child.stderr?.on("data", chunk => { output += String(chunk); });
  try {
    await vi.waitFor(async () => {
      if (child.exitCode !== null) throw Error("Compiled demo worker exited before health.");
      const response = await fetch("http://127.0.0.1:" + port + "/health", { signal: AbortSignal.timeout(1000) });
      expect(await response.json()).toMatchObject({ ok: true, port, mode: "private-app-demo", version: "a".repeat(40), expiresAt: value.expiresAt });
    }, { timeout: 8000, interval: 100 });
    expect((await fetch("http://127.0.0.1:" + port + "/internal/deployment-runs/test/events", { method: "POST", body: "{}" })).status).toBe(404);
    expect((await exited).code).toBe(0); expect(output).toContain("Private app demo control worker started.");
    expect(output).not.toContain("local-only"); expect(output).not.toContain("PRIVATE KEY"); expect(output).not.toContain(value.environment.BETTER_AUTH_SECRET);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; await value.dispose(); }
});
it("fails on an occupied port without disturbing its existing listener", async () => {
  const occupied = createServer((_request, response) => response.end("existing-fixture"));
  await new Promise<void>(resolve => occupied.listen(0, "0.0.0.0", resolve)); const address = occupied.address(); if (!address || typeof address === "string") throw Error("Fixture unavailable.");
  const value = await privateDemoWorkerFixture(Date.now() + 30000, address.port, null);
  const child = fixtureProcess(["dist/private-demo-worker.js"], value.environment); const exited = waitWorkloadExit(child); let output = "";
  child.stdout?.on("data", chunk => { output += String(chunk); }); child.stderr?.on("data", chunk => { output += String(chunk); });
  try {
    expect((await exited).code).toBe(1); expect(await (await fetch("http://127.0.0.1:" + address.port)).text()).toBe("existing-fixture");
    expect(output).toContain("Private app demo control worker startup failed."); expect(output).not.toContain("local-only"); expect(output).not.toContain(value.environment.BETTER_AUTH_SECRET);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; occupied.closeAllConnections(); await new Promise<void>(resolve => occupied.close(() => resolve())); await value.dispose(); }
});
