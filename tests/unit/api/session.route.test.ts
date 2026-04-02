import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSessionMock = vi.fn();
const ensureUserAndReposMock = vi.fn();

vi.mock("next-auth", () => ({
	getServerSession: () => getServerSessionMock(),
}));

vi.mock("@/lib/sessionHelpers", () => ({
	ensureUserAndRepos: (...args: unknown[]) => ensureUserAndReposMock(...args),
}));

describe("GET /api/session", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 when auth details are missing", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "u1" });
		const { GET } = await import("@/app/api/session/route");
		const req = { nextUrl: new URL("http://localhost/api/session") } as any;
		const res = await GET(req);
		expect(res.status).toBe(401);
	});

	it("sorts repos by latest commit and applies numeric limit", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "u1", accessToken: "token" });
		ensureUserAndReposMock.mockResolvedValue({
			repoList: [
				{ name: "older", latest_commit: { date: "2024-01-01T00:00:00.000Z" } },
				{ name: "newer", latest_commit: { date: "2025-01-01T00:00:00.000Z" } },
			],
		});

		const { GET } = await import("@/app/api/session/route");
		const req = { nextUrl: new URL("http://localhost/api/session?limit=1") } as any;
		const res = await GET(req);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.repoList).toHaveLength(1);
		expect(body.repoList[0].name).toBe("newer");
	});

	it("returns 500 when syncing throws", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "u1", accessToken: "token" });
		ensureUserAndReposMock.mockRejectedValue(new Error("sync failed"));

		const { GET } = await import("@/app/api/session/route");
		const req = { nextUrl: new URL("http://localhost/api/session") } as any;
		const res = await GET(req);
		expect(res.status).toBe(500);
	});
});
