import { createHash } from "node:crypto";
import { createServer } from "node:https";
import type { Duplex } from "node:stream";
import { connect } from "node:tls";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRuntimeStore } from "@/lib/apps/runtimeStore";
import { privateRuntimeOrigin, runtimeCredentialParameter, type CurrentAppRuntime } from "@/lib/apps/runtimeMetadata";
import { ManagedGatewayLoader } from "@/lib/gateway/managedRoute";
import type { ManagedGatewayOptions } from "@/lib/gateway/managedRouteSchema";
import type { GatewayTlsDial } from "@/lib/gateway/upstreamTls";
import { GATEWAY_SESSION_COOKIE } from "@/lib/gateway/cookies";
import { gatewayCertificate } from "../../helpers/gatewayCertificate";

const mocks = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), configuration: vi.fn() }));
vi.mock("@aws-sdk/client-ssm", async importOriginal => {
	const original = await importOriginal<typeof import("@aws-sdk/client-ssm")>();
	return { ...original, SSMClient: class { constructor(options: unknown) { mocks.configuration(options); } send = mocks.send; destroy = mocks.destroy; } };
});
const SCOPE = { accountId: "111122223333", region: "us-west-2", clusterName: "pilot", privateDomain: "apps.example.test" };
const APP = "9d888612-4141-4402-bbfd-23736a11bd46";
const BINDING = "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac";
const RELEASE = "997a2326-5b9b-4c08-aaef-45c618db01d3";
const RUNTIME = "8cef7399-7867-400d-9213-029c296aa301";
const KEY_ID = "91843492-f2ea-437c-a540-b144c3bc8ed2";
const KEY = "sd_gateway_" + KEY_ID + "." + "s".repeat(43);
const WORKLOAD = { bindingId: BINDING, environment: "published" as const, releaseId: RELEASE };
const sockets = new Set<Duplex>();
const loaders: ManagedGatewayLoader[] = [];
let server: ReturnType<typeof createServer>;
let material: Awaited<ReturnType<typeof gatewayCertificate>>;
let wrong: Awaited<ReturnType<typeof gatewayCertificate>>;
let row: CurrentAppRuntime;
let httpRequests = 0;
const current = vi.spyOn(AppRuntimeStore.prototype, "current");
const query = vi.fn();
const pool = { query } as unknown as Pool;
function options(): ManagedGatewayOptions {
	return { scope: SCOPE, appId: APP, environment: "published", platformOrigin: "https://control.test", documentsEnabled: true,
		timeoutMs: 1000, controlTimeoutMs: 1000, limits: { maxConnections: 2, maxRequestBytes: 32768, maxResponseBytes: 32768, timeoutMs: 5000, idleMs: 1000 } };
}
function parameter() { return { Name: row.credentialParameter, ARN: `arn:aws:ssm:${SCOPE.region}:${SCOPE.accountId}:parameter${row.credentialParameter}`, Type: "SecureString", Version: 1, Value: KEY }; }
function loader(configuration = options()) { const result = new ManagedGatewayLoader(pool, configuration); loaders.push(result); return result; }
const dial = vi.fn<GatewayTlsDial>(configuration => connect({ ...configuration, host: "127.0.0.1" }));
beforeAll(async () => {
	material = await gatewayCertificate(WORKLOAD); wrong = await gatewayCertificate({ ...WORKLOAD, releaseId: RUNTIME });
	server = createServer({ key: material.key, cert: material.cert, minVersion: "TLSv1.3", maxVersion: "TLSv1.3", ALPNProtocols: ["http/1.1"] }, (_request, response) => { httpRequests++; response.end("fixture"); });
	server.on("connection", socket => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); });
	server.on("tlsClientError", () => {});
	await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
});
beforeEach(() => {
	vi.useRealTimers(); mocks.send.mockReset(); mocks.destroy.mockClear(); mocks.configuration.mockClear(); query.mockReset(); current.mockReset(); dial.mockClear();
	server.setSecureContext({ key: material.key, cert: material.cert }); httpRequests = 0;
	const address = server.address(); if (!address || typeof address === "string") throw new Error("Loopback TLS fixture unavailable.");
	row = { id: RUNTIME, runtimeId: RUNTIME, appId: APP, workspaceId: "61502dbe-c33b-468c-8257-a904bc5b3653", bindingId: BINDING,
		environment: "published", releaseId: RELEASE, deploymentId: "deployment-fixture", credentialId: KEY_ID,
		taskArn: `arn:aws:ecs:${SCOPE.region}:${SCOPE.accountId}:task/pilot/` + "a".repeat(32), privateIp: "10.0.1.23", port: address.port,
		certificatePem: material.cert, registeredAt: new Date(), retiredAt: null, generation: 1,
		origin: privateRuntimeOrigin(BINDING, SCOPE), credentialParameter: runtimeCredentialParameter(BINDING, RUNTIME) };
	current.mockImplementation(async () => structuredClone(row)); mocks.send.mockImplementation(async () => ({ Parameter: parameter() }));
	query.mockResolvedValue({ rows: [{ bindingId: BINDING }], rowCount: 1 });
});
afterEach(() => { for (const instance of loaders.splice(0)) instance.close(); for (const socket of sockets) socket.destroy(); vi.useRealTimers(); });
afterAll(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); await material.dispose(); await wrong.dispose(); current.mockRestore(); });

describe("trusted selected-runtime gateway loader", () => {
	it("loads only the selected credential, proves pinned TLS without HTTP and exposes no secret", async () => {
		const route = await loader().load(new AbortController().signal, undefined, dial);
		expect(route).toMatchObject({ origin: row.origin, runtimeId: row.id, generation: 1 }); expect(JSON.stringify(route)).not.toContain(KEY);
		expect(current).toHaveBeenCalledTimes(2); expect(current).toHaveBeenCalledWith(APP, "published");
		expect(mocks.send.mock.calls[0][0].input).toEqual({ Name: row.credentialParameter, WithDecryption: true });
		expect(mocks.configuration.mock.calls[0][0]).toMatchObject({ endpoint: "https://ssm.us-west-2.amazonaws.com", maxAttempts: 1,
			requestHandler: { requestTimeout: 1800, throwOnRequestTimeout: true, httpsAgent: { maxSockets: 1 } } });
		expect(query.mock.calls[0][0]).toContain("authenticate_app_gateway_credential");
		expect(query.mock.calls[0][1]).toEqual([KEY_ID, createHash("sha256").update("s".repeat(43)).digest("hex")]);
		expect(dial.mock.calls[0][0]).toMatchObject({ host: "10.0.1.23", rejectUnauthorized: true, minVersion: "TLSv1.3", ca: material.cert });
		expect(httpRequests).toBe(0); route.close();
	});
	it("composes document routing using the loaded key without forwarding caller credentials", async () => {
		const transport = vi.fn().mockResolvedValue(Response.json({ document: null }));
		const route = await loader().load(new AbortController().signal, transport, dial);
		const result = await route.handle(new Request(row.origin + "/__smartdeploy/documents", { method: "POST",
			headers: { origin: row.origin, "content-type": "application/json", "sec-fetch-site": "same-origin", cookie: `${GATEWAY_SESSION_COOKIE}=${"t".repeat(43)}`, authorization: "Bearer browser-only" },
			body: JSON.stringify({ action: "get", collection: "notes", id: "shared" }) }));
		expect(result.status).toBe(200); expect(await result.json()).toEqual({ document: null }); expect(httpRequests).toBe(0);
		const headers = new Headers(transport.mock.calls[0][1].headers); expect(headers.get("authorization")).toBe("Bearer " + KEY); expect(headers.has("cookie")).toBe(false);
	});
	const badRows: [string, Partial<CurrentAppRuntime>][] = [
		["app", { appId: RUNTIME }], ["environment", { environment: "preview" }], ["runtime", { runtimeId: RELEASE }],
		["origin", { origin: "https://customer.test" }], ["parameter", { credentialParameter: "/unrelated/secret" }],
		["task", { taskArn: "arn:aws:ecs:us-east-1:111122223333:task/pilot/" + "a".repeat(32) }],
		["public IP", { privateIp: "8.8.8.8" }], ["release certificate", { releaseId: RUNTIME }],
		["retirement", { retiredAt: new Date() }], ["generation", { generation: 0 }],
	];
	it.each(badRows)("rejects mismatched %s before secret retrieval", async (_label, patch) => {
		row = { ...row, ...patch }; await expect(loader().load(new AbortController().signal, undefined, dial)).rejects.toThrow("Private app gateway configuration unavailable.");
		expect(mocks.send).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled(); expect(dial).not.toHaveBeenCalled();
	});
	it.each(["Type", "Name", "ARN", "Version", "Value", "Selector"])("rejects an invalid SSM %s before TLS or route construction", async field => {
		const value: Record<string, unknown> = parameter(); value[field] = field === "Version" ? 0 : "wrong";
		mocks.send.mockResolvedValue({ Parameter: value });
		await expect(loader().load(new AbortController().signal, undefined, dial)).rejects.toThrow("Private app gateway configuration unavailable."); expect(dial).not.toHaveBeenCalled();
	});
	it("rejects a foreign credential id and trailing whitespace without logging its value", async () => {
		for (const value of [KEY.replace(KEY_ID, RUNTIME), KEY + "\n"]) {
			mocks.send.mockResolvedValue({ Parameter: { ...parameter(), Value: value } });
			await expect(loader().load(new AbortController().signal, undefined, dial)).rejects.toThrow("Private app gateway configuration unavailable.");
		}
		expect(dial).not.toHaveBeenCalled();
	});
	it("rejects revoked or wrong-binding credentials before TLS", async () => {
		for (const rows of [[], [{ bindingId: RUNTIME }]]) {
			query.mockResolvedValue({ rows }); await expect(loader().load(new AbortController().signal, undefined, dial)).rejects.toThrow("Private app gateway configuration unavailable.");
		}
		expect(dial).not.toHaveBeenCalled();
	});
	it("rejects a real TLS peer with another release certificate", async () => {
		server.setSecureContext({ key: wrong.key, cert: wrong.cert });
		await expect(loader().load(new AbortController().signal, undefined, dial)).rejects.toThrow("Private app gateway configuration unavailable.");
		expect(current).toHaveBeenCalledTimes(1); expect(httpRequests).toBe(0);
	});
	it.each(["runtime", "generation", "credential", "disappeared"])("rejects %s drift during credential/TLS observation", async kind => {
		current.mockResolvedValueOnce(structuredClone(row)).mockResolvedValueOnce(kind === "disappeared" ? null : {
			...row, ...(kind === "generation" ? { generation: 2 } : kind === "credential" ? { credentialId: RELEASE } : { id: RELEASE, runtimeId: RELEASE }),
		});
		await expect(loader().load(new AbortController().signal, undefined, dial)).rejects.toThrow("Private app gateway configuration unavailable."); expect(httpRequests).toBe(0);
	});
	it("does no lookup for pre-aborted or closed loaders and denies absent selections", async () => {
		const instance = loader(); await expect(instance.load(AbortSignal.abort())).rejects.toThrow(); expect(current).not.toHaveBeenCalled();
		instance.close(); await expect(instance.load(new AbortController().signal)).rejects.toThrow(); expect(current).not.toHaveBeenCalled();
		current.mockResolvedValue(null); await expect(loader().load(new AbortController().signal)).rejects.toThrow(); expect(mocks.send).not.toHaveBeenCalled();
	});
	it("retains admission until ignored SDK work settles after the deadline", async () => {
		vi.useFakeTimers(); let finish = (_value: unknown) => {};
		mocks.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		const instance = loader({ ...options(), timeoutMs: 50 });
		const result = expect(instance.load(new AbortController().signal)).rejects.toThrow("Private app gateway configuration unavailable.");
		await vi.advanceTimersByTimeAsync(51); await result; expect(mocks.send.mock.calls[0][1].abortSignal.aborted).toBe(true);
		await expect(instance.load(new AbortController().signal)).rejects.toThrow(); expect(mocks.send).toHaveBeenCalledTimes(1);
		finish({ Parameter: parameter() }); await vi.advanceTimersByTimeAsync(1); expect(query).not.toHaveBeenCalled(); expect(dial).not.toHaveBeenCalled();
	});
	it("prevents secret retrieval after delayed SQL completes past cancellation", async () => {
		vi.useFakeTimers(); let finish = (_value: CurrentAppRuntime) => {};
		current.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		const instance = loader(); const controller = new AbortController();
		const result = expect(instance.load(controller.signal)).rejects.toThrow(); controller.abort(); await result;
		finish(row); await vi.advanceTimersByTimeAsync(1); expect(mocks.send).not.toHaveBeenCalled();
	});
	it("bounds live candidates to two, permits retirement, and closes returned routes on shutdown", async () => {
		const instance = loader(); const first = await instance.load(new AbortController().signal, undefined, dial);
		const second = await instance.load(new AbortController().signal, undefined, dial);
		await expect(instance.load(new AbortController().signal)).rejects.toThrow(); expect(mocks.send).toHaveBeenCalledTimes(2);
		first.close(); const third = await instance.load(new AbortController().signal, undefined, dial); instance.close();
		for (const route of [first, second, third]) expect((await route.handle(new Request(row.origin))).status).toBe(503);
		expect(mocks.destroy).toHaveBeenCalled();
	});
});
