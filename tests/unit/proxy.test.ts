import { beforeEach, describe, expect, it, vi } from "vitest";

const getTokenMock = vi.fn();

vi.mock("next-auth/jwt", () => ({
	getToken: (...args: unknown[]) => getTokenMock(...args),
}));

describe("proxy approval guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.unstubAllEnvs();
		vi.stubEnv("SUPABASE_URL", "https://supabase.example.com");
		vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
		vi.stubEnv("NEXTAUTH_SECRET", "secret");
	});

	it("redirects removed users with a stale session to waiting-list", async () => {
		getTokenMock.mockResolvedValue({ email: "removed@example.com" });
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ([]),
		} as Response);

		const { proxy } = await import("@/proxy");
		const response = await proxy({
			nextUrl: new URL("http://localhost:3000/home"),
			url: "http://localhost:3000/home",
		} as never);

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("http://localhost:3000/waiting-list");
	});

	it("allows approved users to access protected pages", async () => {
		getTokenMock.mockResolvedValue({ email: "approved@example.com" });
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ([{ email: "approved@example.com" }]),
		} as Response);

		const { proxy } = await import("@/proxy");
		const response = await proxy({
			nextUrl: new URL("http://localhost:3000/home"),
			url: "http://localhost:3000/home",
		} as never);

		expect(response.status).toBe(200);
	});
});
