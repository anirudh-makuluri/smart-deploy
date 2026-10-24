import { NextResponse } from "next/server";
import config from "@/config";
import { auth } from "@/lib/auth";
import { dbHelper } from "@/db-helper";
import { getDbPool } from "@/lib/dbPool";
import { authenticateCliAccessToken, getCliBearerToken } from "@/lib/cliAuth";

const APP_OR_PUBLIC_PATHS = new Set([
	"/api/apps/handoff", "/api/workspace-invitations/accept",
	"/api/gateway/authorize", "/api/gateway/redeem", "/api/gateway/logout",
	"/api/health", "/api/docs-markdown", "/api/metrics/public", "/api/metrics/artifacts/public",
	"/api/github/webhook", "/api/cli/device/start", "/api/cli/device/token", "/api/cli/logout",
]);

function denied(status: number, message: string): NextResponse {
	return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

function isAppOrPublicPath(path: string): boolean {
	return APP_OR_PUBLIC_PATHS.has(path) || path === "/api/auth" || path.startsWith("/api/auth/");
}

function isSameOriginBrowserRequest(request: Request): boolean {
	const platform = new URL(config.BETTER_AUTH_URL);
	const origin = request.headers.get("origin");
	const site = request.headers.get("sec-fetch-site");
	const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
	return new URL(request.url).origin === platform.origin && (origin === null || origin === platform.origin)
		&& (!mutation || origin === platform.origin) && (site === null || site === "same-origin");
}

/** The app-only login exception must not unlock legacy platform APIs that only check authentication. */
export async function platformApiApproval(request: Request): Promise<NextResponse | null> {
	// Keep enforcing platform approval after a pilot rollback: retained app-only
	// logins must never gain platform access by switching the private flags off.
	if (!config.WAITING_LIST_ENABLED) return null;
	const url = new URL(request.url);
	const path = url.pathname;
	if (isAppOrPublicPath(path)) return null;
	// Do not duplicate the auth library's cookie-name/whitespace/chunk parsing.
	const browser = request.headers.has("cookie");
	const cliToken = getCliBearerToken(request.headers);
	if (!browser && !cliToken) return null; // Each destination still owns anonymous/machine authentication.
	try {
		let email: string;
		if (browser) {
			if (!isSameOriginBrowserRequest(request)) {
				return denied(403, "A same-origin browser request is required.");
			}
			const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } });
			if (!session) return denied(401, "Sign in to continue.");
			email = session.user.email;
		} else if (cliToken) {
			const userId = await authenticateCliAccessToken(cliToken);
			if (!userId) return denied(401, "Unauthorized.");
			const result = await getDbPool().query<{ email: string }>('select email from public."user" where id = $1', [userId]);
			if (!result.rows[0]) return denied(401, "Unauthorized.");
			email = result.rows[0].email;
		} else return null;
		const approval = await dbHelper.isApprovedUser(email);
		if (approval.error) return denied(503, "Platform authorization unavailable.");
		return approval.approved ? null : denied(403, "Platform approval is required.");
	} catch {
		return denied(503, "Platform authorization unavailable.");
	}
}
