import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	config: { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true },
	post: vi.fn(), get: vi.fn(), getSession: vi.fn(), query: vi.fn(), pool: vi.fn(), connect: vi.fn(), release: vi.fn(),
}));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: () => ({ POST: mocks.post, GET: mocks.get }) }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: mocks.pool }));
import { POST, GET } from "@/app/api/auth/[...all]/route";

function request(path = "sign-out") { return new Request(`https://control.test/api/auth/${path}`, { method: "POST", headers: { origin: "https://control.test" } }); }
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(mocks.config, { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true });
	mocks.pool.mockReturnValue({ query: mocks.query, connect: mocks.connect });
	mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
	mocks.getSession.mockResolvedValue({ session: { id: "platform-login" }, user: { id: "alice" } });
	mocks.post.mockResolvedValue(new Response("{}", { headers: { "set-cookie": "session=; Max-Age=0" } }));
	mocks.query.mockReset().mockResolvedValueOnce({ rows: [{ ready: true }] }).mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("verified global app logout", () => {
	it("keeps existing auth behavior when disabled or handling another endpoint", async () => {
		mocks.config.PRIVATE_APP_GATEWAY_ENABLED = false;
		expect((await POST(request())).status).toBe(200);
		mocks.config.PRIVATE_APP_GATEWAY_ENABLED = true;
		expect((await POST(request("sign-in/email"))).status).toBe(200);
		expect(GET).toBe(mocks.get);
		expect(mocks.getSession).not.toHaveBeenCalled();
	});

	it("loads uncached identity without refreshing and commits all revocation before clearing cookies", async () => {
		const req = request();
		const response = await POST(req);
		expect(response.status).toBe(200);
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(mocks.getSession).toHaveBeenCalledWith({ headers: req.headers, query: { disableCookieCache: true, disableRefresh: true } });
		expect(mocks.query).toHaveBeenCalledWith('delete from public.session where id = $1 and "userId" = $2', ["platform-login", "alice"]);
		expect(mocks.query).toHaveBeenCalledWith("delete from public.app_gateway_sessions where user_id = $1", ["alice"]);
		expect(mocks.query).toHaveBeenLastCalledWith("commit");
		expect(mocks.post.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.query.mock.invocationCallOrder.at(-1)!);
	});

	it("does not invoke cookie clearing when transactional revocation fails", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.query.mockReset().mockImplementation(async (sql: string) => {
			if (sql.startsWith("delete from public.app_gateway_sessions")) throw new Error("Database write failed.");
			return { rows: [{ ready: true }] };
		});
		const response = await POST(request());
		expect(response.status).toBe(503);
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mocks.post).not.toHaveBeenCalled();
		expect(mocks.query).toHaveBeenCalledWith("rollback");
		vi.restoreAllMocks();
	});

	it("fails before mutation when the required migration is missing or disabled", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.query.mockReset().mockResolvedValue({ rows: [{ ready: false }] });
		expect((await POST(request())).status).toBe(503);
		expect(mocks.post).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});

	it("rejects cross-origin and missing-origin requests before reading or mutating sessions", async () => {
		for (const origin of ["https://attacker.test", ""]) {
			const req = new Request("https://control.test/api/auth/sign-out", { method: "POST", headers: origin ? { origin } : {} });
			expect((await POST(req)).status).toBe(403);
		}
		expect(mocks.getSession).not.toHaveBeenCalled();
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it("delegates unauthenticated logout and cannot select another user's apps", async () => {
		mocks.getSession.mockResolvedValueOnce(null);
		expect((await POST(request())).status).toBe(200);
		expect(mocks.pool).not.toHaveBeenCalled();
	});
});
