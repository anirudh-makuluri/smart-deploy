import { describe, expect, it } from "vitest";
import { canManageApp, canManageWorkspace, workspaceRoleForUser } from "@/lib/apps/permissions";
import type { AppWorkspace, WorkspaceApp, WorkspaceMembership } from "@/lib/apps/types";

const workspace: AppWorkspace = { id: "workspace-a", name: "Team", kind: "team", ownerId: "owner" };
const app: WorkspaceApp = {
	id: "app-a", workspaceId: workspace.id, name: "Tracker", createdBy: "former-admin", legacyDeploymentId: null,
};
const admin: WorkspaceMembership = { workspaceId: workspace.id, userId: "admin", role: "admin" };

describe("app workspace authorization foundation", () => {
	it("derives ownership from the workspace even without a membership row", () => {
		expect(workspaceRoleForUser(workspace, "owner", null)).toBe("owner");
		expect(canManageApp(app, workspace, "owner", null)).toBe(true);
	});

	it("allows a matching workspace administrator", () => {
		expect(canManageWorkspace(workspace, "admin", admin)).toBe(true);
		expect(canManageApp(app, workspace, "admin", admin)).toBe(true);
	});

	it("denies administrators from a different workspace or identity", () => {
		expect(canManageWorkspace(workspace, "admin", { ...admin, workspaceId: "workspace-b" })).toBe(false);
		expect(canManageWorkspace(workspace, "outsider", admin)).toBe(false);
		expect(canManageApp({ ...app, workspaceId: "workspace-b" }, workspace, "owner", null)).toBe(false);
	});

	it("does not turn workspace membership into deployment-management authority", () => {
		const member: WorkspaceMembership = { ...admin, role: "member" };
		expect(workspaceRoleForUser(workspace, "admin", member)).toBe("member");
		expect(canManageApp(app, workspace, "admin", member)).toBe(false);
	});

	it("does not grant enduring authority to an app's creator", () => {
		expect(canManageApp(app, workspace, "former-admin", null)).toBe(false);
	});

	it("denies unauthenticated callers and revoked memberships", () => {
		expect(canManageWorkspace(workspace, "", null)).toBe(false);
		expect(canManageApp(app, workspace, "admin", null)).toBe(false);
		expect(workspaceRoleForUser({ ...workspace, id: "" }, "owner", null)).toBeNull();
	});

	it("fails closed on an invalid persisted role", () => {
		const invalid = { ...admin, role: "super-admin" } as unknown as WorkspaceMembership;
		expect(workspaceRoleForUser(workspace, "admin", invalid)).toBeNull();
	});
});
