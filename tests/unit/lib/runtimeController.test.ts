import { createServer, connect, type Server } from "node:tls";
import type { Duplex } from "node:stream";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const ssm = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn() }));
vi.mock("@aws-sdk/client-ssm", async original => ({ ...await original<typeof import("@aws-sdk/client-ssm")>(), SSMClient: class { send = ssm.send; destroy = ssm.destroy; } }));
import { AppRuntimeController } from "@/lib/apps/runtimeController";
import { AppRuntimeStore } from "@/lib/apps/runtimeStore";
import { RuntimeControlSettings, runtimeControlScope } from "@/lib/apps/runtimeControlSettings";
import { PilotRuntimeVerifier } from "@/lib/aws/pilotRuntimeVerifier";
import { privateRuntimeOrigin, runtimeCredentialParameter } from "@/lib/apps/runtimeMetadata";
import { WorkspaceError } from "@/lib/apps/workspaceStore";
import type { AppEnvironment } from "@/lib/apps/types";
import { CONTROL_APP, CONTROL_REQUEST, runtimeControlFixture } from "../../helpers/runtimeControlFixture";

const prepare = vi.spyOn(AppRuntimeStore.prototype, "prepare"); const review = vi.spyOn(AppRuntimeStore.prototype, "review");
const register = vi.spyOn(AppRuntimeStore.prototype, "register"); const activate = vi.spyOn(AppRuntimeStore.prototype, "activate"); const inspect = vi.spyOn(PilotRuntimeVerifier.prototype, "inspect");
const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }); const pool = { query } as unknown as Pool;
const authorize = vi.fn<(principal: { userId: string; sessionId: string }) => Promise<void>>();
const principal = { userId: "alice", sessionId: "alice-session" };
let fixture: Awaited<ReturnType<typeof runtimeControlFixture>>; let server: Server;
const sockets = new Set<Duplex>(); const controllers: AppRuntimeController[] = [];
let selected: Array<{ environment: AppEnvironment; runtimeId: string; generation: number }>;
let unavailable: string[]; let httpBytes = 0;
function parameter(name: string) {
	const index = fixture.settings.targets.findIndex(target => runtimeCredentialParameter(target.expected.bindingId, target.expected.runtimeId) === name);
	return { Parameter: { Name: name, ARN: "arn:aws:ssm:us-west-2:111122223333:parameter" + name, Type: "SecureString", Version: 1, Value: fixture.keys[index].token } };
}
beforeAll(async () => {
	fixture = await runtimeControlFixture(); const material = fixture.materials[0];
	server = createServer({ key: material.key, cert: material.cert, minVersion: "TLSv1.3", maxVersion: "TLSv1.3", ALPNProtocols: ["http/1.1"] }, socket => socket.on("data", data => { httpBytes += data.length; }));
	server.on("connection", socket => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); }); server.on("tlsClientError", () => {});
	await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address(); if (!address || typeof address === "string") throw Error("Local TLS fixture missing."); fixture.settings.targets[0].expected.originPort = address.port;
});
afterAll(async () => { for (const socket of sockets) socket.destroy(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (fixture) await fixture.dispose(); });
beforeEach(() => {
	vi.clearAllMocks(); query.mockResolvedValue({ rowCount: 1, rows: [] }); authorize.mockResolvedValue(undefined); selected = []; unavailable = []; httpBytes = 0;
	fixture.settings.expiresAt = Math.floor(Date.now() / 1000) * 1000 + 120000;
	server.setSecureContext({ key: fixture.materials[0].key, cert: fixture.materials[0].cert });
	prepare.mockImplementation(async (bindingId, releaseId) => {
		const target = fixture.settings.targets.find(target => target.expected.bindingId === bindingId && target.expected.releaseId === releaseId); if (!target) throw Error("Unexpected fixture source.");
		return { binding: { id: bindingId, appId: CONTROL_APP, workspaceId: CONTROL_REQUEST, environment: target.expected.environment, origin: privateRuntimeOrigin(bindingId, runtimeControlScope(fixture.settings.scope)), managed: true },
			releaseId, deploymentId: "deployment-" + releaseId, imageReference: target.expected.appImage, imageDigest: "sha256:" + "b".repeat(64), sourceFingerprint: "f".repeat(64) };
	});
	review.mockImplementation(async () => ({ selected, unavailable }));
	inspect.mockImplementation(async expected => ({ taskArn: expected.taskArn, taskDefinitionArn: expected.taskDefinitionArn, networkInterfaceId: "eni-22222222", privateIp: "10.0.0.2", subnetId: "subnet-11111111", port: expected.originPort, appImageDigest: "sha256:" + "b".repeat(64), tlsImageDigest: "sha256:" + "a".repeat(64), observedAt: new Date() }));
	ssm.send.mockImplementation(async command => parameter(command.input.Name));
	register.mockImplementation(async input => ({ ...input, appId: CONTROL_APP, workspaceId: CONTROL_REQUEST, environment: "published", deploymentId: "deployment", registeredAt: new Date(), retiredAt: null }));
	activate.mockImplementation(async runtimeId => { selected = [{ environment: "published", runtimeId, generation: 1 }]; return { runtimeId, generation: 1 }; });
});
afterEach(() => { for (const controller of controllers.splice(0)) controller.close(); vi.useRealTimers(); });
function controller(settings = fixture.settings) { const value = new AppRuntimeController(pool, settings, authorize, options => connect({ ...options, host: "127.0.0.1" })); controllers.push(value); return value; }
function command() { return { action: "activate", requestId: CONTROL_REQUEST, appId: CONTROL_APP, environment: "published", releaseId: fixture.settings.targets[0].expected.releaseId, expectedCurrentId: null }; }
describe("trusted prepared-runtime publication", () => {
	it("projects only manager-facing release identifiers and public origins", async () => {
		const reply = await controller().request(principal, { action: "inspect", requestId: CONTROL_REQUEST, appId: CONTROL_APP }, new AbortController().signal);
		expect(reply).toMatchObject({ ok: true, view: { choices: expect.arrayContaining([expect.objectContaining({ label: "Notes 1", available: true })]), selected: [] } });
		const json = JSON.stringify(reply); for (const secret of ["privateIp", "taskArn", "certificatePem", "credentialId", fixture.keys[0].token, fixture.settings.scope.tlsImage]) expect(json).not.toContain(secret);
		expect(inspect).not.toHaveBeenCalled(); expect(ssm.send).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled();
	});
	it("composes source preflight, real pinned TLS, prepared key verification, fresh authorization and compare-and-swap selection", async () => {
		const target = fixture.settings.targets[0]; const reply = await controller().request(principal, command(), new AbortController().signal);
		expect(reply).toMatchObject({ ok: true, view: { selected: [{ runtimeId: target.expected.runtimeId, origin: privateRuntimeOrigin(target.expected.bindingId, runtimeControlScope(fixture.settings.scope)), available: true }] } });
		expect(inspect).toHaveBeenCalledWith(target.expected, expect.any(AbortSignal)); expect(query.mock.calls[0][1]).toEqual([target.credentialId, target.expected.bindingId, fixture.keys[0].secretHash, fixture.settings.expiresAt]);
		expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: target.expected.runtimeId, expectedSourceFingerprint: "f".repeat(64), observedImageDigest: "sha256:" + "b".repeat(64), privateIp: "10.0.0.2" }));
		expect(activate).toHaveBeenCalledWith(target.expected.runtimeId, "alice", null); expect(authorize).toHaveBeenCalledTimes(3); expect(httpBytes).toBe(0);
	});
	it.each([{ privateIp: "10.0.0.8" }, { credentialId: CONTROL_REQUEST }, { userId: "other" }])("rejects browser cloud/identity metadata before authorization", async extra => {
		expect(await controller().request(principal, { ...command(), ...extra }, new AbortController().signal)).toMatchObject({ ok: false, status: 400 }); expect(authorize).not.toHaveBeenCalled();
	});
	it("requires a current authorized session before reading source or cloud metadata", async () => {
		authorize.mockRejectedValue(Error("private auth provider detail")); const reply = await controller().request(principal, command(), new AbortController().signal);
		expect(reply).toMatchObject({ ok: false }); expect(JSON.stringify(reply)).not.toContain("provider detail"); expect(prepare).not.toHaveBeenCalled(); expect(inspect).not.toHaveBeenCalled();
	});
	it.each([{ appId: CONTROL_REQUEST }, { releaseId: CONTROL_REQUEST }, { environment: "preview" }])("does not observe unknown or cross-environment targets", async override => {
		expect(await controller().request(principal, { ...command(), ...override }, new AbortController().signal)).toMatchObject({ ok: false }); expect(inspect).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled();
	});
	it("does not register or activate after failed AWS evidence", async () => {
		inspect.mockRejectedValue(Error("provider metadata")); expect(await controller().request(principal, command(), new AbortController().signal)).toMatchObject({ ok: false }); expect(register).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
	});
	it("authorizes the source manager before either independent external read", async () => {
		prepare.mockRejectedValueOnce(new WorkspaceError(403, "Manager removed")); expect(await controller().request(principal, command(), new AbortController().signal)).toMatchObject({ ok: false, status: 403 }); expect(inspect).not.toHaveBeenCalled(); expect(ssm.send).not.toHaveBeenCalled();
	});
	it("holds admission for both external reads even if one rejects early and the other ignores cancellation", async () => {
		vi.useFakeTimers(); inspect.mockRejectedValueOnce(Error("unavailable")); let finish = (_value: ReturnType<typeof parameter>) => {}; let name = "";
		ssm.send.mockImplementationOnce(command => { name = command.input.Name; return new Promise(resolve => { finish = resolve; }); }); const value = controller();
		const work = value.request(principal, command(), new AbortController().signal); await vi.advanceTimersByTimeAsync(15000); expect(await work).toMatchObject({ ok: false, status: 503 });
		expect(await value.request(principal, command(), new AbortController().signal)).toMatchObject({ ok: false, status: 503 }); expect(ssm.send).toHaveBeenCalledOnce(); finish(parameter(name)); await vi.advanceTimersByTimeAsync(1); expect(register).not.toHaveBeenCalled();
	});
	it("rejects an unexpected SSM version and a hash mismatch without registration", async () => {
		ssm.send.mockResolvedValueOnce({ Parameter: { Type: "SecureString", Version: 2 } }); expect(await controller().request(principal, command(), new AbortController().signal)).toMatchObject({ ok: false, status: 409 }); expect(register).not.toHaveBeenCalled();
		query.mockResolvedValue({ rowCount: 0, rows: [] }); expect(await controller().request(principal, command(), new AbortController().signal)).toMatchObject({ ok: false, status: 409 }); expect(register).not.toHaveBeenCalled();
	});
	it("rejects a live server with the wrong pinned release certificate", async () => {
		server.setSecureContext({ key: fixture.materials[1].key, cert: fixture.materials[1].cert });
		expect(await controller().request(principal, command(), new AbortController().signal)).toMatchObject({ ok: false }); expect(register).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
	});
	it("rechecks session approval after external verification before registration", async () => {
		authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("signed out")); expect(await controller().request(principal, command(), new AbortController().signal)).toMatchObject({ ok: false }); expect(register).not.toHaveBeenCalled();
	});
	it("does not activate after source drift or a compare-and-swap conflict", async () => {
		register.mockRejectedValueOnce(new WorkspaceError(409, "private source")); expect(await controller().request(principal, command(), new AbortController().signal)).toMatchObject({ ok: false, status: 409 }); expect(activate).not.toHaveBeenCalled();
		activate.mockRejectedValueOnce(new WorkspaceError(409, "private conflict")); expect(await controller().request(principal, command(), new AbortController().signal)).toMatchObject({ ok: false, status: 409 });
	});
	it("keeps admission occupied until timed-out work actually settles and starts no late SQL work", async () => {
		vi.useFakeTimers(); let finish = () => {}; authorize.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(); })); const value = controller();
		const pending = value.request(principal, command(), new AbortController().signal); await vi.advanceTimersByTimeAsync(15000); expect(await pending).toMatchObject({ ok: false, status: 503 });
		expect(await value.request(principal, command(), new AbortController().signal)).toMatchObject({ ok: false, status: 503 }); finish(); await Promise.resolve(); await Promise.resolve(); expect(prepare).not.toHaveBeenCalled();
	});
	it("closes and rejects cancellation/expired or extended demo windows", async () => {
		const value = controller(); expect(await value.request(principal, command(), AbortSignal.abort())).toMatchObject({ ok: false }); value.close(); expect(await value.request(principal, command(), new AbortController().signal)).toMatchObject({ ok: false });
		expect(() => controller({ ...fixture.settings, expiresAt: Date.now() - 1 })).toThrow(); expect(() => controller({ ...fixture.settings, expiresAt: Date.now() + 7260000 })).toThrow();
	});
	it("rejects a catalog sharing preview resources, duplicating runtimes or replacing release certificates", () => {
		const duplicate = structuredClone(fixture.settings); duplicate.targets[2].expected.bindingId = duplicate.targets[0].expected.bindingId; expect(RuntimeControlSettings.safeParse(duplicate).success).toBe(false);
		const reused = structuredClone(fixture.settings); reused.targets[1].expected.runtimeId = reused.targets[0].expected.runtimeId; expect(RuntimeControlSettings.safeParse(reused).success).toBe(false);
		const wrong = structuredClone(fixture.settings); wrong.targets[0].certificatePem = fixture.materials[1].cert; expect(RuntimeControlSettings.safeParse(wrong).success).toBe(false);
	});
});
