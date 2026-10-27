import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST, OPTIONS } from "@/app/ph/[...path]/route";

const context = { params: Promise.resolve({ path: ["e"] }) };

afterEach(() => vi.restoreAllMocks());

describe("analytics proxy credential boundary", () => {
	it("delivers upstream headers and initial bytes before the stream finishes, and propagates cancellation", async () => {
		const cancel = vi.fn();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) { controller.enqueue(new TextEncoder().encode("first chunk")); },
			cancel,
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 503, headers: { "Retry-After": "5" } }));
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			const response = await Promise.race([
				GET(new NextRequest("https://control.test/ph/e"), context),
				new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Proxy waited for upstream EOF")), 1000); }),
			]);
			expect(response.status).toBe(503);
			expect(response.headers.get("retry-after")).toBe("5");
			const reader = response.body!.getReader();
			expect(new TextDecoder().decode((await reader.read()).value)).toBe("first chunk");
			await reader.cancel("client closed");
			expect(cancel).toHaveBeenCalledWith("client closed");
		} finally {
			clearTimeout(timeout);
			if (!stream.locked) await stream.cancel();
		}
	});

	it("forwards the project-token payload without platform cookies, bearer tokens, or private headers", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
		const body = JSON.stringify({ api_key: "phc_local_test_only", event: "test" });
		const request = new NextRequest("https://control.test/ph/e?ip=1", { method: "POST", body, headers: {
			"Content-Type": "application/json", "Content-Encoding": "gzip", "Accept": "application/json",
			"Accept-Language": "en-US", "User-Agent": "Local proxy regression test",
			Cookie: "better-auth.session_token=local-test-only", Authorization: "Bearer local-test-only",
			"Proxy-Authorization": "Basic local-test-only", "X-Forwarded-For": "192.0.2.1",
			"X-SmartDeploy-User-Id": "private-user", Referer: "https://control.test/private?code=test-only",
		} });
		expect((await POST(request, context)).status).toBe(200);
		const [url, options] = fetchMock.mock.calls[0]!;
		expect(String(url)).toBe("https://us.i.posthog.com/e?ip=1");
		const headers = new Headers(options?.headers);
		expect([...headers.keys()].sort()).toEqual(["accept", "accept-language", "content-encoding", "content-type", "user-agent"]);
		expect(new TextDecoder().decode(options?.body as ArrayBuffer)).toBe(body);
		expect(options?.credentials).toBe("omit");
	});

	it("prevents upstream cookie and site-data control headers from changing SmartDeploy's session", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("upstream failure", { status: 429, headers: {
			"Set-Cookie": "better-auth.session_token=injected-test-only; Path=/; Secure; HttpOnly",
			"Clear-Site-Data": '"cookies"', "Content-Type": "text/plain", "Retry-After": "30",
		} }));
		const response = await GET(new NextRequest("https://control.test/ph/e"), context);
		expect(response.status).toBe(429);
		expect(await response.text()).toBe("upstream failure");
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(response.headers.get("clear-site-data")).toBeNull();
		expect(response.headers.get("retry-after")).toBe("30");
	});

	it("removes connection-nominated headers in both directions and decoded-body metadata", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("decoded", { headers: {
			Connection: "X-Internal-Only", "X-Internal-Only": "private", "Keep-Alive": "timeout=5",
			"Content-Encoding": "gzip", "Content-Length": "100", "WWW-Authenticate": 'Basic realm="unrelated"',
			"Access-Control-Allow-Credentials": "true",
		} }));
		const response = await GET(new NextRequest("https://control.test/ph/e", { headers: { Connection: "Accept-Language", "Accept-Language": "en-US" } }), context);
		expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("accept-language")).toBe(false);
		for (const name of ["connection", "x-internal-only", "keep-alive", "content-encoding", "content-length", "www-authenticate", "access-control-allow-credentials"]) {
			expect(response.headers.has(name)).toBe(false);
		}
		expect(await response.text()).toBe("decoded");
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it.each([204, 205, 304])("preserves bodyless upstream status %s without manufacturing a response body", async (status) => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
		const response = await GET(new NextRequest("https://control.test/ph/e"), context);
		expect(response.status).toBe(status);
		expect(response.body).toBeNull();
		expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
	});

	it("keeps preflight independent of auth and does not authorize forwarding credentials", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch");
		const response = await OPTIONS();
		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-headers")).not.toContain("authorization");
		expect(response.headers.get("access-control-allow-credentials")).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
