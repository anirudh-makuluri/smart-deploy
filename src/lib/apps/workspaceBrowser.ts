import { z } from "zod";

const Identity = z.string().min(1).max(200);
export const UiWorkspace = z.object({ id: z.uuid(), name: z.string().min(1).max(120), kind: z.enum(["personal", "team"]), ownerId: Identity });
export const UiWorkspaceAccess = UiWorkspace.extend({ role: z.enum(["owner", "admin", "member"]) });
export type UiWorkspaceAccess = z.infer<typeof UiWorkspaceAccess>;
export const UiApp = z.object({ id: z.uuid(), workspaceId: z.uuid(), name: z.string().min(1).max(120), createdBy: Identity, legacyDeploymentId: z.string().nullable() });
export type UiApp = z.infer<typeof UiApp>;
export const UiMember = z.object({ userId: Identity, email: z.email(), role: z.enum(["owner", "admin", "member"]) });
export const UiInvitation = z.object({ id: z.uuid(), email: z.email(), role: z.enum(["admin", "member"]), expiresAt: z.iso.datetime({ offset: true }) });
export type UiInvitation = z.infer<typeof UiInvitation>;
export const UiGrant = z.object({ userId: Identity, email: z.email(), grantedBy: Identity, createdAt: z.iso.datetime({ offset: true }) });
export const WorkspaceList = z.object({ workspaces: z.array(UiWorkspaceAccess) });
export const AppList = z.object({ apps: z.array(UiApp) });
export const MemberList = z.object({ members: z.array(UiMember) });
export const InvitationList = z.object({ invitations: z.array(UiInvitation) });
export const GrantList = z.object({ grants: z.array(UiGrant) });
export const WorkspaceCreated = z.object({ workspace: UiWorkspace });
export const AppCreated = z.object({ app: UiApp });
export const InvitationCreated = z.object({ invitation: UiInvitation.extend({ role: z.literal("member"), token: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/) }) });
export const WorkspaceAck = z.object({ ok: z.literal(true) });
export const teamKey = (actorId: string) => ["team", actorId] as const;

export class WorkspaceBrowserError extends Error {
	constructor(readonly status: number) { super(status >= 400 && status < 500 ? "The change was rejected. Check your permissions and current membership, then refresh." : "We couldn't confirm the change. It may have completed. Refresh and check the current state before retrying."); }
}
export async function workspaceRequest<T>(path: string, method: "GET" | "POST" | "DELETE", body: unknown | null, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
	if (!path.startsWith("/api/") || /[?#\\]/.test(path) || signal.aborted || (method === "GET" && body !== null)) throw new WorkspaceBrowserError(400);
	const encoded = body === null ? undefined : JSON.stringify(body);
	if (encoded !== undefined && new TextEncoder().encode(encoded).byteLength > 4096) throw new WorkspaceBrowserError(400);
	const controller = new AbortController(); const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, 8000);
	try {
		const response = await fetch(path, { method, body: encoded, credentials: "same-origin", redirect: "error", cache: "no-store", headers: encoded === undefined ? {} : { "Content-Type": "application/json" }, signal: controller.signal });
		if (!response.ok) throw new WorkspaceBrowserError(response.status);
		const value: unknown = await response.json(); controller.signal.throwIfAborted(); return schema.parse(value);
	} catch (error) { if (error instanceof WorkspaceBrowserError) throw error; throw new WorkspaceBrowserError(503); }
	finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
