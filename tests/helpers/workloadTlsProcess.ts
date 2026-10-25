import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createServer as netServer } from "node:net";
import { request, type RequestOptions } from "node:https";
import type { ConnectionOptions } from "node:tls";
import { promisify } from "node:util";
import { workloadServerName } from "../../src/lib/workload-tls/config";
import { workloadTlsEnvironment, workloadTlsFixture } from "./workloadTlsFixture";

export async function unusedWorkloadPort(): Promise<number> {
	const server = netServer(); await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address(); await new Promise<void>((resolve) => server.close(() => resolve()));
	if (!address || typeof address === "string") throw Error("No test port"); return address.port;
}
export async function workloadProcessFixture(): Promise<{ app: Server; material: Awaited<ReturnType<typeof workloadTlsFixture>>; environment: Record<string, string> }> {
	const app = createServer((incoming, outgoing) => {
		const chunks: Buffer[] = []; incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
		incoming.on("end", () => outgoing.writeHead(200, { "Connection": "close", "Content-Type": "application/json" }).end(JSON.stringify({ body: Buffer.concat(chunks).toString(), path: incoming.url })));
	});
	await new Promise<void>((resolve, reject) => { app.once("error", reject); app.listen(0, "127.0.0.1", resolve); });
	try {
		const address = app.address(); if (!address || typeof address === "string") throw Error("No fixture app port");
		const material = await workloadTlsFixture(address.port); material.config.tlsPort = await unusedWorkloadPort();
		return { app, material, environment: workloadTlsEnvironment(material.config) };
	} catch (error) { await new Promise<void>((resolve) => app.close(() => resolve())); throw error; }
}
export function workloadProcessRequest(fixture: Awaited<ReturnType<typeof workloadProcessFixture>>): Promise<string> {
	return new Promise((resolve, reject) => {
		const options: RequestOptions & Pick<ConnectionOptions, "ALPNProtocols"> = { hostname: "127.0.0.1", port: fixture.material.config.tlsPort, servername: workloadServerName(fixture.material.config),
			ca: fixture.material.config.certificatePem, rejectUnauthorized: true, minVersion: "TLSv1.3", ALPNProtocols: ["http/1.1"],
			method: "POST", path: "/compiled-proof", headers: { "content-type": "text/plain", "content-length": "12" }, timeout: 1000 };
		const call = request(options, (response) => {
			const chunks: Buffer[] = []; response.on("data", (chunk: Buffer) => chunks.push(chunk)); response.on("error", reject);
			response.on("end", () => response.statusCode === 200 ? resolve(Buffer.concat(chunks).toString()) : reject(new Error("Fixture HTTP failure")));
		});
		call.on("timeout", () => call.destroy(new Error("Fixture deadline"))); call.on("error", reject); call.end("fixture-body");
	});
}
export function fixtureChildEnvironment(environment: Record<string, string>): NodeJS.ProcessEnv {
	// Do not inherit platform/provider credentials into the fixture workload.
	return { ...environment, NODE_ENV: "production", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
}
export function fixtureProcess(args: string[], environment: Record<string, string>): ChildProcess {
	return spawn(process.execPath, args, { env: fixtureChildEnvironment(environment), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}
export function waitWorkloadExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
	return new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
}
export const fixtureExec = promisify(execFile);
