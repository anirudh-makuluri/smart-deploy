import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const addToWaitingListMock = vi.fn();
const mockConfig = { WAITING_LIST_ENABLED: true, WORKSPACE_APPS_ENABLED: false, PRIVATE_APP_GATEWAY_ENABLED: false };

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

vi.mock("@/config", () => ({
	default: mockConfig,
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		addToWaitingList: (...args: unknown[]) => addToWaitingListMock(...args),
	},
}));

describe("proxy approval guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.unstubAllEnvs();
		mockConfig.WAITING_LIST_ENABLED = true;
		mockConfig.WORKSPACE_APPS_ENABLED = false;
		mockConfig.PRIVATE_APP_GATEWAY_ENABLED = false;
		vi.stubEnv("SUPABASE_URL", "https://supabase.example.com");
		vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
	});

	it("adds denied users to the waiting list when enabled", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1", email: "removed@example.com", name: "Removed User" } });
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ([]),
		} as Response);

		const { proxy } = await import("@/proxy");
		const response = await proxy({
			nextUrl: new URL("http://localhost:3000/home"),
			url: "http://localhost:3000/home",
		} as never);

		expect(addToWaitingListMock).toHaveBeenCalledWith("removed@example.com", "Removed User");
		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("http://localhost:3000/waiting-list");
		const expiredCookies = response.cookies.getAll();
		expect(expiredCookies).toHaveLength(4);
		for (const cookie of expiredCookies) {
			expect(cookie.name).toMatch(/^__Host-smartdeploy\./);
			expect(cookie).toMatchObject({ secure: true, httpOnly: true, path: "/", sameSite: "lax", maxAge: 0 });
			expect(cookie.domain).toBeUndefined();
		}
	});

	it("retains the login for private-app use while continuing to deny the platform home", async () => {
		mockConfig.WORKSPACE_APPS_ENABLED = true;
		mockConfig.PRIVATE_APP_GATEWAY_ENABLED = true;
		getSessionMock.mockResolvedValue({ user: { id: "u1", email: "invitee@example.com" } });
		vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json([]));
		const { proxy } = await import("@/proxy");
		const response = await proxy({ nextUrl: new URL("https://control.test/home"), url: "https://control.test/home" } as never);
		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("https://control.test/waiting-list");
		expect(response.headers.get("set-cookie")).toBeNull();
	});

	it("skips approved-user checks when waiting list is disabled", async () => {
		mockConfig.WAITING_LIST_ENABLED = false;
		getSessionMock.mockResolvedValue({ user: { id: "u1", email: "removed@example.com" } });
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch should not be called"));

		const { proxy } = await import("@/proxy");
		const response = await proxy({
			nextUrl: new URL("http://localhost:3000/home"),
			url: "http://localhost:3000/home",
		} as never);

		expect(response.status).toBe(200);
	});

	it("redirects authenticated users away from the landing page before render", async () => {
		mockConfig.WAITING_LIST_ENABLED = false;
		getSessionMock.mockResolvedValue({ user: { id: "u1", email: "approved@example.com" } });
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch should not be called"));

		const { proxy } = await import("@/proxy");
		const response = await proxy({
			nextUrl: new URL("http://localhost:3000/"),
			url: "http://localhost:3000/",
			headers: new Headers(),
			cookies: {
				has: () => true,
			},
		} as never);

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("http://localhost:3000/home");
	});

	it("allows approved users to access protected pages", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1", email: "approved@example.com" } });
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
