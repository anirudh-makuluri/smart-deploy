import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GatewayAuthenticatedHttp, type GatewayAuthenticatedHttpOptions } from "@/lib/gateway/authenticatedHttp";
import { GATEWAY_SESSION_COOKIE } from "@/lib/gateway/cookies";
import type { GatewayFetch } from "@/lib/gateway/controlClient";
import { gatewayCertificate } from "../../helpers/gatewayCertificate";

const BINDING = "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac";
const IDENTITY = { id: "verified-user", email: "verified@example.test" };
const TOKEN = "t".repeat(43);
const WORKLOAD = { bindingId: BINDING, environment: "published" as const, releaseId: "997a2326-5b9b-4c08-aaef-45c618db01d3" };
let certificate: Awaited<ReturnType<typeof gatewayCertificate>>;
function options(): GatewayAuthenticatedHttpOptions {
	return { documentsEnabled: false, context: { bindingId: BINDING, environment: "published", appOrigin: "https://app.test" },
		browser: { bindingId: BINDING, appOrigin: "https://app.test", platformOrigin: "https://control.test", serviceCredential: "sd_gateway_91843492-f2ea-437c-a540-b144c3bc8ed2." + "s".repeat(43), timeoutMs: 1000, transactions: { ttlSeconds: 60, maxEntries: 10 } },
		upstream: { ...WORKLOAD, privateIp: "10.0.1.23", port: 443, certificatePem: certificate.cert, timeoutMs: 100, maxConnections: 1 },
		limits: { maxConnections: 1, maxRequestBytes: 64, maxResponseBytes: 1024, idleMs: 100, timeoutMs: 500 } };
}
function request(path = "/items?q=new", headers: HeadersInit = {}, method = "GET") {
	return new Request("https://app.test" + path, { method, headers: { "sec-fetch-site": "same-origin", ...Object.fromEntries(new Headers(headers)) } });
}
function fixture(configuration = options()) {
	const transport = vi.fn<GatewayFetch>().mockResolvedValue(Response.json({ identity: IDENTITY }));
	const dial = vi.fn(() => { throw new Error("Fixture does not forward customer HTTP."); });
	return { gateway: new GatewayAuthenticatedHttp(configuration, transport, dial), transport, dial };
}
beforeAll(async () => { certificate = await gatewayCertificate(WORKLOAD); });
afterAll(async () => { await certificate.dispose(); });

describe("authenticated HTTP gateway composition", () => {
	it("sends anonymous document navigation to fixed platform confirmation without contacting app", async () => {
		const { gateway, transport, dial } = fixture(); const response = await gateway.handle(request("/items?q=new", { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }));
		expect(response.status).toBe(303); const target = new URL(response.headers.get("location")!);
		expect(target.origin + target.pathname).toBe("https://control.test/apps/authorize"); expect(target.searchParams.get("bindingId")).toBe(BINDING);
		expect(response.headers.get("set-cookie")).toContain("__Host-smartdeploy-app-login="); expect(transport).not.toHaveBeenCalled(); expect(dial).not.toHaveBeenCalled(); gateway.close();
	});
	it("returns private 401 for anonymous fetches without issuing a login or dialing", async () => {
		const { gateway, transport, dial } = fixture(); const response = await gateway.handle(request());
		expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.has("set-cookie")).toBe(false); expect(transport).not.toHaveBeenCalled(); expect(dial).not.toHaveBeenCalled(); gateway.close();
	});
	it("composes the enabled reserved document broker before customer routing", async () => {
		const { gateway, transport, dial } = fixture({ ...options(), documentsEnabled: true });
		transport.mockResolvedValue(Response.json({ document: null }));
		const response = await gateway.handle(new Request("https://app.test/__smartdeploy/documents", { method: "POST",
			headers: { origin: "https://app.test", "sec-fetch-site": "same-origin", "content-type": "application/json", cookie: `${GATEWAY_SESSION_COOKIE}=${TOKEN}` },
			body: JSON.stringify({ action: "get", collection: "notes", id: "shared" }) }));
		expect(response.status).toBe(200); expect(await response.json()).toEqual({ document: null });
		expect(transport.mock.calls[0][0].pathname).toBe("/api/gateway/documents"); expect(transport).toHaveBeenCalledTimes(1); expect(dial).not.toHaveBeenCalled(); gateway.close();
	});
	it("keeps document paths reserved when disabled and rejects enabled encoded variants", async () => {
		for (const enabled of [false, true]) {
			const { gateway, transport, dial } = fixture({ ...options(), documentsEnabled: enabled });
			for (const path of enabled ? ["/%5f_smartdeploy/documents", "/__SMARTDEPLOY/documents", "/__smartdeploy/documents/"] : ["/__smartdeploy/documents"]) {
				const response = await gateway.handle(request(path, { accept: "text/html" })); expect(response.status).toBe(404);
			}
			expect(transport).not.toHaveBeenCalled(); expect(dial).not.toHaveBeenCalled(); gateway.close();
		}
	});
	it.each([401, 403, 500])("stops authorization failure %i before upstream", async (status) => {
		const { gateway, transport, dial } = fixture(); transport.mockResolvedValueOnce(new Response("private control-plane detail", { status }));
		const response = await gateway.handle(request("/", { cookie: `${GATEWAY_SESSION_COOKIE}=${TOKEN}`, authorization: "Bearer browser-secret" }));
		expect(response.status).toBe(status === 500 ? 503 : status); expect(await response.text()).not.toContain("detail"); expect(dial).not.toHaveBeenCalled(); gateway.close();
	});
	it("freshly authorizes each request and never forwards browser headers to machine API", async () => {
		const { gateway, transport, dial } = fixture();
		transport.mockImplementation(async () => Response.json({ identity: IDENTITY }));
		for (let index = 0; index < 2; index++) expect((await gateway.handle(request("/", { cookie: `${GATEWAY_SESSION_COOKIE}=${TOKEN}`, origin: "https://app.test" }))).status).toBe(502);
		expect(transport).toHaveBeenCalledTimes(2); expect(dial).toHaveBeenCalledTimes(2);
		const headers = new Headers(transport.mock.calls[0][1].headers); expect(headers.has("cookie")).toBe(false); expect(headers.has("origin")).toBe(false); expect(headers.get("authorization")).toBe("Bearer " + options().browser.serviceCredential); gateway.close();
	});
	it.each(["foreign", "reserved", "method"])("stops %s traffic before authorization", async (kind) => {
		const { gateway, transport, dial } = fixture();
		const response = await gateway.handle(kind === "foreign" ? request("/", { origin: "https://other.test", "sec-fetch-site": "cross-site", cookie: `${GATEWAY_SESSION_COOKIE}=${TOKEN}` }) : kind === "reserved" ? request("/__smartdeploy/unknown", { accept: "text/html" }) : request("/", {}, "PROPFIND"));
		expect(response.status).toBe(kind === "reserved" ? 404 : 403); expect(transport).not.toHaveBeenCalled(); expect(dial).not.toHaveBeenCalled(); gateway.close();
	});
	it("rejects new work at the authorization admission cap", async () => {
		const { gateway, transport, dial } = fixture(); let release = (_response: Response) => {};
		transport.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
		const pending = gateway.handle(request("/", { cookie: `${GATEWAY_SESSION_COOKIE}=${TOKEN}` }));
		await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1)); expect((await gateway.handle(request())).status).toBe(503);
		release(Response.json({ identity: IDENTITY })); expect((await pending).status).toBe(502); expect(dial).toHaveBeenCalledTimes(1); gateway.close();
	});
	it("drops pending authorization on retirement without dialing", async () => {
		const { gateway, transport, dial } = fixture(); let release = (_response: Response) => {};
		transport.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
		const pending = gateway.handle(request("/", { cookie: `${GATEWAY_SESSION_COOKIE}=${TOKEN}` }));
		await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1)); gateway.close(); release(Response.json({ identity: IDENTITY })); expect((await pending).status).toBe(503); expect(dial).not.toHaveBeenCalled(); expect((await gateway.handle(request())).status).toBe(503);
	});
	it("rejects mismatched browser authority and platform/app hosts", () => {
		for (const patch of [{ appOrigin: "https://other.test" }, { platformOrigin: "https://app.test" }, { bindingId: "9296be7b-766e-4d25-9f59-f9418b5ac966" }]) expect(() => fixture({ ...options(), browser: { ...options().browser, ...patch } })).toThrow("App request unavailable.");
	});
});
