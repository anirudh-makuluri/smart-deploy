import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { privateDemoWorkerFixture } from "../helpers/privateDemoWorkerFixture";
const execute = promisify(execFile);
it("runs the actual runtime-only image as non-root/read-only and exits on SIGTERM", async () => {
  if (process.platform !== "linux") throw Error("The explicit demo worker container check requires Linux Docker.");
  const version = process.env.EXPECTED_DEMO_WORKER_VERSION;
  if (!version || !/^[a-f0-9]{40}$/.test(version)) throw Error("The exact reviewed worker image version is required.");
  const options = { windowsHide: true, timeout: 10000 };
  const image = await execute("docker", ["image", "inspect", "smartdeploy-private-demo-worker:ci", "--format", "{{json .Config.Env}}"], options);
  const imageEnvironment = z.array(z.string()).parse(JSON.parse(image.stdout));
  expect(imageEnvironment.filter(item => item.startsWith("WORKER_VERSION="))).toEqual(["WORKER_VERSION=" + version]);
  const value = await privateDemoWorkerFixture(Date.now() + 60000, 45564, "/operator");
  delete value.environment.WORKER_VERSION; // Health must use the actual image's source version.
  const name = "smartdeploy-demo-worker-test-" + randomUUID();
  const args = ["run", "--rm", "--name", name, "--network", "host", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "512m", "--cpus", "0.5", "--pids-limit", "64", "--mount", `type=bind,source=${value.directory},target=/operator,readonly`];
  for (const [key, item] of Object.entries(value.environment)) args.push("--env", key + "=" + item);
  args.push("smartdeploy-private-demo-worker:ci");
  const child = spawn("docker", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); }); let output = "";
  child.stdout.on("data", chunk => { output += String(chunk); }); child.stderr.on("data", chunk => { output += String(chunk); });
  try {
    await vi.waitFor(async () => { const response = await fetch("http://127.0.0.1:45564/health", { signal: AbortSignal.timeout(1000) }); expect(await response.json()).toMatchObject({ ok: true, mode: "private-app-demo", version, expiresAt: value.expiresAt }); }, { timeout: 20000, interval: 200 });
    const inspected = await execute("docker", ["inspect", name, "--format", "{{json .Config.User}} {{json .HostConfig.ReadonlyRootfs}} {{json .Config.Cmd}}"], options);
    expect(inspected.stdout.trim()).toBe('"10001:10001" true ["node","dist/private-demo-worker.js"]');
    const protectedHttp = await fetch("http://127.0.0.1:45564/internal/deployment-runs/test/events", { method: "POST", body: "{}" }); expect(protectedHttp.status).toBe(404);
    await execute("docker", ["stop", "--time", "5", name], options); expect(await exited).toBe(0);
    expect(output).not.toContain("local-only"); expect(output).not.toContain(value.environment.BETTER_AUTH_SECRET); expect(output).not.toContain("PRIVATE KEY");
  } finally { await execute("docker", ["rm", "--force", name], options).catch(() => {}); if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; await value.dispose(); }
});
