import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

describe("DELETE /api/cache", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 when session token is missing", async () => {
		getSessionMock.mockResolvedValue(null);
		const { DELETE } = await import("@/app/api/cache/route");

		const res = await DELETE(
			new Request("http://localhost/api/cache", {
				method: "DELETE",
				body: JSON.stringify({ response_id: "r-1" }),
			})
		);

		expect(res.status).toBe(401);
	});

	it("returns 400 for invalid JSON", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		const { DELETE } = await import("@/app/api/cache/route");

		const req = { json: vi.fn().mockRejectedValue(new Error("bad json")) } as unknown as Request;
		const res = await DELETE(req);
		expect(res.status).toBe(400);
	});

	it("returns 400 when response_id is missing", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		const { DELETE } = await import("@/app/api/cache/route");
		const res = await DELETE(
			new Request("http://localhost/api/cache", {
				method: "DELETE",
				body: JSON.stringify({}),
			})
		);

		expect(res.status).toBe(400);
	});

	it("proxies delete and returns json body when successful", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ deleted: true }),
		} as Response);

		const { DELETE } = await import("@/app/api/cache/route");
		const res = await DELETE(
			new Request("http://localhost/api/cache", {
				method: "DELETE",
				body: JSON.stringify({ response_id: "r-1" }),
			})
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ deleted: true });
	});

	it("returns 502 when proxy request fails", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => "boom",
		} as Response);

		const { DELETE } = await import("@/app/api/cache/route");
		const res = await DELETE(
			new Request("http://localhost/api/cache", {
				method: "DELETE",
				body: JSON.stringify({ response_id: "r-1" }),
			})
		);

		expect(res.status).toBe(502);
	});
});
