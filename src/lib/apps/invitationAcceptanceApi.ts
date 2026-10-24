import type { NextResponse } from "next/server";
import config from "@/config";
import { auth } from "@/lib/auth";
import { dbHelper } from "@/db-helper";
import { getDbPool } from "@/lib/dbPool";
import { WorkspaceError, WorkspaceStore } from "./workspaceStore";
import { InvitationAcceptanceInput, workspaceJson } from "./workspaceApi";
import { parseGatewayBody } from "./gatewayApi";

/** The waiting-list exception can consume a member invitation, never run an arbitrary workspace action. */
export async function acceptWorkspaceInvitation(request: Request): Promise<NextResponse> {
	try {
		if (!config.WORKSPACE_APPS_ENABLED) throw new WorkspaceError(503, "Workspace applications are not enabled.");
		const platform = new URL(config.BETTER_AUTH_URL);
		if (platform.protocol !== "https:" || platform.username || platform.password || platform.search || platform.hash) {
			throw new WorkspaceError(503, "Secure platform configuration required.");
		}
		const url = new URL(request.url);
		const site = request.headers.get("sec-fetch-site");
		if (request.method !== "POST" || url.origin !== platform.origin || url.search
			|| request.headers.get("origin") !== platform.origin || (site !== null && site !== "same-origin")) {
			throw new WorkspaceError(403, "A same-origin browser request is required.");
		}
		const principal = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } });
		if (!principal) throw new WorkspaceError(401, "Sign in to continue.");
		let memberOnly = false;
		if (config.WAITING_LIST_ENABLED) {
			const approval = await dbHelper.isApprovedUser(principal.user.email);
			if (approval.error) throw new WorkspaceError(503, "App authorization unavailable.");
			memberOnly = !approval.approved;
			if (memberOnly && !config.PRIVATE_APP_GATEWAY_ENABLED) throw new WorkspaceError(403, "App access unavailable.");
		}
		const body = await parseGatewayBody(request, InvitationAcceptanceInput);
		const accepted = await new WorkspaceStore(getDbPool()).acceptInvitation(principal.user.id, body.token, memberOnly);
		return workspaceJson(accepted);
	} catch (error) {
		if (error instanceof WorkspaceError) return workspaceJson({ error: error.message }, error.status);
		console.error("Invitation acceptance unavailable.");
		return workspaceJson({ error: "Invitation acceptance unavailable." }, 503);
	}
}
