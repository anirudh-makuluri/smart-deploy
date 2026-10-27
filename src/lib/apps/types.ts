export type WorkspaceKind = "personal" | "team";
export type WorkspaceMemberRole = "admin" | "member";
export type WorkspaceRole = "owner" | WorkspaceMemberRole;
export type AppEnvironment = "published" | "preview";

export interface AppWorkspace {
	id: string;
	name: string;
	kind: WorkspaceKind;
	ownerId: string;
}

export interface WorkspaceMembership {
	workspaceId: string;
	userId: string;
	role: WorkspaceMemberRole;
}

export interface WorkspaceApp {
	id: string;
	workspaceId: string;
	name: string;
	createdBy: string;
	legacyDeploymentId: string | null;
}

/** Association only; build/runtime configuration continues to live in DeployConfig. */
export interface AppDeploymentAssociation {
	appId: string;
	workspaceId: string;
}
