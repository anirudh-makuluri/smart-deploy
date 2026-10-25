import config from "@/config";
import { auth } from "@/lib/auth";
import { getDbPool } from "@/lib/dbPool";
import { GatewayAuthStore, type GatewayAppInspection } from "./gatewayAuthStore";
import { gatewayLifetimes, requirePrivateAppAdmission } from "./gatewayApi";
import { BrowserLoginInput, browserLoginPath, type BrowserLoginRequest } from "./browserLogin";
import { WorkspaceError } from "./workspaceStore";

export type AppLoginConfirmation =
	| { status: "disabled" | "invalid" | "denied" | "unavailable" }
	| { status: "signin"; callbackURL: string }
	| { status: "ready"; request: BrowserLoginRequest; app: GatewayAppInspection };

/** Server-only display preparation. Never issues a code or changes membership. */
export async function loadAppLoginConfirmation(query: Record<string, string | string[] | undefined>, headers: Headers): Promise<AppLoginConfirmation> {
	if (!config.WORKSPACE_APPS_ENABLED || !config.PRIVATE_APP_GATEWAY_ENABLED) return { status: "disabled" };
	const input = BrowserLoginInput.safeParse(query);
	if (!input.success) return { status: "invalid" };
	try {
		const platform = new URL(config.BETTER_AUTH_URL);
		if (platform.protocol !== "https:" || platform.origin !== config.BETTER_AUTH_URL || platform.username || platform.password) {
			return { status: "unavailable" };
		}
		const principal = await auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
		if (!principal) return { status: "signin", callbackURL: browserLoginPath(input.data) };
		const store = new GatewayAuthStore(getDbPool(), gatewayLifetimes());
		const app = await store.inspect(input.data.bindingId, { userId: principal.user.id, sessionId: principal.session.id });
		await requirePrivateAppAdmission(store, input.data.bindingId, app.identity);
		return { status: "ready", request: input.data, app };
	} catch (error) {
		if (error instanceof WorkspaceError && error.status >= 400 && error.status < 500) return { status: "denied" };
		console.error("App sign-in confirmation unavailable.");
		return { status: "unavailable" };
	}
}
