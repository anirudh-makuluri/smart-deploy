import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ config: { WAITING_LIST_ENABLED: true }, session: vi.fn(), approved: vi.fn() }));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/db-helper", () => ({ dbHelper: { isApprovedUser: mocks.approved } }));
import { GET } from "@/app/api/ws-token/route";
import { verifyWebSocketAuthToken } from "@/lib/wsAuth";

const principal = { user: { id: "actor", email: "actor@example.test", emailVerified: true }, session: { id: "current-platform-session" } };
beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv("BETTER_AUTH_SECRET", "local-credential-test-only-secret");
	mocks.config.WAITING_LIST_ENABLED = true;
	mocks.session.mockResolvedValue(principal);
	mocks.approved.mockResolvedValue({ approved: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("platform-session-bound worker credentials", () => {
	it("issues a non-cacheable signed credential from a fresh verified principal", async () => {
		const request = new Request("https://control.test/api/ws-token");
		const response = await GET(request);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const body = await response.json() as { token: string };
		expect(verifyWebSocketAuthToken(body.token)).toMatchObject({ userID: "actor", sessionID: "current-platform-session" });
		expect(mocks.session).toHaveBeenCalledWith({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } });
	});
	it("denies unverified accounts even when waiting-list approval is disabled", async () => {
		mocks.config.WAITING_LIST_ENABLED = false;
		mocks.session.mockResolvedValue({ ...principal, user: { ...principal.user, emailVerified: false } });
		expect((await GET(new Request("https://control.test/api/ws-token"))).status).toBe(403);
	});
	it("requires an authenticated live-session identifier", async () => {
		mocks.session.mockResolvedValueOnce(null).mockResolvedValueOnce({ user: principal.user });
		expect((await GET(new Request("https://control.test/api/ws-token"))).status).toBe(401);
		expect((await GET(new Request("https://control.test/api/ws-token"))).status).toBe(401);
	});
	it("returns a retryable failure on unavailable session storage", async () => {
		mocks.session.mockRejectedValue(new Error("private-database-details"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		const response = await GET(new Request("https://control.test/api/ws-token"));
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("private-database-details");
	});
});
