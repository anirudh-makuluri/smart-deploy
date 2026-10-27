import { io as connect, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfiguredRuntimeControl } from "../../src/lib/apps/runtimeControlBootstrap";
import type { PrivateDemoWorker } from "../../src/lib/apps/privateDemoWorker";
import { createWebSocketAuthToken } from "../../src/lib/wsAuth";
import { CONTROL_APP, CONTROL_REQUEST } from "../helpers/runtimeControlFixture";
const authority = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/platformAccess", () => ({ requirePlatformSession: authority.session }));
const clients = new Set<Socket>(); const workers: PrivateDemoWorker[] = [];
const origin = "https://control.example.test"; const version = "a".repeat(40);
beforeEach(() => { vi.resetModules(); vi.stubEnv("BETTER_AUTH_SECRET", "demo-transport-fixture-not-for-production"); vi.stubEnv("NEXT_PUBLIC_WS_URL", "ws://127.0.0.1/ws"); authority.session.mockReset().mockResolvedValue({ id: "owner" }); });
afterEach(async () => { for (const socket of clients) socket.disconnect(); clients.clear(); for (const worker of workers.splice(0)) await worker.close().catch(() => {}); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function fixture(expiresAt = Date.now() + 30000) {
  const request = vi.fn<ConfiguredRuntimeControl["request"]>().mockResolvedValue({ ok: true, requestId: CONTROL_REQUEST, appId: CONTROL_APP, view: { expiresAt, selected: [], choices: [] } });
  const control: ConfiguredRuntimeControl = { expiresAt, databaseCaFile: "/operator/ca.pem", request, close: vi.fn() };
  const { createPrivateDemoWorker } = await import("../../src/lib/apps/privateDemoWorker");
  const worker = createPrivateDemoWorker(control, origin, version); workers.push(worker);
  await new Promise<void>((resolve, reject) => { worker.server.once("error", reject); worker.server.listen(0, "127.0.0.1", resolve); });
  const address = worker.server.address(); if (!address || typeof address === "string") throw Error("Fixture unavailable.");
  const base = "http://127.0.0.1:" + address.port;
  function client(token = createWebSocketAuthToken("owner", "owner-session"), clientOrigin = origin) {
    const socket = connect(base, { path: "/ws", transports: ["websocket"], reconnection: false, timeout: 1000, extraHeaders: { origin: clientOrigin }, auth: { token } }); clients.add(socket); return socket;
  }
  return { worker, control, request, base, client, port: address.port };
}
async function connected(socket: Socket) { await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); }); }
describe("actual runtime-only worker transport with controlled session authority", () => {
  it("reports unavailable after expiry even before its timer is dispatched", async () => {
    const value = await fixture(); vi.spyOn(Date, "now").mockReturnValue(value.control.expiresAt + 1);
    const response = await fetch(value.base + "/health"); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ ok: false, mode: "private-app-demo" });
  });
  it("serves exact mode/version/expiry health and denies internal/job HTTP endpoints", async () => {
    const value = await fixture(); const response = await fetch(value.base + "/health");
    expect(await response.json()).toEqual({ ok: true, service: "websocket", environment: "production", port: value.port, version, mode: "private-app-demo", expiresAt: value.control.expiresAt });
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(await (await fetch(value.base + "/health", { method: "HEAD" })).text()).toBe("");
    for (const target of ["/health?token=untrusted", "/internal/deployment-runs/fake/events", "/deploy"]) expect((await fetch(value.base + target, { method: "POST", headers: { authorization: "Bearer ignored" }, body: "{}" })).status).toBe(404);
    expect(value.request).not.toHaveBeenCalled();
  });
  it("uses signed socket identity and rechecks the session for prepared runtime commands", async () => {
    const value = await fixture(); const socket = value.client(); await connected(socket);
    const command = { action: "inspect", appId: CONTROL_APP, requestId: CONTROL_REQUEST };
    expect(await socket.timeout(1000).emitWithAck("apps:runtime", command)).toMatchObject({ ok: true, appId: CONTROL_APP });
    expect(value.request).toHaveBeenCalledWith({ userId: "owner", sessionId: "owner-session" }, command, expect.any(AbortSignal));
    expect(authority.session).toHaveBeenCalledWith("owner", "owner-session");
    authority.session.mockRejectedValue(Error("revoked")); const disconnected = new Promise<void>(resolve => socket.once("disconnect", () => resolve())); socket.emit("apps:runtime", command, () => {}); await disconnected;
    expect(value.request).toHaveBeenCalledTimes(1);
  });
  it("rejects every general deployment/agent/workspace event without invoking runtime controls", async () => {
    const value = await fixture(); const socket = value.client(); await connected(socket);
    for (const event of ["agent:run", "deploy:run", "workspace:subscribe", "workspace:unsubscribe", "unexpected:event"]) {
      expect(await socket.timeout(1000).emitWithAck(event, { userID: "other", deployConfig: {}, token: "not-real" })).toEqual({ ok: false, status: 503, error: "Only prepared app runtime controls are available during this demo." });
    }
    expect(value.request).not.toHaveBeenCalled();
  });
  it.each(["forged-token", "foreign-origin"])("denies %s before session/controller admission", async variant => {
    const value = await fixture(); const socket = value.client(variant === "forged-token" ? "invalid" : createWebSocketAuthToken("owner", "owner-session"), variant === "foreign-origin" ? "https://foreign.example.test" : origin);
    await expect(connected(socket)).rejects.toThrow(); expect(authority.session).not.toHaveBeenCalled(); expect(value.request).not.toHaveBeenCalled();
  });
  it("rejects forged runtime actor/cloud fields before invoking the controller", async () => {
    const value = await fixture(); const socket = value.client(); await connected(socket);
    expect(await socket.timeout(1000).emitWithAck("apps:runtime", { action: "inspect", appId: CONTROL_APP, requestId: CONTROL_REQUEST, userId: "other", taskArn: "foreign" })).toMatchObject({ ok: false, status: 400 });
    expect(value.request).not.toHaveBeenCalled();
  });
  it("disconnects active sockets and stops HTTP at the absolute expiry", async () => {
    const value = await fixture(Date.now() + 3000); const socket = value.client(); await connected(socket);
    await new Promise<void>(resolve => socket.once("disconnect", () => resolve())); await value.worker.close();
    expect(value.worker.server.listening).toBe(false); expect(value.control.close).toHaveBeenCalledOnce();
  });
  it("still closes network listeners if control cleanup fails", async () => {
    const value = await fixture(); vi.mocked(value.control.close).mockImplementation(() => { throw Error("private detail"); });
    await expect(value.worker.close()).rejects.toThrow("Demo worker shutdown unavailable."); expect(value.worker.server.listening).toBe(false);
  });
});
