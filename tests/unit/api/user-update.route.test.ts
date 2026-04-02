import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSessionMock = vi.fn();
const updateUserMock = vi.fn();

vi.mock("next-auth", () => ({
	getServerSession: () => getServerSessionMock(),
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		updateUser: (...args: unknown[]) => updateUserMock(...args),
	},
}));

describe("PUT /api/user/update", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 when session user is missing", async () => {
		getServerSessionMock.mockResolvedValue(null);
		const { PUT } = await import("@/app/api/user/update/route");
		const res = await PUT(new Request("http://localhost", { method: "PUT", body: "{}" }) as any);
		expect(res.status).toBe(401);
	});

	it("returns 400 when update helper reports failure", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "u1" });
		updateUserMock.mockResolvedValue({ success: false, error: "invalid input" });
		const { PUT } = await import("@/app/api/user/update/route");
		const res = await PUT(
			new Request("http://localhost", { method: "PUT", body: JSON.stringify({ name: "" }) }) as any
		);
		expect(res.status).toBe(400);
	});

	it("returns success response when update helper succeeds", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "u1" });
		updateUserMock.mockResolvedValue({ success: true });
		const { PUT } = await import("@/app/api/user/update/route");
		const res = await PUT(
			new Request("http://localhost", { method: "PUT", body: JSON.stringify({ name: "Anirudh" }) }) as any
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ message: "Updated successfully" });
	});
});
