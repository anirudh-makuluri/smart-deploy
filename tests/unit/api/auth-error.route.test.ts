import { describe, expect, it, vi } from "vitest";

describe("GET /api/auth/error", () => {
	it("uses BETTER_AUTH_URL when configured", async () => {
		vi.resetModules();
		vi.doMock("@/config", () => ({
			default: { BETTER_AUTH_URL: "https://smartdeploy.example.com" },
		}));

		const { GET } = await import("@/app/api/auth/error/route");
		const req = {
			headers: new Headers({ host: "local.test:3000", "x-forwarded-proto": "http" }),
			nextUrl: new URL("http://local.test:3000/api/auth/error"),
		} as any;
		const res = await GET(req);

		expect(res.status).toBe(307);
		expect(res.headers.get("location")).toBe("https://smartdeploy.example.com/waiting-list");
	});

	it("falls back to forwarded host/protocol", async () => {
		vi.resetModules();
		vi.doMock("@/config", () => ({
			default: { BETTER_AUTH_URL: "http://localhost:3000" },
		}));

		const { GET } = await import("@/app/api/auth/error/route");
		const req = {
			headers: new Headers({ "x-forwarded-host": "prod.example.com", "x-forwarded-proto": "https" }),
			nextUrl: new URL("http://local.test:3000/api/auth/error"),
		} as any;
		const res = await GET(req);

		expect(res.headers.get("location")).toBe("https://prod.example.com/waiting-list");
	});
});
