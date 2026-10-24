import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	config: { WORKSPACE_APPS_ENABLED: true, PRIVATE_APP_GATEWAY_ENABLED: true, WAITING_LIST_ENABLED: false, BETTER_AUTH_URL: "https://smartdeploy.test" },
	getSession: vi.fn(), approved: vi.fn(), pool: vi.fn(),
	create: vi.fn(), list: vi.fn(), invite: vi.fn(), accept: vi.fn(), members: vi.fn(), remove: vi.fn(), invitations: vi.fn(), revoke: vi.fn(), setRole: vi.fn(),
	createApp: vi.fn(), listApps: vi.fn(), grantUse: vi.fn(), revokeUse: vi.fn(), listGrants: vi.fn(), listEvents: vi.fn(),
}));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/db-helper", () => ({ dbHelper: { isApprovedUser: mocks.approved } }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: mocks.pool }));
vi.mock("@/lib/apps/appStore", () => ({ AppStore: class {
	createApp = mocks.createApp;
	listApps = mocks.listApps;
	grantUse = mocks.grantUse;
	revokeUse = mocks.revokeUse;
	listGrants = mocks.listGrants;
	listAccessEvents = mocks.listEvents;
} }));
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
import { GET as listApps, POST as createApp } from "@/app/api/workspaces/[workspaceId]/apps/route";
import { GET as grants, POST as grantUse, DELETE as revokeUse } from "@/app/api/apps/[appId]/grants/route";
import { GET as events } from "@/app/api/apps/[appId]/access-events/route";

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
	mocks.config.PRIVATE_APP_GATEWAY_ENABLED = true;
	mocks.getSession.mockResolvedValue({ user: { id: "actor", email: "actor@example.test" } });
	mocks.approved.mockResolvedValue({ approved: true });
	mocks.create.mockResolvedValue({ id: "new", ownerId: "actor", name: "Team", kind: "team" });
	mocks.list.mockResolvedValue([]);
	mocks.invite.mockResolvedValue({ id: "invite", token: "s".repeat(43) });
	mocks.accept.mockResolvedValue({ workspace: { id: "workspace-a" }, role: "member" });
	mocks.createApp.mockResolvedValue({ id: "app-a", workspaceId: "workspace-a", name: "Tracker", createdBy: "actor", legacyDeploymentId: null });
	mocks.listApps.mockResolvedValue([]);
	mocks.listGrants.mockResolvedValue([]);
	mocks.listEvents.mockResolvedValue([]);
});

describe("app access management browser APIs", () => {
	const appContext = { params: Promise.resolve({ appId: "app-a" }) };
	it("derives app creation authority from the session and rejects supplied ownership", async () => {
		expect((await createApp(request("workspaces/x/apps", { name: " Tracker " }), context)).status).toBe(201);
		expect(mocks.createApp).toHaveBeenCalledWith("workspace-a", "actor", "Tracker");
		expect((await createApp(request("workspaces/x/apps", { name: "Tracker", createdBy: "victim" }), context)).status).toBe(400);
	});

	it("passes the authenticated identity to filtered app listings", async () => {
		expect((await listApps(new Request("https://smartdeploy.test/api/workspaces/x/apps"), context)).status).toBe(200);
		expect(mocks.listApps).toHaveBeenCalledWith("workspace-a", "actor");
	});

	it("scopes grant and revoke operations to the app and rejects role escalation fields", async () => {
		expect((await grantUse(request("apps/x/grants", { userId: "member" }), appContext)).status).toBe(200);
		expect(mocks.grantUse).toHaveBeenCalledWith("app-a", "actor", "member");
		expect((await revokeUse(request("apps/x/grants", { userId: "member" }, "https://smartdeploy.test", "DELETE"), appContext)).status).toBe(200);
		expect(mocks.revokeUse).toHaveBeenCalledWith("app-a", "actor", "member");
		expect((await grantUse(request("apps/x/grants", { userId: "member", role: "admin" }), appContext)).status).toBe(400);
	});

	it("does not bypass management authorization when a service denies access", async () => {
		mocks.grantUse.mockRejectedValueOnce(new WorkspaceError(403, "Workspace management permission required."));
		expect((await grantUse(request("apps/x/grants", { userId: "member" }), appContext)).status).toBe(403);
	});

	it("protects grant and event listings with the same actor and cache policy", async () => {
		const response = await grants(new Request("https://smartdeploy.test/api/apps/x/grants"), appContext);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mocks.listGrants).toHaveBeenCalledWith("app-a", "actor");
		expect((await events(new Request("https://smartdeploy.test/api/apps/x/access-events"), appContext)).status).toBe(200);
		expect(mocks.listEvents).toHaveBeenCalledWith("app-a", "actor");
	});

	it("inherits the disabled-feature and same-origin mutation guards", async () => {
		mocks.config.WORKSPACE_APPS_ENABLED = false;
		expect((await createApp(request("workspaces/x/apps", { name: "Tracker" }), context)).status).toBe(503);
		mocks.config.WORKSPACE_APPS_ENABLED = true;
		expect((await grantUse(request("apps/x/grants", { userId: "member" }, "https://attacker.test"), appContext)).status).toBe(403);
		expect(mocks.grantUse).not.toHaveBeenCalled();
	});
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

	it("trims invitation email before validation while rejecting extra authority fields", async () => {
		const body = { email: " friend@example.test ", role: "member" };
		expect((await invite(request("workspaces/x/invitations", body), context)).status).toBe(201);
		expect(mocks.invite).toHaveBeenCalledWith("workspace-a", "actor", "friend@example.test", "member");
		expect((await invite(request("workspaces/x/invitations", { ...body, userId: "victim" }), context)).status).toBe(400);
		expect(mocks.invite).toHaveBeenCalledTimes(1);
	});

	it("accepts tokens only in a POST body and uses the session identity", async () => {
		expect((await accept(request("workspace-invitations/accept", { token: "s".repeat(43) }))).status).toBe(200);
		expect(mocks.accept).toHaveBeenCalledWith("actor", "s".repeat(43), false);
		expect((await accept(request("workspace-invitations/accept", { token: "s".repeat(43), userId: "victim" }))).status).toBe(400);
	});

	it("allows unapproved users to accept only ordinary-member invitations without opening management APIs", async () => {
		mocks.config.WAITING_LIST_ENABLED = true;
		mocks.approved.mockResolvedValue({ approved: false });
		expect((await accept(request("workspace-invitations/accept", { token: "s".repeat(43) }))).status).toBe(200);
		expect(mocks.accept).toHaveBeenCalledWith("actor", "s".repeat(43), true);
		expect((await createApp(request("workspaces/x/apps", { name: "Tracker" }), context)).status).toBe(403);
		expect((await GET(new Request("https://smartdeploy.test/api/workspaces"))).status).toBe(403);
		expect(mocks.createApp).not.toHaveBeenCalled();
	});

	it("does not enable the invitation exception without the private-app flag or on approval errors", async () => {
		mocks.config.WAITING_LIST_ENABLED = true;
		mocks.approved.mockResolvedValue({ approved: false });
		mocks.config.PRIVATE_APP_GATEWAY_ENABLED = false;
		expect((await accept(request("workspace-invitations/accept", { token: "s".repeat(43) }))).status).toBe(403);
		mocks.config.PRIVATE_APP_GATEWAY_ENABLED = true;
		mocks.approved.mockResolvedValue({ approved: true, error: "lookup failed" });
		expect((await accept(request("workspace-invitations/accept", { token: "s".repeat(43) }))).status).toBe(503);
		expect(mocks.accept).not.toHaveBeenCalled();
	});

	it("bounds invitation bodies and rejects sibling origins before reading identity or consuming invitations", async () => {
		expect((await accept(request("workspace-invitations/accept", { token: "s".repeat(43) }, "https://app.smartdeploy.test"))).status).toBe(403);
		expect(mocks.getSession).not.toHaveBeenCalled();
		expect((await accept(request("workspace-invitations/accept", { token: "s".repeat(5000) }))).status).toBe(413);
		expect(mocks.accept).not.toHaveBeenCalled();
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
