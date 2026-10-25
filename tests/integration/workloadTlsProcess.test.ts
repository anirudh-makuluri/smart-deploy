import { expect, it, vi } from "vitest";
import { fixtureProcess, waitWorkloadExit, workloadProcessFixture, workloadProcessRequest } from "../helpers/workloadTlsProcess";

it("runs the compiled dependency-free entrypoint with a whitelisted environment", async () => {
	const fixture = await workloadProcessFixture(); const child = fixtureProcess(["dist/workload-tls/main.js"], fixture.environment);
	const exited = waitWorkloadExit(child); let output = ""; child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); }); child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
	try {
		await vi.waitFor(async () => expect(JSON.parse(await workloadProcessRequest(fixture))).toEqual({ body: "fixture-body", path: "/compiled-proof" }), { timeout: 5000, interval: 100 });
		child.kill("SIGTERM"); const result = await exited; if (process.platform !== "win32") expect(result.code).toBe(0);
		expect(output).toBe("");
	} finally { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; await new Promise<void>((resolve) => fixture.app.close(() => resolve())); await fixture.material.dispose(); }
});
it("fails startup generically without echoing private configuration", async () => {
	const child = fixtureProcess(["dist/workload-tls/main.js"], { NODE_ENV: "production", SMARTDEPLOY_TLS_KEY: "must-not-escape" });
	const exited = waitWorkloadExit(child); let output = ""; child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); }); child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
	expect((await exited).code).toBe(1); expect(output).toBe("Workload TLS unavailable.\n");
});
