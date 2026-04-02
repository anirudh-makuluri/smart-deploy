import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSessionMock = vi.fn();
const getUserDeploymentsMock = vi.fn();

vi.mock("next-auth", () => ({
	getServerSession: () => getServerSessionMock(),
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getUserDeployments: (...args: unknown[]) => getUserDeploymentsMock(...args),
	},
}));

describe("GET /api/get-deployments", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 when user is missing", async () => {
		getServerSessionMock.mockResolvedValue({});
		const { GET } = await import("@/app/api/get-deployments/route");
		const res = await GET({} as any);
		expect(res.status).toBe(401);
	});

	it("returns deployments on success", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "u1" });
		getUserDeploymentsMock.mockResolvedValue({ deployments: [{ id: "d1" }] });

		const { GET } = await import("@/app/api/get-deployments/route");
		const res = await GET({} as any);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.status).toBe("success");
		expect(body.deployments).toEqual([{ id: "d1" }]);
	});

	it("returns error payload when db helper reports error", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "u1" });
		getUserDeploymentsMock.mockResolvedValue({ error: "db error" });

		const { GET } = await import("@/app/api/get-deployments/route");
		const res = await GET({} as any);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.status).toBe("error");
		expect(body.message).toBe("db error");
	});
});
