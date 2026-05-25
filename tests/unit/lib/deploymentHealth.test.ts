import { describe, expect, it, vi } from "vitest";
import { verifyDeploymentUrlHealth } from "@/lib/deploymentHealth";

describe("verifyDeploymentUrlHealth", () => {
	it("returns healthy for a 200 response", async () => {
		const result = await verifyDeploymentUrlHealth("https://example.com", {
			dnsLookup: vi.fn().mockResolvedValue({ address: "93.184.216.34", family: 4 }),
			fetchImpl: vi.fn().mockResolvedValue(
				new Response("ok", { status: 200 })
			) as typeof fetch,
			now: () => new Date("2026-05-20T12:00:00.000Z"),
		});

		expect(result.status).toBe("healthy");
		expect(result.httpStatus).toBe(200);
		expect(result.failureType).toBeNull();
		expect(result.checkedAt).toBe("2026-05-20T12:00:00.000Z");
	});

	it("classifies 5xx as http_error", async () => {
		const result = await verifyDeploymentUrlHealth("https://example.com", {
			dnsLookup: vi.fn().mockResolvedValue({ address: "93.184.216.34", family: 4 }),
			fetchImpl: vi.fn().mockResolvedValue(
				new Response("bad gateway", { status: 502 })
			) as typeof fetch,
		});

		expect(result.status).toBe("http_error");
		expect(result.failureType).toBe("http_error");
		expect(result.httpStatus).toBe(502);
	});

	it("classifies DNS lookup failures as unreachable dns_failure", async () => {
		const result = await verifyDeploymentUrlHealth("https://missing.example.com", {
			dnsLookup: vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND missing.example.com")),
			fetchImpl: vi.fn() as typeof fetch,
		});

		expect(result.status).toBe("unreachable");
		expect(result.failureType).toBe("dns_failure");
	});

	it("classifies connection refused errors", async () => {
		const fetchError = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
			cause: { code: "ECONNREFUSED" },
		});
		const result = await verifyDeploymentUrlHealth("https://example.com", {
			dnsLookup: vi.fn().mockResolvedValue({ address: "93.184.216.34", family: 4 }),
			fetchImpl: vi.fn().mockRejectedValue(fetchError) as typeof fetch,
		});

		expect(result.status).toBe("unreachable");
		expect(result.failureType).toBe("connection_refused");
	});

	it("follows redirects until a healthy response arrives", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: { location: "/health" },
				})
			)
			.mockResolvedValueOnce(new Response("ok", { status: 200 })) as typeof fetch;

		const result = await verifyDeploymentUrlHealth("https://example.com", {
			dnsLookup: vi.fn().mockResolvedValue({ address: "93.184.216.34", family: 4 }),
			fetchImpl,
		});

		expect(result.status).toBe("healthy");
		expect(result.redirectCount).toBe(1);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("classifies redirect loops once the redirect limit is exceeded", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(null, {
				status: 302,
				headers: { location: "/again" },
			})
		) as typeof fetch;

		const result = await verifyDeploymentUrlHealth("https://example.com", {
			dnsLookup: vi.fn().mockResolvedValue({ address: "93.184.216.34", family: 4 }),
			fetchImpl,
			maxRedirects: 1,
		});

		expect(result.status).toBe("redirect_loop");
		expect(result.failureType).toBe("redirect_loop");
	});
});
