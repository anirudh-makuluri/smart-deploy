import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSessionMock = vi.fn();
const getUserRepoServicesMock = vi.fn();

vi.mock("next-auth", () => ({
	getServerSession: () => getServerSessionMock(),
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getUserRepoServices: (...args: unknown[]) => getUserRepoServicesMock(...args),
	},
}));

describe("GET /api/repos/services", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 for missing user", async () => {
		getServerSessionMock.mockResolvedValue(null);
		const { GET } = await import("@/app/api/repos/services/route");
		const res = await GET();
		expect(res.status).toBe(401);
	});

	it("returns 500 when helper returns error", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "u1" });
		getUserRepoServicesMock.mockResolvedValue({ error: "bad db" });
		const { GET } = await import("@/app/api/repos/services/route");
		const res = await GET();
		expect(res.status).toBe(500);
	});

	it("returns services on success", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "u1" });
		getUserRepoServicesMock.mockResolvedValue({ records: [{ repo: "acme/repo" }] });
		const { GET } = await import("@/app/api/repos/services/route");
		const res = await GET();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ services: [{ repo: "acme/repo" }] });
	});
});
