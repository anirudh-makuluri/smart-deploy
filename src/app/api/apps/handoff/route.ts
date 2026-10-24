import { NextResponse } from "next/server";
import { z } from "zod";
import config from "@/config";
import { auth } from "@/lib/auth";
import { getDbPool } from "@/lib/dbPool";
import { GatewayAuthStore } from "@/lib/apps/gatewayAuthStore";
import { gatewayLifetimes, parseGatewayBody, requirePrivateAppAdmission } from "@/lib/apps/gatewayApi";
import { WorkspaceError } from "@/lib/apps/workspaceStore";

const Secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const HandoffInput = z.strictObject({ bindingId: z.uuid(), challenge: Secret, state: Secret });

function json(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status, headers: {
		"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
	} });
}

/** Platform browser endpoint only. Gateway callback state/cookie verification is
 * a separate boundary; possession of this response never authenticates a gateway. */
export async function POST(request: Request): Promise<NextResponse> {
	try {
		if (!config.WORKSPACE_APPS_ENABLED || !config.PRIVATE_APP_GATEWAY_ENABLED) {
			throw new WorkspaceError(503, "Private gateway is not enabled.");
		}
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
		const limits = gatewayLifetimes();
		// Bypass cookie-cache snapshots and avoid extending a session while minting.
		const principal = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } });
		if (!principal) throw new WorkspaceError(401, "Sign in to continue.");
		const input = await parseGatewayBody(request, HandoffInput);
		const store = new GatewayAuthStore(getDbPool(), limits);
		await requirePrivateAppAdmission(store, input.bindingId, { id: principal.user.id, email: principal.user.email });
		const handoff = await store.issue(input.bindingId, { userId: principal.user.id, sessionId: principal.session.id }, input.challenge);
		// Callback authority comes exclusively from the operator-owned binding.
		// State is opaque correlation data: the gateway must verify its own browser
		// transaction before redeeming, and must never treat state as a credential.
		return json({ ...handoff, state: input.state });
	} catch (error) {
		if (error instanceof WorkspaceError) return json({ error: error.message }, error.status);
		console.error("Browser app handoff unavailable.");
		return json({ error: "App handoff unavailable." }, 503);
	}
}
