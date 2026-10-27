import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	config: { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, PRIVATE_APP_PUBLISH_ENABLED: true, PRIVATE_APP_PUBLISH_CONFIG: "/operator/control.json", DATABASE_URL: "postgres://postgres@pooler.example.test/db?sslmode=no-verify&sslrootcert=missing.pem&uselibpqcompat=true" },
	file: vi.fn(), pool: vi.fn(), query: vi.fn(), end: vi.fn(), on: vi.fn(), construct: vi.fn(), authorize: vi.fn(), approval: vi.fn(), request: vi.fn(), close: vi.fn(),
}));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("pg", () => ({ Pool: class { constructor(options: unknown) { mocks.pool(options); } query = mocks.query; end = mocks.end; on = mocks.on; } }));
vi.mock("@/lib/gateway/serverConfig", async original => ({ ...await original<typeof import("@/lib/gateway/serverConfig")>(), gatewayFile: mocks.file }));
vi.mock("@/lib/platformAccess", () => ({ requirePlatformAccess: mocks.approval }));
vi.mock("@/lib/apps/runtimeController", () => ({ AppRuntimeController: class {
	constructor(pool: unknown, settings: unknown, authorize: (principal: unknown) => Promise<void>) { mocks.construct(pool, settings); mocks.authorize.mockImplementation(authorize); }
	request = mocks.request; close = mocks.close;
} }));
import { configuredRuntimeControl } from "@/lib/apps/runtimeControlBootstrap";
import type { RuntimeControlPort } from "@/lib/apps/runtimeControlSocket";
import { runtimeControlFixture } from "../../helpers/runtimeControlFixture";

let fixture: Awaited<ReturnType<typeof runtimeControlFixture>>; const ports: RuntimeControlPort[] = [];
beforeAll(async () => { fixture = await runtimeControlFixture(); fixture.settings.scope.privateDomain = "apps.smart-deploy.xyz"; });
afterAll(async () => fixture.dispose());
beforeEach(() => {
	vi.clearAllMocks(); mocks.end.mockResolvedValue(undefined); mocks.query.mockResolvedValue({ rows: [{ id: "alice", email: "alice@example.test", emailVerified: true }] }); mocks.approval.mockResolvedValue(undefined);
	Object.assign(mocks.config, { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, PRIVATE_APP_PUBLISH_ENABLED: true });
	fixture.settings.expiresAt = Math.floor(Date.now() / 1000) * 1000 + 120000;
	mocks.file.mockImplementation(async (path: string) => Buffer.from(path.endsWith(".json") ? JSON.stringify({ runtime: fixture.settings, databaseCaFile: "/operator/ca.pem" }) : fixture.materials[0].cert));
});
afterEach(() => { for (const port of ports.splice(0)) port.close(); vi.useRealTimers(); });
describe("worker-only publisher configuration", () => {
	it.each(["WORKSPACE_APPS_ENABLED", "PRIVATE_APP_GATEWAY_ENABLED", "PRIVATE_APP_PUBLISH_ENABLED"] as const)("stays inert when %s is disabled", async flag => {
		mocks.config[flag] = false; expect(await configuredRuntimeControl()).toBeNull(); expect(mocks.file).not.toHaveBeenCalled(); expect(mocks.pool).not.toHaveBeenCalled(); expect(mocks.construct).not.toHaveBeenCalled();
	});
	it("reads only bounded operator files and forces verified CA/hostname TLS despite URL overrides", async () => {
		const port = await configuredRuntimeControl(); if (!port) throw Error("Control port missing."); ports.push(port);
		expect(port.expiresAt).toBe(fixture.settings.expiresAt); expect(port.databaseCaFile).toBe("/operator/ca.pem");
		expect(mocks.file).toHaveBeenNthCalledWith(1, "/operator/control.json", 32768); expect(mocks.file).toHaveBeenNthCalledWith(2, "/operator/ca.pem", 65536);
		expect(mocks.pool).toHaveBeenCalledWith(expect.objectContaining({ connectionString: "postgres://postgres@pooler.example.test/db", ssl: { ca: fixture.materials[0].cert, rejectUnauthorized: true, minVersion: "TLSv1.2" }, max: 2, query_timeout: 2200, statement_timeout: 2000 }));
		await mocks.authorize({ userId: "alice", sessionId: "alice-session" }); expect(mocks.query.mock.calls[0][1]).toEqual(["alice-session", "alice"]); expect(mocks.approval).toHaveBeenCalledWith({ id: "alice", email: "alice@example.test", emailVerified: true });
		port.close(); port.close(); expect(mocks.close).toHaveBeenCalledOnce(); expect(mocks.end).toHaveBeenCalledOnce();
	});
	it("rejects a missing live session and rechecks actual verification/approval", async () => {
		const port = await configuredRuntimeControl(); if (!port) throw Error("Control port missing."); ports.push(port);
		mocks.query.mockResolvedValueOnce({ rows: [] }); await expect(mocks.authorize({ userId: "alice", sessionId: "revoked" })).rejects.toThrow("Unauthorized"); expect(mocks.approval).not.toHaveBeenCalled();
		mocks.approval.mockRejectedValueOnce(Error("approval revoked")); await expect(mocks.authorize({ userId: "alice", sessionId: "alice-session" })).rejects.toThrow("approval revoked");
	});
	it("rejects a different private-app domain before constructing cloud or database clients", async () => {
		mocks.file.mockResolvedValueOnce(Buffer.from(JSON.stringify({ runtime: { ...fixture.settings, scope: { ...fixture.settings.scope, privateDomain: "other.example.test" } }, databaseCaFile: "/operator/ca.pem" })));
		await expect(configuredRuntimeControl()).rejects.toThrow("Runtime control unavailable"); expect(mocks.pool).not.toHaveBeenCalled(); expect(mocks.construct).not.toHaveBeenCalled();
	});
	it("closes the pool and controller at the fixed demo expiry", async () => {
		vi.useFakeTimers(); const port = await configuredRuntimeControl(); if (!port) throw Error("Control port missing."); ports.push(port);
		await vi.advanceTimersByTimeAsync(fixture.settings.expiresAt - Date.now() + 1); expect(mocks.close).toHaveBeenCalledOnce(); expect(mocks.end).toHaveBeenCalledOnce();
	});
	it("releases its database pool if controller construction fails", async () => {
		mocks.construct.mockImplementationOnce(() => { throw Error("operator detail"); }); await expect(configuredRuntimeControl()).rejects.toThrow("Runtime control unavailable"); expect(mocks.end).toHaveBeenCalledOnce();
	});
});
