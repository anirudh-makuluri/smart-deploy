import { NextResponse } from "next/server";
import { z } from "zod";
import config from "@/config";
import { auth } from "@/lib/auth";
import { dbHelper } from "@/db-helper";
import { getDbPool } from "@/lib/dbPool";
import { WorkspaceError, WorkspaceStore } from "./workspaceStore";
import { AppStore } from "./appStore";

export const WorkspaceNameInput = z.object({ name: z.string().trim().min(1).max(120) }).strict();
export const InvitationInput = z.object({ email: z.string().trim().email().max(254), role: z.enum(["member", "admin"]) }).strict();
export const MemberInput = z.object({ userId: z.string().min(1).max(200) }).strict();
export const MemberRoleInput = MemberInput.extend({ role: z.enum(["member", "admin"]) });
export const InvitationAcceptanceInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

export function workspaceJson(value: unknown, status = 200): NextResponse {
	return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function parseWorkspaceBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
	let body: unknown;
	try { body = await request.json(); }
	catch { throw new WorkspaceError(400, "Invalid JSON."); }
	const result = schema.safeParse(body);
	if (!result.success) throw new WorkspaceError(400, "Invalid request fields.");
	return result.data;
}

interface WorkspaceApiContext { userId: string; store: WorkspaceStore; apps: AppStore }

export async function withWorkspaceApi(
	request: Request,
	action: (context: WorkspaceApiContext) => Promise<NextResponse>
): Promise<NextResponse> {
	try {
		if (!config.WORKSPACE_APPS_ENABLED) throw new WorkspaceError(503, "Workspace applications are not enabled.");
		if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) {
			throw new WorkspaceError(403, "A same-origin browser request is required.");
		}
		const session = await auth.api.getSession({ headers: request.headers });
		if (!session?.user?.id) throw new WorkspaceError(401, "Unauthorized.");
		if (config.WAITING_LIST_ENABLED) {
			const approval = await dbHelper.isApprovedUser(session.user.email);
			if (!approval.approved) throw new WorkspaceError(403, "Your account is not approved for workspace access.");
		}
		const pool = getDbPool();
		return await action({ userId: session.user.id, store: new WorkspaceStore(pool), apps: new AppStore(pool) });
	} catch (error) {
		if (error instanceof WorkspaceError) return workspaceJson({ error: error.message }, error.status);
		// Do not log invitation tokens, request bodies, or database row details.
		console.error("Workspace request failed.");
		return workspaceJson({ error: "Workspace request failed." }, 500);
	}
}
