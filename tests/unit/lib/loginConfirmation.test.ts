import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ config: { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, WAITING_LIST_ENABLED: true,
	BETTER_AUTH_URL: "https://control.test", GATEWAY_CODE_TTL_SECONDS: "60", GATEWAY_SESSION_TTL_SECONDS: "900" },
	session: vi.fn(), inspect: vi.fn(), invited: vi.fn(), approved: vi.fn(), pool: vi.fn() }));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: mocks.pool }));
vi.mock("@/db-helper", () => ({ dbHelper: { isApprovedUser: mocks.approved } }));
vi.mock("@/lib/apps/gatewayAuthStore", () => ({ GatewayAuthStore: class { inspect = mocks.inspect; isInvitedMember = mocks.invited; } }));
import { loadAppLoginConfirmation } from "@/lib/apps/loginConfirmation";
import { BrowserHandoffInput, browserLoginPath } from "@/lib/apps/browserLogin";
import { WorkspaceError } from "@/lib/apps/workspaceStore";

const INPUT = { bindingId: "fa03e952-f705-42e2-9706-6a0b425de83d", challenge: "c".repeat(43), state: "s".repeat(43) };
const IDENTITY = { id: "verified-user", email: "current@example.test" };
const DETAILS = { bindingId: INPUT.bindingId, app: { id: "app", name: "Inventory" }, workspace: { id: "workspace", name: "Operations" },
	origin: "https://inventory.test", environment: "published", identity: IDENTITY };
const HEADERS = new Headers({ cookie: "opaque-platform-cookie" });
beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(mocks.config, { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, WAITING_LIST_ENABLED: true,
		BETTER_AUTH_URL: "https://control.test", GATEWAY_CODE_TTL_SECONDS: "60", GATEWAY_SESSION_TTL_SECONDS: "900" });
	mocks.session.mockResolvedValue({ user: { id: IDENTITY.id, email: "snapshot@example.test" }, session: { id: "current-session" } });
	mocks.inspect.mockResolvedValue(DETAILS);
	mocks.approved.mockResolvedValue({ approved: true });
	mocks.invited.mockResolvedValue(false);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("read-only app login confirmation preparation", () => {
	it("uses the current inspected identity and fixed session/binding without granting or minting", async () => {
		expect(await loadAppLoginConfirmation(INPUT, HEADERS)).toEqual({ status: "ready", request: INPUT, app: DETAILS });
		expect(mocks.session).toHaveBeenCalledWith({ headers: HEADERS, query: { disableCookieCache: true, disableRefresh: true } });
		expect(mocks.inspect).toHaveBeenCalledWith(INPUT.bindingId, { userId: IDENTITY.id, sessionId: "current-session" });
		expect(mocks.approved).toHaveBeenCalledWith(IDENTITY.email);
	});
	it("returns only a canonical local sign-in destination for anonymous users", async () => {
		mocks.session.mockResolvedValue(null);
		expect(await loadAppLoginConfirmation(INPUT, HEADERS)).toEqual({ status: "signin", callbackURL: browserLoginPath(INPUT) });
		expect([...new URL(browserLoginPath(INPUT), "https://control.test").searchParams.keys()].sort()).toEqual(["bindingId", "challenge", "state"]);
		expect(mocks.inspect).not.toHaveBeenCalled();
		expect(mocks.approved).not.toHaveBeenCalled();
	});
	it("checks both flags before reading authentication or metadata", async () => {
		for (const flag of ["WORKSPACE_APPS_ENABLED", "PRIVATE_APP_GATEWAY_ENABLED"] as const) {
			mocks.config[flag] = false;
			expect(await loadAppLoginConfirmation(INPUT, HEADERS)).toEqual({ status: "disabled" });
			mocks.config[flag] = true;
		}
		expect(mocks.session).not.toHaveBeenCalled();
	});
	it("rejects duplicate, missing, unknown and malformed public query fields before loading identity", async () => {
		const queries = [{ ...INPUT, state: [INPUT.state, INPUT.state] }, { ...INPUT, bindingId: "bad" }, { ...INPUT, challenge: "bad" },
			{ bindingId: INPUT.bindingId, challenge: INPUT.challenge }, { ...INPUT, callbackUrl: "https://evil.test" }, { ...INPUT, expectedIdentity: "other" }];
		for (const query of queries) expect(await loadAppLoginConfirmation(query, HEADERS)).toEqual({ status: "invalid" });
		expect(mocks.session).not.toHaveBeenCalled();
	});
	it("requires canonical secure platform configuration before authentication", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		for (const value of ["bad", "http://control.test", "https://control.test/", "https://user:pass@control.test", "https://control.test#x"]) {
			mocks.config.BETTER_AUTH_URL = value;
			expect(await loadAppLoginConfirmation(INPUT, HEADERS)).toEqual({ status: "unavailable" });
		}
		expect(mocks.session).not.toHaveBeenCalled();
	});
	it("retains only the ordinary invited-app exception and denies approval failures", async () => {
		mocks.approved.mockResolvedValue({ approved: false });
		expect(await loadAppLoginConfirmation(INPUT, HEADERS)).toEqual({ status: "denied" });
		mocks.invited.mockResolvedValueOnce(true);
		expect((await loadAppLoginConfirmation(INPUT, HEADERS)).status).toBe("ready");
		expect(mocks.invited).toHaveBeenCalledWith(INPUT.bindingId, IDENTITY.id);
		mocks.approved.mockResolvedValue({ approved: false, error: "unavailable" });
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await loadAppLoginConfirmation(INPUT, HEADERS)).toEqual({ status: "unavailable" });
	});
	it("redacts denied metadata and unexpected auth/storage failures", async () => {
		for (const status of [400, 401, 403, 404]) {
			mocks.inspect.mockRejectedValueOnce(new WorkspaceError(status, "private app details"));
			expect(await loadAppLoginConfirmation(INPUT, HEADERS)).toEqual({ status: "denied" });
		}
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.session.mockRejectedValueOnce(new Error("secret credentials"));
		expect(await loadAppLoginConfirmation(INPUT, HEADERS)).toEqual({ status: "unavailable" });
		expect(log).toHaveBeenCalledWith("App sign-in confirmation unavailable.");
	});
	it("requires strict displayed identity in issuance while keeping it out of public navigation", () => {
		expect(BrowserHandoffInput.safeParse(INPUT).success).toBe(false);
		expect(BrowserHandoffInput.parse({ ...INPUT, expectedIdentity: IDENTITY })).toEqual({ ...INPUT, expectedIdentity: IDENTITY });
		for (const expectedIdentity of [null, { id: "", email: IDENTITY.email }, { ...IDENTITY, role: "admin" }, { ...IDENTITY, email: "x\r\ny" }]) {
			expect(BrowserHandoffInput.safeParse({ ...INPUT, expectedIdentity }).success).toBe(false);
		}
		expect(() => browserLoginPath({ ...INPUT, state: "https://evil.test" })).toThrow();
	});
});
