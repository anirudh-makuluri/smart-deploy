import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:tls";
import type { Duplex } from "node:stream";
import { expect, it, vi } from "vitest";
import { gatewayCertificate } from "../helpers/gatewayCertificate";
import { fixtureProcess, unusedWorkloadPort, waitWorkloadExit } from "../helpers/workloadTlsProcess";
import { gatewayWorkloadServerName } from "../../src/lib/gateway/upstreamTls";
import { GATEWAY_SESSION_COOKIE } from "../../src/lib/gateway/cookies";

it("fails the compiled gateway generically before network access when flags/configuration are absent", async () => {
	const environments: Record<string, string>[] = [{}, { WORKSPACE_APPS_ENABLED: "true", PRIVATE_APP_GATEWAY_ENABLED: "true" }];
	for (const environment of environments) {
		const child = fixtureProcess(["dist/gateway-server.js", path.resolve("must-not-exist-secret-config.json")], environment);
		const exited = waitWorkloadExit(child); let output = "";
		child.stdout?.on("data", chunk => { output += chunk.toString(); }); child.stderr?.on("data", chunk => { output += chunk.toString(); });
		try { expect((await exited).code).toBe(1); expect(output).toBe("Private app gateway startup failed.\n"); }
		finally { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; }
	}
});

it("runs the compiled gateway with fake control/registry and real pinned TLS, then expires", async () => {
	const workload = { bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac", environment: "published" as const, releaseId: "997a2326-5b9b-4c08-aaef-45c618db01d3" };
	const material = await gatewayCertificate(workload); const directory = await mkdtemp(path.join(tmpdir(), "smartdeploy-gateway-process-"));
	const files: string[] = []; const sockets = new Set<Duplex>();
	const server = createServer({ key: material.key, cert: material.cert, minVersion: "TLSv1.3", maxVersion: "TLSv1.3", ALPNProtocols: ["http/1.1"] });
	server.on("connection", socket => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); }); server.on("tlsClientError", () => {});
	await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const file = async (name: string, data: string | Buffer) => { const target = path.join(directory, name); files.push(target); await writeFile(target, data); return target; };
	const key = await file("key.pem", material.key); const cert = await file("cert.pem", material.cert); const port = await unusedWorkloadPort();
	const address = server.address(); if (!address || typeof address === "string") throw new Error("TLS fixture unavailable.");
	const runtimeId = "8cef7399-7867-400d-9213-029c296aa301"; const appId = "9d888612-4141-4402-bbfd-23736a11bd46";
	const credentialId = "91843492-f2ea-437c-a540-b144c3bc8ed2"; const credential = "sd_gateway_" + credentialId + "." + "s".repeat(43);
	const origin = `https://${workload.bindingId}.apps.example.test`; const parameter = `/smartdeploy/pilot/gateways/${workload.bindingId}/${runtimeId}`;
	const row = { id: runtimeId, runtimeId, appId, workspaceId: "61502dbe-c33b-468c-8257-a904bc5b3653", ...workload, deploymentId: "fixture", credentialId,
		taskArn: "arn:aws:ecs:us-west-2:111122223333:task/pilot/" + "a".repeat(32), privateIp: "10.0.1.23", port: address.port,
		certificatePem: material.cert, registeredAt: new Date().toISOString(), retiredAt: null, generation: 1, origin, credentialParameter: parameter };
	const fixture = await file("fixture.json", JSON.stringify({ row, credential, parameterArn: `arn:aws:ssm:us-west-2:111122223333:parameter${parameter}` }));
	const settings = await file("gateway.json", JSON.stringify({ gateway: { scope: { accountId: "111122223333", region: "us-west-2", clusterName: "pilot", privateDomain: "apps.example.test" },
		appId, environment: "published", platformOrigin: "https://control.test", documentsEnabled: true, timeoutMs: 1000, controlTimeoutMs: 1000,
		limits: { maxConnections: 2, maxRequestBytes: 32768, maxResponseBytes: 32768, timeoutMs: 5000, idleMs: 1000 } },
		timing: { refreshMs: 1000, maxAgeMs: 5000, expiresAt: Date.now() + 8000 }, address: "127.0.0.1", port, tlsKeyFile: key, tlsCertificateFile: cert, databaseCaFile: cert }));
	const child = fixtureProcess(["--import", pathToFileURL(path.resolve("tests/helpers/gatewayProcessPreload.mjs")).href, "dist/gateway-server.js", settings], {
		WORKSPACE_APPS_ENABLED: "true", PRIVATE_APP_GATEWAY_ENABLED: "true", DATABASE_URL: "postgres://fixture:local-only@db.example.test/platform", SMARTDEPLOY_TEST_GATEWAY_FIXTURE: fixture });
	const exited = waitWorkloadExit(child); let output = ""; child.stdout?.on("data", chunk => { output += chunk.toString(); }); child.stderr?.on("data", chunk => { output += chunk.toString(); });
	try {
		await vi.waitFor(async () => {
			if (child.exitCode !== null) throw new Error(output.replaceAll(credential, "[fixture-credential]"));
			const status = await new Promise<number>((resolve, reject) => {
				const call = request({ hostname: "127.0.0.1", port, servername: gatewayWorkloadServerName(workload), ca: material.cert, rejectUnauthorized: true,
					method: "POST", path: "/__smartdeploy/documents", timeout: 1000, headers: { host: new URL(origin).host, origin, "sec-fetch-site": "same-origin", "content-type": "application/json", cookie: `${GATEWAY_SESSION_COOKIE}=${"t".repeat(43)}` } }, response => { response.resume(); response.once("end", () => resolve(response.statusCode ?? 0)); });
				call.on("error", reject); call.on("timeout", () => call.destroy(new Error("Fixture request deadline"))); call.end(JSON.stringify({ action: "get", collection: "notes", id: "shared" }));
			}); expect(status).toBe(200);
		}, { timeout: 5000, interval: 100 });
		expect((await exited).code).toBe(0); expect(output).toContain("Private app gateway started"); expect(output).not.toContain(credential); expect(output).not.toContain("PRIVATE KEY");
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill(); await exited;
		for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve()));
		for (const name of files) await unlink(name); await rmdir(directory); await material.dispose();
	}
});
