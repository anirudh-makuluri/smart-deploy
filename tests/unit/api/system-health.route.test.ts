import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

describe("GET /api/system-health", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.unstubAllEnvs();
	});

	it("returns 401 when the user is not authenticated", async () => {
		getSessionMock.mockResolvedValue(null);
		const { GET } = await import("@/app/api/system-health/route");

		const response = await GET();

		expect(response.status).toBe(401);
	});

	it("returns healthy when SD Artifacts check succeeds", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "user-123" } });
		vi.stubEnv("SD_API_BASE_URL", "https://artifacts.example.com");
		vi.stubEnv("SD_API_BEARER_TOKEN", "artifact-token");

		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
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
				name: "SD Artifacts server",
				status: "healthy",
				message: "Authenticated SD Artifacts health check passed",
			},
		]);
	});

	it("returns degraded when SD Artifacts env is missing", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "user-123" } });

		const { GET } = await import("@/app/api/system-health/route");
		const response = await GET();
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.status).toBe("degraded");
		expect(body.services[0]).toEqual({
			name: "SD Artifacts server",
			status: "unavailable",
			message: "SD_API_BASE_URL or SD_API_BEARER_TOKEN is not configured",
		});
	});

	it("treats minimal SD Artifacts payloads as healthy", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "user-123" } });
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
				name: "SD Artifacts server",
				status: "healthy",
				message: "Authenticated SD Artifacts health check passed",
			},
		]);
	});
});
