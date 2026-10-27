import { Pool } from "pg";
import { z } from "zod";
import config from "@/config";
import { gatewayDatabaseOptions, gatewayFile } from "../gateway/serverConfig";
import { requirePlatformAccess, type PlatformIdentity } from "../platformAccess";
import { AppRuntimeController } from "./runtimeController";
import { RuntimeControlSettings } from "./runtimeControlSettings";
import type { RuntimeControlPort } from "./runtimeControlSocket";
import { WorkspaceError } from "./workspaceStore";

const ServerSettings = z.strictObject({ runtime: RuntimeControlSettings, databaseCaFile: z.string().min(1) });
export interface ConfiguredRuntimeControl extends RuntimeControlPort { expiresAt: number; databaseCaFile: string }

/** Only the trusted worker's bounded local operator configuration selects cloud metadata. */
export async function configuredRuntimeControl(): Promise<ConfiguredRuntimeControl | null> {
	if (!config.WORKSPACE_APPS_ENABLED || !config.PRIVATE_APP_GATEWAY_ENABLED || !config.PRIVATE_APP_PUBLISH_ENABLED) return null;
	const settings = ServerSettings.parse(JSON.parse((await gatewayFile(config.PRIVATE_APP_PUBLISH_CONFIG, 32768)).toString("utf8")));
	if (settings.runtime.scope.privateDomain !== "apps.smart-deploy.xyz") throw new WorkspaceError(503, "Runtime control unavailable.");
	const ca = (await gatewayFile(settings.databaseCaFile, 65536)).toString("utf8");
	const pool = new Pool(gatewayDatabaseOptions(config.DATABASE_URL, ca));
	try {
		const controller = new AppRuntimeController(pool, settings.runtime, async principal => {
			const result = await pool.query<PlatformIdentity>(`select u.id, u.email, u."emailVerified" from public.session s join public."user" u on u.id=s."userId"
          where s.id=$1 and s."userId"=$2 and s."expiresAt">clock_timestamp()`, [principal.sessionId, principal.userId]);
			if (!result.rows[0]) throw new WorkspaceError(401, "Unauthorized.");
			await requirePlatformAccess(result.rows[0]);
		}, undefined);
		let closed = false;
		const close = () => { if (closed) return; closed = true; clearTimeout(timer); controller.close(); void pool.end().catch(() => {}); };
		const timer = setTimeout(close, Math.max(0, settings.runtime.expiresAt - Date.now())); timer.unref(); pool.on("error", close);
		return { request: controller.request.bind(controller), close, expiresAt: settings.runtime.expiresAt, databaseCaFile: settings.databaseCaFile };
	} catch { await pool.end(); throw new WorkspaceError(503, "Runtime control unavailable."); }
}
