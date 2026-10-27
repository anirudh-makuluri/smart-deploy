import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ config: { WAITING_LIST_ENABLED: true }, approved: vi.fn(), query: vi.fn() }));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("@/db-helper", () => ({ dbHelper: { isApprovedUser: mocks.approved } }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: () => ({ query: mocks.query }) }));
import { requirePlatformAccess, requirePlatformSession, requirePlatformUser } from "@/lib/platformAccess";
import { authenticateCliAccessToken } from "@/lib/cliAuth";

const identity = { id: "actor", email: "actor@example.test", emailVerified: true };
beforeEach(() => {
	vi.resetAllMocks();
	mocks.config.WAITING_LIST_ENABLED = true;
	mocks.approved.mockResolvedValue({ approved: true });
	mocks.query.mockResolvedValue({ rows: [identity] });
});

describe("verified platform authority", () => {
	it("requires verification independently of approval and the waiting-list switch", async () => {
		await expect(requirePlatformAccess({ ...identity, emailVerified: false })).rejects.toMatchObject({ status: 403 });
		mocks.config.WAITING_LIST_ENABLED = false;
		await expect(requirePlatformAccess({ ...identity, emailVerified: false })).rejects.toMatchObject({ status: 403 });
		expect(mocks.approved).not.toHaveBeenCalled();
		await expect(requirePlatformAccess(identity)).resolves.toBeUndefined();
	});
	it("allows a verified approved identity and denies approval loss", async () => {
		await expect(requirePlatformAccess(identity)).resolves.toBeUndefined();
		mocks.approved.mockResolvedValue({ approved: false });
		await expect(requirePlatformAccess(identity)).rejects.toMatchObject({ status: 403 });
	});
	it("fails closed without exposing approval or database failures", async () => {
		mocks.approved.mockRejectedValueOnce(new Error("private-provider-details"));
		await expect(requirePlatformAccess(identity)).rejects.toMatchObject({ status: 503, message: "Platform authorization unavailable." });
		mocks.query.mockRejectedValueOnce(new Error("private-database-details"));
		await expect(requirePlatformUser("actor")).rejects.toMatchObject({ status: 503, message: "Platform authorization unavailable." });
	});
	it("rejects a missing current user or live session", async () => {
		mocks.query.mockResolvedValue({ rows: [] });
		await expect(requirePlatformUser("actor")).rejects.toMatchObject({ status: 401 });
		await expect(requirePlatformSession("actor", "deleted-session")).rejects.toMatchObject({ status: 401 });
	});
	it("checks the current database identity for CLI credentials", async () => {
		mocks.query.mockResolvedValueOnce({ rows: [{ user_id: "actor" }] }).mockResolvedValueOnce({ rows: [{ ...identity, emailVerified: false }] });
		await expect(authenticateCliAccessToken("sd_cli_local_test")).resolves.toBeNull();
	});
	it("allows an existing CLI token only while its current user remains verified and approved", async () => {
		mocks.query.mockResolvedValueOnce({ rows: [{ user_id: "actor" }] }).mockResolvedValueOnce({ rows: [identity] });
		await expect(authenticateCliAccessToken("sd_cli_local_test")).resolves.toBe("actor");
		mocks.query.mockResolvedValueOnce({ rows: [{ user_id: "actor" }] }).mockResolvedValueOnce({ rows: [identity] });
		mocks.approved.mockResolvedValue({ approved: false });
		await expect(authenticateCliAccessToken("sd_cli_local_test")).resolves.toBeNull();
	});
	it("does not turn backend failure into a successful CLI authentication", async () => {
		mocks.query.mockResolvedValueOnce({ rows: [{ user_id: "actor" }] }).mockRejectedValueOnce(new Error("private-database-details"));
		await expect(authenticateCliAccessToken("sd_cli_local_test")).rejects.toMatchObject({ status: 503 });
	});
});
