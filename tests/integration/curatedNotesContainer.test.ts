import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
const execute = promisify(execFile);
it("serves the curated app from a non-root read-only container without a writable data store", async () => {
  if (process.platform !== "linux") throw Error("The explicit notes container test requires Linux Docker.");
  const name = "smartdeploy-notes-test-" + randomUUID();
  const child = spawn("docker", ["run", "--rm", "--name", name, "--network", "host", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "128m", "--cpus", "0.25", "--pids-limit", "64", "--env", "PORT=45562", "smartdeploy-notes:ci"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); }); let output = ""; child.stdout.on("data", chunk => { output += String(chunk); }); child.stderr.on("data", chunk => { output += String(chunk); });
  const options = { windowsHide: true, timeout: 10000 };
  try {
    await vi.waitFor(async () => { const response = await fetch("http://127.0.0.1:45562/health", { signal: AbortSignal.timeout(1000) }); expect(await response.json()).toEqual({ ok: true, release: "v1" }); }, { timeout: 15000, interval: 200 });
    const inspected = await execute("docker", ["inspect", name, "--format", "{{json .Config.User}} {{json .HostConfig.ReadonlyRootfs}}"], options); expect(inspected.stdout.trim()).toBe('"10001:10001" true');
    const files = await execute("docker", ["exec", name, "node", "-e", 'process.stdout.write(JSON.stringify(require("node:fs").readdirSync("/app").sort()))'], options); expect(JSON.parse(files.stdout)).toEqual(["client.js", "index.html", "server.mjs", "style.css"]);
    await execute("docker", ["stop", "--time", "5", name], options); expect(await exited).toBe(0); expect(output).toBe("");
  } finally { await execute("docker", ["rm", "--force", name], options).catch(() => {}); if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; }
});
