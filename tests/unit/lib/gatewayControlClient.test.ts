import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayControlClient, type GatewayFetch } from "@/lib/gateway/controlClient";

const TOKEN = "t".repeat(43);
const CREDENTIAL = "sd_gateway_e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac." + "s".repeat(43);
const NOW = Date.UTC(2026, 9, 25);
const IDENTITY = { id: "user-a", email: "verified@example.test" };
const OPTIONS = { platformOrigin: "https://control.test", bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac", serviceCredential: CREDENTIAL, timeoutMs: 25 };
function fixture(response: Response) {
	const transport = vi.fn<GatewayFetch>().mockResolvedValue(response);
	return { client: new GatewayControlClient(OPTIONS, transport, () => NOW), transport };
}
afterEach(() => vi.useRealTimers());

describe("gateway machine control-plane transport", () => {
	it("uses only the configured origin/key and a cookie-free nonredirecting POST", async () => {
		const options = { ...OPTIONS };
		const transport = vi.fn<GatewayFetch>().mockResolvedValue(Response.json({ identity: IDENTITY }));
		const client = new GatewayControlClient(options, transport, () => NOW);
		options.platformOrigin = "https://changed.test";
		options.serviceCredential = "changed";
		expect(await client.authorize(TOKEN)).toEqual(IDENTITY);
		const [url, init] = transport.mock.calls[0];
		expect(url.href).toBe("https://control.test/api/gateway/authorize");
		expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit", cache: "no-store" });
		const headers = new Headers(init.headers);
		expect(headers.get("authorization")).toBe(`Bearer ${CREDENTIAL}`);
		expect(headers.get("x-smartdeploy-binding-id")).toBe(OPTIONS.bindingId);
		for (const name of ["cookie", "origin", "sec-fetch-site"]) expect(headers.has(name)).toBe(false);
		expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN });
	});

	it("validates redemption identity/token/expiry and the exact revocation acknowledgement", async () => {
		const expiry = new Date(NOW + 900000);
		const redeemed = fixture(Response.json({ token: TOKEN, expiresAt: expiry.toISOString(), identity: IDENTITY }));
		expect(await redeemed.client.redeem(TOKEN, "v".repeat(43), "https://app.test/__smartdeploy/callback")).toEqual({ token: TOKEN, expiresAt: expiry, identity: IDENTITY });
		expect(redeemed.transport.mock.calls[0][0].pathname).toBe("/api/gateway/redeem");
		const revoked = fixture(Response.json({ revoked: true }));
		await expect(revoked.client.revoke(TOKEN)).resolves.toBeUndefined();
		expect(revoked.transport.mock.calls[0][0].pathname).toBe("/api/gateway/logout");
		await expect(fixture(Response.json({ revoked: false })).client.revoke(TOKEN)).rejects.toMatchObject({ status: 503 });
	});

	it.each([401, 403, 429, 500, 302, 204])("denies unexpected HTTP %s without exposing error bodies", async (status) => {
		const response = new Response(status === 204 ? null : "private backend details", { status });
		const { client } = fixture(response);
		await expect(client.authorize(TOKEN)).rejects.toMatchObject({ status: status === 401 || status === 403 ? status : 503 });
	});

	it.each([null, {}, [], { identity: null }, { identity: { id: "", email: "x" } }, { identity: { ...IDENTITY, role: "admin" } }])("rejects malformed successful authority: %j", async (payload) => {
		await expect(fixture(Response.json(payload)).client.authorize(TOKEN)).rejects.toMatchObject({ status: 503 });
	});
	it("rejects HTML, invalid JSON, malformed UTF-8 and excessive advertised lengths", async () => {
		const cases = [new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } }),
			new Response("{", { headers: { "content-type": "application/json" } }),
			new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } }),
			new Response("{}", { headers: { "content-type": "application/json", "content-length": "4097" } })];
		for (const response of cases) await expect(fixture(response).client.authorize(TOKEN)).rejects.toMatchObject({ status: 503 });
	});
	it("bounds actual streamed bytes when length is absent or false and cancels the body", async () => {
		for (const length of [null, "1"]) {
			let cancelled = false;
			const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel() { cancelled = true; } });
			const headers = new Headers({ "content-type": "application/json" });
			if (length) headers.set("content-length", length);
			await expect(fixture(new Response(stream, { headers })).client.authorize(TOKEN)).rejects.toMatchObject({ status: 503 });
			expect(cancelled).toBe(true);
		}
	});
	it("accepts a valid body at the exact byte ceiling", async () => {
		const body = JSON.stringify({ identity: IDENTITY }).padEnd(4096, " ");
		expect(await fixture(new Response(body, { headers: { "content-type": "application/json", "content-length": "4096" } })).client.authorize(TOKEN)).toEqual(IDENTITY);
	});
	it.each([-1, 0, 3600001])("rejects expired or excessive session lifetime %s", async (remaining) => {
		const response = Response.json({ token: TOKEN, expiresAt: new Date(NOW + remaining).toISOString(), identity: IDENTITY });
		await expect(fixture(response).client.redeem(TOKEN, TOKEN, "https://app.test/__smartdeploy/callback")).rejects.toMatchObject({ status: 503 });
	});
	it("rejects redirected or wrong-endpoint responses even from an injected transport", async () => {
		for (const property of ["redirected", "url"]) {
			const response = Response.json({ identity: IDENTITY });
			Object.defineProperty(response, property, { value: property === "redirected" ? true : "https://elsewhere.test/api/gateway/authorize" });
			await expect(fixture(response).client.authorize(TOKEN)).rejects.toMatchObject({ status: 503 });
		}
	});
	it("bounds a transport that never resolves and signals cancellation", async () => {
		vi.useFakeTimers();
		const transport = vi.fn<GatewayFetch>().mockImplementation(() => new Promise<Response>(() => {}));
		const client = new GatewayControlClient(OPTIONS, transport, () => NOW);
		const pending = expect(client.authorize(TOKEN)).rejects.toMatchObject({ status: 503 });
		await vi.advanceTimersByTimeAsync(25);
		await pending;
		expect(transport.mock.calls[0][1].signal?.aborted).toBe(true);
	});
	it("cancels a stalled response body at the deadline", async () => {
		vi.useFakeTimers();
		let cancelled = false;
		const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
		const { client } = fixture(new Response(stream, { headers: { "content-type": "application/json" } }));
		const pending = expect(client.authorize(TOKEN)).rejects.toMatchObject({ status: 503 });
		await vi.advanceTimersByTimeAsync(25);
		await pending;
		expect(cancelled).toBe(true);
	});
	it("redacts transport errors and rejects invalid credentials/inputs before any request", async () => {
		const transport = vi.fn<GatewayFetch>().mockRejectedValue(new Error(CREDENTIAL));
		const client = new GatewayControlClient(OPTIONS, transport);
		await expect(client.authorize(TOKEN)).rejects.toThrow("App authorization unavailable.");
		transport.mockClear();
		await expect(client.authorize("bad")).rejects.toMatchObject({ status: 401 });
		await expect(client.redeem("bad", TOKEN, "https://app.test/__smartdeploy/callback")).rejects.toMatchObject({ status: 401 });
		expect(transport).not.toHaveBeenCalled();
		for (const platformOrigin of ["http://control.test", "https://control.test/", "https://user:secret@control.test", "not an origin"]) {
			expect(() => new GatewayControlClient({ ...OPTIONS, platformOrigin })).toThrow("Canonical HTTPS gateway origins required.");
		}
		for (const timeoutMs of [0, 5001, NaN, Infinity, 1.5]) expect(() => new GatewayControlClient({ ...OPTIONS, timeoutMs })).toThrow();
		expect(() => new GatewayControlClient({ ...OPTIONS, serviceCredential: "bad\r\nsecret" })).toThrow();
	});
});
