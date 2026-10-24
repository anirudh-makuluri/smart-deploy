import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import config from "@/config";
import { getDbPool } from "@/lib/dbPool";
import { verifiedPlatformLogout } from "@/lib/apps/platformLogout";

const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;
export async function POST(request: Request) {
	if (!config.WORKSPACE_APPS_ENABLED || !config.PRIVATE_APP_GATEWAY_ENABLED
		|| new URL(request.url).pathname !== "/api/auth/sign-out") return handlers.POST(request);
	return verifiedPlatformLogout(request, {
		post: handlers.POST,
		loadSession: () => auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } }),
		getPool: getDbPool,
	});
}

