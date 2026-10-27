import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmAppLogin } from "@/lib/apps/browserCallback";

const INPUT = { bindingId: "fa03e952-f705-42e2-9706-6a0b425de83d", challenge: "c".repeat(43), state: "s".repeat(43) };
const IDENTITY = { id: "verified-user", email: "user@example.test" };
const ORIGIN = "https://app.test";
const CODE = "k".repeat(43);
const NOW = Date.UTC(2026, 9, 25);
function receipt() { return { code: CODE, state: INPUT.state, callbackUrl: ORIGIN + "/__smartdeploy/callback", expiresAt: new Date(NOW + 60000).toISOString() }; }
const transport = vi.fn<typeof fetch>();
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); transport.mockReset(); vi.stubGlobal("fetch", transport); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("confirmed browser handoff destination", () => {
	it("posts explicit displayed identity and validates a fixed callback before navigation", async () => {
		transport.mockResolvedValue(Response.json(receipt()));
		const controller = new AbortController();
		expect(await confirmAppLogin(INPUT, IDENTITY, ORIGIN, controller.signal)).toBe(`${ORIGIN}/__smartdeploy/callback?code=${CODE}&state=${INPUT.state}`);
		expect(transport).toHaveBeenCalledWith("/api/apps/handoff", expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal }));
		expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({ ...INPUT, expectedIdentity: IDENTITY });
	});
	it.each([{}, null, [], { ...receipt(), code: "bad" }, { ...receipt(), state: "x".repeat(43) }, { ...receipt(), callbackUrl: "https://other.test/__smartdeploy/callback" },
		{ ...receipt(), callbackUrl: ORIGIN + "/__smartdeploy/callback?upstream=evil" }, { ...receipt(), expiresAt: new Date(NOW).toISOString() },
		{ ...receipt(), expiresAt: new Date(NOW + 120001).toISOString() }, { ...receipt(), upstream: "evil" }])("rejects malformed, stale or foreign successful receipts: %j", async (body) => {
		transport.mockResolvedValue(Response.json(body));
		await expect(confirmAppLogin(INPUT, IDENTITY, ORIGIN, new AbortController().signal)).rejects.toThrow();
	});
	it.each([401, 403, 409, 503, 302])("denies HTTP %s before parsing or redirecting", async (status) => {
		const response = Response.json(receipt(), { status });
		transport.mockResolvedValue(response);
		await expect(confirmAppLogin(INPUT, IDENTITY, ORIGIN, new AbortController().signal)).rejects.toThrow();
		expect(response.bodyUsed).toBe(false);
	});
	it("rejects HTML, invalid JSON, redirects and cancellation after the request", async () => {
		const redirected = Response.json(receipt()); Object.defineProperty(redirected, "redirected", { value: true });
		for (const response of [new Response("<html>Login</html>"), new Response("{", { headers: { "content-type": "application/json" } }), redirected]) {
			transport.mockResolvedValue(response);
			await expect(confirmAppLogin(INPUT, IDENTITY, ORIGIN, new AbortController().signal)).rejects.toThrow();
		}
		const controller = new AbortController(); controller.abort(); transport.mockResolvedValue(Response.json(receipt()));
		await expect(confirmAppLogin(INPUT, IDENTITY, ORIGIN, controller.signal)).rejects.toThrow();
	});
});
