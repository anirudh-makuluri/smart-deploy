import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	config: { WORKSPACE_APPS_ENABLED: true, WAITING_LIST_ENABLED: false },
	getSession: vi.fn(), approved: vi.fn(), pool: vi.fn(),
	create: vi.fn(), list: vi.fn(), invite: vi.fn(), accept: vi.fn(), members: vi.fn(), remove: vi.fn(), invitations: vi.fn(), revoke: vi.fn(), setRole: vi.fn(),
}));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/db-helper", () => ({ dbHelper: { isApprovedUser: mocks.approved } }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: mocks.pool }));
vi.mock("@/lib/apps/workspaceStore", async (original) => {
	const actual = await original<typeof import("@/lib/apps/workspaceStore")>();
	return { ...actual, WorkspaceStore: class {
		createWorkspace = mocks.create;
		listWorkspaces = mocks.list;
		createInvitation = mocks.invite;
		acceptInvitation = mocks.accept;
		listMembers = mocks.members;
		removeMember = mocks.remove;
		setMemberRole = mocks.setRole;
		listInvitations = mocks.invitations;
		revokeInvitation = mocks.revoke;
	} };
});

import { GET, POST } from "@/app/api/workspaces/route";
import { POST as invite } from "@/app/api/workspaces/[workspaceId]/invitations/route";
import { DELETE as remove, PATCH as setRole } from "@/app/api/workspaces/[workspaceId]/members/route";
import { DELETE as revoke } from "@/app/api/workspaces/[workspaceId]/invitations/[invitationId]/route";
import { POST as accept } from "@/app/api/workspace-invitations/accept/route";
import { WorkspaceError } from "@/lib/apps/workspaceStore";

const context = { params: Promise.resolve({ workspaceId: "workspace-a" }) };
function request(path: string, body: unknown, origin = "https://smartdeploy.test", method = "POST") {
	return new Request(`https://smartdeploy.test/api/${path}`, {
		method, headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.config.WORKSPACE_APPS_ENABLED = true;
	mocks.config.WAITING_LIST_ENABLED = false;
	mocks.getSession.mockResolvedValue({ user: { id: "actor", email: "actor@example.test" } });
	mocks.approved.mockResolvedValue({ approved: true });
	mocks.create.mockResolvedValue({ id: "new", ownerId: "actor", name: "Team", kind: "team" });
	mocks.list.mockResolvedValue([]);
	mocks.invite.mockResolvedValue({ id: "invite", token: "s".repeat(43) });
	mocks.accept.mockResolvedValue({ workspace: { id: "workspace-a" }, role: "member" });
});

describe("workspace browser APIs", () => {
	it("fails closed without touching the database when disabled", async () => {
		mocks.config.WORKSPACE_APPS_ENABLED = false;
		expect((await POST(request("workspaces", { name: "Team" }))).status).toBe(503);
		expect(mocks.pool).not.toHaveBeenCalled();
	});

	it("requires a browser session", async () => {
		mocks.getSession.mockResolvedValue(null);
		expect((await GET(new Request("https://smartdeploy.test/api/workspaces"))).status).toBe(401);
		expect(mocks.list).not.toHaveBeenCalled();
	});

	it.each(["https://attacker.test", "null", ""])("rejects mutation origin %s", async (origin) => {
		expect((await POST(request("workspaces", { name: "Team" }, origin))).status).toBe(403);
		expect(mocks.create).not.toHaveBeenCalled();
	});

	it("enforces the platform approval gate independently of page middleware", async () => {
		mocks.config.WAITING_LIST_ENABLED = true;
		mocks.approved.mockResolvedValue({ approved: false });
		expect((await POST(request("workspaces", { name: "Team" }))).status).toBe(403);
		expect(mocks.pool).not.toHaveBeenCalled();
	});

	it("derives the owner from the session and disables caching", async () => {
		const response = await POST(request("workspaces", { name: " Team " }));
		expect(response.status).toBe(201);
		expect(mocks.create).toHaveBeenCalledWith("actor", "Team");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	});

	it("rejects caller-supplied ownership, invalid roles, and malformed JSON", async () => {
		expect((await POST(request("workspaces", { name: "Team", ownerId: "victim" }))).status).toBe(400);
		expect((await invite(request("workspaces/x/invitations", { email: "friend@example.test", role: "owner" }), context)).status).toBe(400);
		const malformed = new Request("https://smartdeploy.test/api/workspaces", { method: "POST", headers: { origin: "https://smartdeploy.test" }, body: "{" });
		expect((await POST(malformed)).status).toBe(400);
	});

	it("passes only the authenticated actor and requested invitation scope", async () => {
		const response = await invite(request("workspaces/x/invitations", { email: "friend@example.test", role: "member" }), context);
		expect(response.status).toBe(201);
		expect(mocks.invite).toHaveBeenCalledWith("workspace-a", "actor", "friend@example.test", "member");
	});

	it("accepts tokens only in a POST body and uses the session identity", async () => {
		expect((await accept(request("workspace-invitations/accept", { token: "s".repeat(43) }))).status).toBe(200);
		expect(mocks.accept).toHaveBeenCalledWith("actor", "s".repeat(43));
		expect((await accept(request("workspace-invitations/accept", { token: "s".repeat(43), userId: "victim" }))).status).toBe(400);
	});

	it("scopes removal and revocation to the authenticated actor", async () => {
		expect((await remove(request("workspaces/x/members", { userId: "member" }, "https://smartdeploy.test", "DELETE"), context)).status).toBe(200);
		expect(mocks.remove).toHaveBeenCalledWith("workspace-a", "actor", "member");
		expect((await setRole(request("workspaces/x/members", { userId: "member", role: "admin" }, "https://smartdeploy.test", "PATCH"), context)).status).toBe(200);
		expect(mocks.setRole).toHaveBeenCalledWith("workspace-a", "actor", "member", "admin");
		const revokeContext = { params: Promise.resolve({ workspaceId: "workspace-a", invitationId: "invite-a" }) };
		expect((await revoke(request("workspaces/x/invitations/y", {}, "https://smartdeploy.test", "DELETE"), revokeContext)).status).toBe(200);
		expect(mocks.revoke).toHaveBeenCalledWith("workspace-a", "actor", "invite-a");
	});

	it("returns authorization failures without leaking underlying database errors", async () => {
		mocks.list.mockRejectedValueOnce(new WorkspaceError(404, "Workspace not found."));
		expect((await GET(new Request("https://smartdeploy.test/api/workspaces"))).status).toBe(404);
		mocks.list.mockRejectedValueOnce(new Error("sensitive-token-or-row-details"));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const response = await GET(new Request("https://smartdeploy.test/api/workspaces"));
			expect(response.status).toBe(500);
			expect(await response.text()).not.toContain("sensitive");
			expect(log).toHaveBeenCalledWith("Workspace request failed.");
		} finally { log.mockRestore(); }
	});
});
