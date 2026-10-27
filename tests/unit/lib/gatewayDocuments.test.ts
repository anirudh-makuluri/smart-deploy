import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayControlClient, type GatewayFetch } from "@/lib/gateway/controlClient";
import { GatewayBrowserDocuments } from "@/lib/gateway/browserDocuments";
import { GATEWAY_SESSION_COOKIE } from "@/lib/gateway/cookies";

const TOKEN = "t".repeat(43);
const OPTIONS = { platformOrigin: "https://control.test", bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac",
	serviceCredential: "sd_gateway_91843492-f2ea-437c-a540-b144c3bc8ed2." + "s".repeat(43), timeoutMs: 50 };
const CONTEXT = { appOrigin: "https://app.test", bindingId: OPTIONS.bindingId, environment: "published" as const };
const GET = { action: "get" as const, collection: "notes", id: "shared" };
const DOCUMENT = { collection: "notes", id: "shared", version: "997a2326-5b9b-4c08-aaef-45c618db01d3", json: '{"text":"saved"}' };
const FOREIGN_CONTEXTS: Record<string, string>[] = [{ origin: "https://sibling.test" }, { origin: "null" }, { origin: "" }, { "sec-fetch-site": "same-site" },
	{ "sec-fetch-site": "cross-site" }, { host: "sibling.test" }, { upgrade: "websocket" }];
function fixture(response = Response.json({ document: DOCUMENT })) {
	const transport = vi.fn<GatewayFetch>().mockResolvedValue(response);
	return { client: new GatewayControlClient(OPTIONS, transport), browser: new GatewayBrowserDocuments(CONTEXT, OPTIONS, transport), transport };
}
function request(body: unknown = GET, headers: Record<string, string> = {}, path = "/__smartdeploy/documents", signal: AbortSignal = new AbortController().signal) {
	return new Request(CONTEXT.appOrigin + path, { method: "POST", headers: { origin: CONTEXT.appOrigin, "sec-fetch-site": "same-origin",
		"content-type": "application/json", cookie: `${GATEWAY_SESSION_COOKIE}=${TOKEN}`, ...headers }, body: JSON.stringify(body), signal });
}
afterEach(() => vi.useRealTimers());

describe("gateway document machine transport", () => {
	it("sends only explicit machine credentials, binding and validated operation", async () => {
		const { client, transport } = fixture();
		expect(await client.document(TOKEN, GET, new AbortController().signal)).toEqual({ document: DOCUMENT });
		const [url, init] = transport.mock.calls[0]; expect(url.href).toBe("https://control.test/api/gateway/documents");
		expect(Object.fromEntries(new Headers(init.headers))).toEqual({ authorization: `Bearer ${OPTIONS.serviceCredential}`, "content-type": "application/json", "x-smartdeploy-binding-id": OPTIONS.bindingId });
		expect(JSON.parse(String(init.body))).toEqual({ ...GET, token: TOKEN });
		expect(init).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store" });
	});
	it.each([400, 401, 403, 404, 409, 410, 413, 415, 429, 503, 500, 302])("redacts upstream body and maps status %i", async status => {
		const { client } = fixture(new Response("secret backend detail", { status }));
		await expect(client.document(TOKEN, GET, new AbortController().signal)).rejects.toMatchObject({ status: [500, 302].includes(status) ? 503 : status, message: "App data operation unavailable." });
	});
	it.each([{ ...DOCUMENT, id: "other" }, { ...DOCUMENT, collection: "other" }, { ...DOCUMENT, json: "[]" },
		{ ...DOCUMENT, json: '{ "text": "saved" }' }, { ...DOCUMENT, json: "{}", extra: "unexpected" }, { ...DOCUMENT, version: "bad" }])("rejects invalid or wrong-address document reply", async document => {
		await expect(fixture(Response.json({ document })).client.document(TOKEN, GET, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
	});
	it("supports absent reads and explicit delete receipts, rejects absent/mismatched put results", async () => {
		expect(await fixture(Response.json({ document: null })).client.document(TOKEN, GET, new AbortController().signal)).toEqual({ document: null });
		expect(await fixture(Response.json({ deleted: true })).client.document(TOKEN, { ...GET, action: "remove", expectedVersion: DOCUMENT.version }, new AbortController().signal)).toEqual({ deleted: true });
		for (const document of [null, DOCUMENT, { ...DOCUMENT, json: "{}" }]) {
			await expect(fixture(Response.json({ document })).client.document(TOKEN, { ...GET, action: "put", json: DOCUMENT.json, expectedVersion: DOCUMENT.version }, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
		}
	});
	it("accepts a bounded document larger than the auth response cap", async () => {
		const document = { ...DOCUMENT, json: JSON.stringify({ text: "a".repeat(7000) }) };
		expect(await fixture(Response.json({ document })).client.document(TOKEN, GET, new AbortController().signal)).toEqual({ document });
	});
	it("rejects oversized actual responses, encoding errors, redirects and foreign response endpoints", async () => {
		const redirected = Response.json({ document: DOCUMENT }); Object.defineProperty(redirected, "redirected", { value: true });
		const foreign = Response.json({ document: DOCUMENT }); Object.defineProperty(foreign, "url", { value: "https://evil.test/api/gateway/documents" });
		for (const response of [redirected, foreign, new Response("x".repeat(32769), { headers: { "content-type": "application/json" } }),
			new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }), new Response("{}")]) {
			await expect(fixture(response).client.document(TOKEN, GET, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
		}
	});
	it("cancels a stalled response and rejects pre-aborted work before transport", async () => {
		vi.useFakeTimers(); let cancelled = false;
		const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
		const { client, transport } = fixture(new Response(stream, { headers: { "content-type": "application/json" } }));
		await expect(client.document(TOKEN, GET, AbortSignal.abort())).rejects.toMatchObject({ status: 503 }); expect(transport).not.toHaveBeenCalled();
		const result = expect(client.document(TOKEN, GET, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
		await vi.advanceTimersByTimeAsync(51); await result; expect(cancelled).toBe(true);
	});
	it("rejects invalid JSON and token before transport, with no mutation retries", async () => {
		const { client, transport } = fixture();
		await expect(client.document("bad", GET, new AbortController().signal)).rejects.toMatchObject({ status: 401 });
		await expect(client.document(TOKEN, { ...GET, action: "put", json: "[]", expectedVersion: null }, new AbortController().signal)).rejects.toMatchObject({ status: 400 });
		const expanded = '{"values":[' + Array(1000).fill("1e-6").join(",") + ']}';
		await expect(client.document(TOKEN, { ...GET, action: "put", json: expanded, expectedVersion: null }, new AbortController().signal)).rejects.toMatchObject({ status: 400 });
		expect(transport).not.toHaveBeenCalled(); transport.mockRejectedValueOnce(new Error(OPTIONS.serviceCredential));
		await expect(client.document(TOKEN, { ...GET, action: "put", json: "{}", expectedVersion: null }, new AbortController().signal)).rejects.toMatchObject({ status: 503, message: "App data operation unavailable." });
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("cancels late response bodies after an ignored transport deadline", async () => {
		vi.useFakeTimers(); const { client, transport } = fixture(); let finish = (_response: Response) => {};
		transport.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
		const result = expect(client.document(TOKEN, GET, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
		await vi.advanceTimersByTimeAsync(51); await result;
		let cancelled = false; const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
		finish(new Response(stream, { headers: { "content-type": "application/json" } })); await vi.advanceTimersByTimeAsync(1); expect(cancelled).toBe(true);
	});
});

describe("reserved browser document broker", () => {
	it("requires a distinct platform hostname and matching configured binding", () => {
		expect(() => new GatewayBrowserDocuments(CONTEXT, { ...OPTIONS, platformOrigin: CONTEXT.appOrigin })).toThrow();
		expect(() => new GatewayBrowserDocuments(CONTEXT, { ...OPTIONS, platformOrigin: "https://app.test:444" })).toThrow();
		expect(() => new GatewayBrowserDocuments(CONTEXT, { ...OPTIONS, bindingId: DOCUMENT.version })).toThrow();
	});
	it("uses only the HttpOnly session and never forwards browser credentials or scope headers", async () => {
		const { browser, transport } = fixture();
		const result = await browser.handle(request(GET, { authorization: "Bearer browser-secret", "x-smartdeploy-app-id": "other", "x-smartdeploy-binding-id": "forged" }));
		expect(result?.status).toBe(200); expect(await result?.json()).toEqual({ document: DOCUMENT });
		expect(result?.headers.get("cache-control")).toBe("private, no-store"); expect(result?.headers.has("access-control-allow-origin")).toBe(false);
		expect(JSON.parse(String(transport.mock.calls[0][1].body))).toEqual({ ...GET, token: TOKEN });
		expect(new Headers(transport.mock.calls[0][1].headers).has("cookie")).toBe(false);
	});
	it.each(FOREIGN_CONTEXTS)("rejects foreign browser contexts before machine access", async headers => {
		const { browser, transport } = fixture(); expect((await browser.handle(request(GET, headers)))?.status).toBe(403); expect(transport).not.toHaveBeenCalled();
	});
	it.each(["", `${GATEWAY_SESSION_COOKIE}=bad`, `${GATEWAY_SESSION_COOKIE}=${TOKEN}; ${GATEWAY_SESSION_COOKIE}=${TOKEN}`])("rejects missing/malformed/duplicate session cookies", async cookie => {
		const { browser, transport } = fixture(); expect((await browser.handle(request(GET, { cookie })))?.status).toBe(401); expect(transport).not.toHaveBeenCalled();
	});
	it.each(["token", "appId", "environment", "table", "userId", "bindingId"])("rejects caller %s override", async key => {
		const { browser, transport } = fixture(); expect((await browser.handle(request({ ...GET, [key]: "forged" })))?.status).toBe(400); expect(transport).not.toHaveBeenCalled();
	});
	it("rejects query/non-POST/encoded route variants without machine access", async () => {
		const { browser, transport } = fixture();
		expect((await browser.handle(request(GET, {}, "/__smartdeploy/documents?appId=other")))?.status).toBe(400);
		expect((await browser.handle(new Request(CONTEXT.appOrigin + "/__smartdeploy/documents")))?.status).toBe(400);
		for (const path of ["/%5f_smartdeploy/documents", "/__SMARTDEPLOY/documents", "/__smartdeploy/documents/", "/ordinary"]) expect(await browser.handle(request(GET, {}, path))).toBeNull();
		expect(transport).not.toHaveBeenCalled();
	});
	it("bounds actual streamed body bytes and requires uncompressed JSON", async () => {
		const { browser, transport } = fixture();
		expect((await browser.handle(request(GET, { "content-type": "text/plain" })))?.status).toBe(415);
		expect((await browser.handle(request(GET, { "content-encoding": "gzip" })))?.status).toBe(415);
		expect((await browser.handle(request("x".repeat(32769))))?.status).toBe(413);
		expect(transport).not.toHaveBeenCalled();
	});
	it("cancels a stalled body on deadline and retirement", async () => {
		vi.useFakeTimers();
		for (const retire of [false, true]) {
			let cancelled = false; const { browser, transport } = fixture();
			const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
			const input = new Request(request(), { body: stream, duplex: "half" } as RequestInit);
			const result = browser.handle(input); await vi.advanceTimersByTimeAsync(1);
			if (retire) browser.close(); else await vi.advanceTimersByTimeAsync(5001);
			expect((await result)?.status).toBe(503); expect(cancelled).toBe(true); expect(transport).not.toHaveBeenCalled();
		}
	});
	it("holds only two concurrent requests and cancels pending work on retirement", async () => {
		const { browser, transport } = fixture(); transport.mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })));
		const first = browser.handle(request()); const second = browser.handle(request());
		await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2)); expect((await browser.handle(request()))?.status).toBe(503);
		browser.close(); expect((await first)?.status).toBe(503); expect((await second)?.status).toBe(503); expect((await browser.handle(request()))?.status).toBe(503);
	});
});
