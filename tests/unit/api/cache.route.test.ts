import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSessionMock = vi.fn();

vi.mock("next-auth", () => ({
	getServerSession: (...args: unknown[]) => getServerSessionMock(...args),
}));

describe("DELETE /api/cache", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 when session token is missing", async () => {
		getServerSessionMock.mockResolvedValue(null);
		const { DELETE } = await import("@/app/api/cache/route");

		const res = await DELETE(
			new Request("http://localhost/api/cache", {
				method: "DELETE",
				body: JSON.stringify({ repo_url: "https://github.com/acme/repo" }),
			})
		);

		expect(res.status).toBe(401);
	});

	it("returns 400 for invalid JSON", async () => {
		getServerSessionMock.mockResolvedValue({ accessToken: "t" });
		const { DELETE } = await import("@/app/api/cache/route");

		const req = { json: vi.fn().mockRejectedValue(new Error("bad json")) } as unknown as Request;
		const res = await DELETE(req);
		expect(res.status).toBe(400);
	});

	it("returns 400 when repo_url is missing", async () => {
		getServerSessionMock.mockResolvedValue({ accessToken: "t" });
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
		getServerSessionMock.mockResolvedValue({ accessToken: "t" });
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ deleted: true }),
		} as Response);

		const { DELETE } = await import("@/app/api/cache/route");
		const res = await DELETE(
			new Request("http://localhost/api/cache", {
				method: "DELETE",
				body: JSON.stringify({ repo_url: "https://github.com/acme/repo", commit_sha: "abc123" }),
			})
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ deleted: true });
	});

	it("returns 502 when proxy request fails", async () => {
		getServerSessionMock.mockResolvedValue({ accessToken: "t" });
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => "boom",
		} as Response);

		const { DELETE } = await import("@/app/api/cache/route");
		const res = await DELETE(
			new Request("http://localhost/api/cache", {
				method: "DELETE",
				body: JSON.stringify({ repo_url: "https://github.com/acme/repo" }),
			})
		);

		expect(res.status).toBe(502);
	});
});
