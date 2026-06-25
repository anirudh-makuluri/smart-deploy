import { beforeEach, describe, expect, it, vi } from "vitest";

const headersMock = vi.fn();
const getSessionMock = vi.fn();
const getDeploymentForUserMock = vi.fn();
const listRuntimeHealthSamplesMock = vi.fn();

vi.mock("next/headers", () => ({
	headers: () => headersMock(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getDeploymentForUser: (...args: unknown[]) => getDeploymentForUserMock(...args),
	},
}));

vi.mock("@/lib/runtimeHealthStore", () => ({
	listRuntimeHealthSamples: (...args: unknown[]) => listRuntimeHealthSamplesMock(...args),
}));

describe("GET /api/deployments/runtime-health", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		headersMock.mockResolvedValue(new Headers());
	});

	it("returns 401 when the session user is missing", async () => {
		getSessionMock.mockResolvedValue(null);
		const { GET } = await import("@/app/api/deployments/runtime-health/route");
		const req = { nextUrl: new URL("http://localhost/api/deployments/runtime-health?repoName=repo&serviceName=web") } as any;
		const res = await GET(req);

		expect(res.status).toBe(401);
	});

	it("returns 400 when repoName or serviceName is missing", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		const { GET } = await import("@/app/api/deployments/runtime-health/route");
		const req = { nextUrl: new URL("http://localhost/api/deployments/runtime-health?repoName=repo") } as any;
		const res = await GET(req);

		expect(res.status).toBe(400);
	});

	it("returns 404 when the deployment is not owned by the user", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		getDeploymentForUserMock.mockResolvedValue({ error: "missing" });
		const { GET } = await import("@/app/api/deployments/runtime-health/route");
		const req = { nextUrl: new URL("http://localhost/api/deployments/runtime-health?repoName=repo&serviceName=web") } as any;
		const res = await GET(req);

		expect(res.status).toBe(404);
	});

	it("returns runtime health entries for an owned deployment", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		getDeploymentForUserMock.mockResolvedValue({ deployment: { repoName: "repo", serviceName: "web" } });
		listRuntimeHealthSamplesMock.mockResolvedValue([
			{
				checkedAt: "2026-06-25T00:00:00.000Z",
				app: {
					checkedUrl: "https://example.com/health",
					httpStatus: 200,
					latencyMs: 100,
					probeResults: [true, true, true],
					overallStatus: "healthy",
				},
				ecs: null,
				alb: null,
			},
		]);

		const { GET } = await import("@/app/api/deployments/runtime-health/route");
		const req = { nextUrl: new URL("http://localhost/api/deployments/runtime-health?repoName=repo&serviceName=web") } as any;
		const res = await GET(req);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			entries: [
				{
					checkedAt: "2026-06-25T00:00:00.000Z",
					app: {
						checkedUrl: "https://example.com/health",
						httpStatus: 200,
						latencyMs: 100,
						probeResults: [true, true, true],
						overallStatus: "healthy",
					},
					ecs: null,
					alb: null,
				},
			],
		});
	});
});
