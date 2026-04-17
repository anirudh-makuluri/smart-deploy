import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const addToWaitingListMock = vi.fn();
const mockConfig = { WAITING_LIST_ENABLED: true };

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
