import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { expect, it, vi } from "vitest";
import { fixtureExec, waitWorkloadExit, workloadProcessFixture, workloadProcessRequest } from "../helpers/workloadTlsProcess";

it("runs only the compiled listener in a non-root read-only container and exits on SIGTERM", async () => {
	if (process.platform !== "linux") throw Error("The explicit container test requires a Linux Docker host.");
	const fixture = await workloadProcessFixture(); const name = "smartdeploy-tls-test-" + randomUUID();
	// Docker needs its host environment; only the explicit --env keys enter the container.
	const child = spawn("docker", ["run", "--rm", "--name", name, "--network", "host", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
		"--memory", "128m", "--cpus", "0.25", "--pids-limit", "64", ...Object.keys(fixture.environment).flatMap((key) => ["--env", key]), "smartdeploy-workload-tls:ci"],
		{ env: { ...process.env, ...fixture.environment }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
	const exited = waitWorkloadExit(child); let output = ""; child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); }); child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
	try {
		await vi.waitFor(async () => expect(JSON.parse(await workloadProcessRequest(fixture))).toEqual({ body: "fixture-body", path: "/compiled-proof" }), { timeout: 15000, interval: 200 });
		const options = { windowsHide: true, timeout: 10000 };
		const inspected = await fixtureExec("docker", ["inspect", name, "--format", "{{json .Config.User}} {{json .HostConfig.ReadonlyRootfs}}"], options);
		expect(inspected.stdout.trim()).toBe('"10001:10001" true');
		const files = await fixtureExec("docker", ["exec", name, "node", "-e", 'process.stdout.write(JSON.stringify(require("node:fs").readdirSync("/app").sort()))'], options);
		expect(JSON.parse(files.stdout)).toEqual(["config.js", "main.js", "tunnel.js"]);
		await fixtureExec("docker", ["stop", "--time", "5", name], options); expect((await exited).code).toBe(0); expect(output).toBe("");
	} finally {
		await fixtureExec("docker", ["rm", "--force", name], { windowsHide: true, timeout: 10000 }).catch(() => {});
		if (child.exitCode === null && child.signalCode === null) child.kill(); await exited;
		await new Promise<void>((resolve) => fixture.app.close(() => resolve())); await fixture.material.dispose();
	}
});
