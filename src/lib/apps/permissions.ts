import type { AppWorkspace, WorkspaceApp, WorkspaceMembership, WorkspaceRole } from "./types";

/** Inputs must come from trusted server-side records, never request-supplied roles. */
export function workspaceRoleForUser(
	workspace: AppWorkspace,
	userId: string,
	membership: WorkspaceMembership | null
): WorkspaceRole | null {
	if (!userId || !workspace.id) return null;
	if (workspace.ownerId === userId) return "owner";
	if (!membership || membership.workspaceId !== workspace.id || membership.userId !== userId) return null;
	return membership.role === "admin" || membership.role === "member" ? membership.role : null;
}

export function canManageWorkspace(
	workspace: AppWorkspace,
	userId: string,
	membership: WorkspaceMembership | null
): boolean {
	const role = workspaceRoleForUser(workspace, userId, membership);
	return role === "owner" || role === "admin";
}

export function canManageApp(
	app: WorkspaceApp,
	workspace: AppWorkspace,
	userId: string,
	membership: WorkspaceMembership | null
): boolean {
	return app.workspaceId === workspace.id && canManageWorkspace(workspace, userId, membership);
}
