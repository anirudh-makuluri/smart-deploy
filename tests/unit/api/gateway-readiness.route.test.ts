import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  config: { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, PRIVATE_APP_DOCUMENTS_ENABLED: true, GATEWAY_CODE_TTL_SECONDS: "60", GATEWAY_SESSION_TTL_SECONDS: "900" },
  authenticate: vi.fn(), scope: vi.fn(), inspect: vi.fn(),
}));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: () => ({}) }));
vi.mock("@/lib/apps/gatewayServiceAuth", () => ({ authenticateGateway: mocks.authenticate }));
vi.mock("@/lib/apps/gatewayAuthStore", () => ({ GatewayAuthStore: class { documentReadinessScope = mocks.scope; } }));
vi.mock("@/lib/apps/pilotDocumentBackend", () => ({ inspectPilotDocumentBackend: mocks.inspect }));
import { POST } from "@/app/api/gateway/readiness/route";
import { WorkspaceError } from "@/lib/apps/workspaceStore";
import { AppDataError } from "@/lib/apps/documentSchema";
const scope = { appId: "11111111-1111-4111-8111-111111111111", environment: "preview" };
const browserContexts: Record<string, string>[] = [{ cookie: "session=fixture" }, { origin: "https://control.test" }, { "sec-fetch-site": "same-origin" }];
function request(body: unknown = {}, headers: Record<string, string> = {}, signal: AbortSignal | undefined = undefined, url = "https://control.test/api/gateway/readiness") {
  return new Request(url, { method: "POST", signal, headers: { "content-type": "application/json", authorization: "Bearer machine-key", "x-smartdeploy-binding-id": "binding", ...headers }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.config, { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, PRIVATE_APP_DOCUMENTS_ENABLED: true });
  mocks.authenticate.mockResolvedValue({ bindingId: "binding" }); mocks.scope.mockResolvedValue(scope); mocks.inspect.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("selected-machine document readiness", () => {
  it("returns only readiness and derives app/environment from the current managed binding", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ready: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.scope).toHaveBeenCalledWith("binding"); expect(mocks.inspect).toHaveBeenCalledWith(scope, expect.any(AbortSignal));
  });
  it.each(["appId", "environment", "token", "tableArn", "roleArn"])("rejects caller-provided %s", async field => {
    expect((await POST(request({ [field]: "override" }))).status).toBe(400); expect(mocks.scope).not.toHaveBeenCalled(); expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it.each(browserContexts)("denies browser context %j before authentication", async headers => {
    expect((await POST(request({}, headers))).status).toBe(403); expect(mocks.authenticate).not.toHaveBeenCalled(); expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("requires a matching assertion and a live selected service credential", async () => {
    expect((await POST(request({}, { "x-smartdeploy-binding-id": "other" }))).status).toBe(403);
    mocks.authenticate.mockRejectedValue(new WorkspaceError(401, "Gateway authentication required."));
    const denied = await POST(request()); expect(denied.status).toBe(401); expect(denied.headers.get("www-authenticate")).toContain("Bearer");
    expect(mocks.scope).not.toHaveBeenCalled(); expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("denies legacy/unselected bindings before storage", async () => {
    mocks.scope.mockRejectedValue(new WorkspaceError(401, "A current managed gateway is required."));
    expect((await POST(request())).status).toBe(401); expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it.each([403, 410, 503])("redacts failed backend readiness (%s)", async status => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.inspect.mockRejectedValue(new AppDataError(status));
    const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "Gateway authorization unavailable." });
  });
  it.each(["WORKSPACE_APPS_ENABLED", "PRIVATE_APP_GATEWAY_ENABLED", "PRIVATE_APP_DOCUMENTS_ENABLED"] as const)("fails closed when %s is off", async flag => {
    mocks.config[flag] = false; expect((await POST(request())).status).toBe(503); expect(mocks.authenticate).not.toHaveBeenCalled();
  });
  it("bounds bytes and denies insecure or query-bearing requests", async () => {
    expect((await POST(request("x".repeat(65)))).status).toBe(413);
    expect((await POST(request({}, {}, undefined, "http://control.test/api/gateway/readiness"))).status).toBe(403);
    expect((await POST(request({}, {}, undefined, "https://control.test/api/gateway/readiness?appId=other"))).status).toBe(403);
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("ends at four seconds and aborts pending backend work", async () => {
    vi.useFakeTimers(); let signal: AbortSignal | null = null; let finish = () => {};
    mocks.inspect.mockImplementation((_scope: unknown, value: AbortSignal) => { signal = value; return new Promise<void>(resolve => { finish = resolve; }); });
    const result = POST(request()); await vi.advanceTimersByTimeAsync(1); expect(signal).not.toBeNull();
    await vi.advanceTimersByTimeAsync(4000); expect((await result).status).toBe(503);
    expect((signal as AbortSignal | null)?.aborted).toBe(true); finish(); await vi.advanceTimersByTimeAsync(1);
  });
  it("does not start storage after delayed authentication or binding lookup", async () => {
    vi.useFakeTimers(); let finish = () => {};
    mocks.authenticate.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ bindingId: "binding" }); }));
    const result = POST(request()); await vi.advanceTimersByTimeAsync(4001); expect((await result).status).toBe(503); finish(); await vi.advanceTimersByTimeAsync(1);
    expect(mocks.scope).not.toHaveBeenCalled(); expect(mocks.inspect).not.toHaveBeenCalled();
    mocks.scope.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(scope); }));
    const next = POST(request()); await vi.advanceTimersByTimeAsync(4001); expect((await next).status).toBe(503); finish(); await vi.advanceTimersByTimeAsync(1);
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("does no work for an already cancelled request", async () => {
    expect((await POST(request({}, {}, AbortSignal.abort()))).status).toBe(503); expect(mocks.authenticate).not.toHaveBeenCalled();
  });
});
