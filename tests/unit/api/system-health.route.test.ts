import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSessionMock = vi.fn();
const createWebSocketAuthTokenMock = vi.fn();

vi.mock("next-auth", () => ({
	getServerSession: (...args: unknown[]) => getServerSessionMock(...args),
}));

vi.mock("@/lib/wsAuth", () => ({
	createWebSocketAuthToken: (...args: unknown[]) => createWebSocketAuthTokenMock(...args),
}));

describe("GET /api/system-health", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.unstubAllEnvs();
		createWebSocketAuthTokenMock.mockReturnValue("ws-token");
	});

	it("returns 401 when the user is not authenticated", async () => {
		getServerSessionMock.mockResolvedValue(null);
		const { GET } = await import("@/app/api/system-health/route");

		const response = await GET();

		expect(response.status).toBe(401);
	});

	it("returns healthy when websocket and SD Artifacts checks succeed", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "user-123" });
		vi.stubEnv("NEXT_PUBLIC_WS_URL", "wss://ws.example.com/ws");
		vi.stubEnv("SD_API_BASE_URL", "https://artifacts.example.com");
		vi.stubEnv("SD_API_BEARER_TOKEN", "artifact-token");

		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes("ws.example.com/healthz")) {
				return {
					ok: true,
					json: async () => ({ ok: true }),
				} as Response;
			}

			if (url.includes("artifacts.example.com/healthz")) {
				return {
					ok: true,
					json: async () => ({ status: "healthy" }),
				} as Response;
			}

			throw new Error(`Unexpected fetch: ${url}`);
		});

		const { GET } = await import("@/app/api/system-health/route");
		const response = await GET();
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.status).toBe("healthy");
		expect(body.services).toEqual([
			{
				name: "WebSocket server",
				status: "healthy",
				message: "Authenticated worker health check passed",
			},
			{
				name: "SD Artifacts server",
				status: "healthy",
				message: "Authenticated SD Artifacts health check passed",
			},
		]);
	});

	it("returns degraded when SD Artifacts env is missing", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "user-123" });
		vi.stubEnv("NEXT_PUBLIC_WS_URL", "wss://ws.example.com/ws");

		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ ok: true }),
		} as Response);

		const { GET } = await import("@/app/api/system-health/route");
		const response = await GET();
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.status).toBe("degraded");
		expect(body.services[1]).toEqual({
			name: "SD Artifacts server",
			status: "unavailable",
			message: "SD_API_BASE_URL or SD_API_BEARER_TOKEN is not configured",
		});
	});

	it("treats successful healthz responses as healthy even with minimal payloads", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "user-123" });
		vi.stubEnv("NEXT_PUBLIC_WS_URL", "wss://ws.example.com/ws");
		vi.stubEnv("SD_API_BASE_URL", "https://artifacts.example.com");
		vi.stubEnv("SD_API_BEARER_TOKEN", "artifact-token");

		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({}),
		} as Response);

		const { GET } = await import("@/app/api/system-health/route");
		const response = await GET();
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.status).toBe("healthy");
		expect(body.services).toEqual([
			{
				name: "WebSocket server",
				status: "healthy",
				message: "Authenticated worker health check passed",
			},
			{
				name: "SD Artifacts server",
				status: "healthy",
				message: "Authenticated SD Artifacts health check passed",
			},
		]);
	});
});
