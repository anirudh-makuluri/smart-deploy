import { Pool } from "pg";
import { ManagedGatewayLoader } from "./lib/gateway/managedRoute";
import { ManagedGatewayError } from "./lib/gateway/managedRouteSchema";
import { ManagedGatewayRouter } from "./lib/gateway/managedRouter";
import { createGatewayHttpsServer } from "./lib/gateway/nativeServer";
import { gatewayDatabaseOptions, gatewayServerFiles } from "./lib/gateway/serverConfig";

async function main(): Promise<void> {
	if (process.env.WORKSPACE_APPS_ENABLED !== "true" || process.env.PRIVATE_APP_GATEWAY_ENABLED !== "true" || process.argv.length !== 3) throw new ManagedGatewayError();
	const { settings, key, cert, databaseCa } = await gatewayServerFiles(process.argv[2]);
	const pool = new Pool(gatewayDatabaseOptions(process.env.DATABASE_URL ?? "", databaseCa));
	const loader = new ManagedGatewayLoader(pool, settings.gateway); const startup = new AbortController();
	pool.on("error", () => startup.abort());
	let router: ManagedGatewayRouter;
	try { router = await ManagedGatewayRouter.open(loader, settings.timing, startup.signal); }
	catch { loader.close(); await pool.end(); throw new ManagedGatewayError(); }
	let server: ReturnType<typeof createGatewayHttpsServer>;
	try { server = createGatewayHttpsServer({ key, cert, routes: [router], limits: settings.gateway.limits }); }
	catch { router.close(); loader.close(); await pool.end(); throw new ManagedGatewayError(); }
	let shutdown: Promise<void> | null = null;
	const close = (): Promise<void> => {
		if (shutdown) return shutdown;
		shutdown = (async () => {
			clearTimeout(expiry); startup.abort(); router.close(); loader.close(); server.closeAllConnections();
			await new Promise<void>(resolve => { server.close(() => resolve()); }); await pool.end();
		})();
		return shutdown;
	};
	const stop = () => { void close().catch(() => { process.exitCode = 1; }); };
	process.once("SIGTERM", stop); process.once("SIGINT", stop); pool.on("error", stop); server.on("error", stop);
	const expiry = setTimeout(stop, Math.max(0, settings.timing.expiresAt - Date.now()));
	try {
		await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(settings.port, settings.address, resolve); });
		console.info("Private app gateway started with bounded demo expiry.");
	} catch { await close(); throw new ManagedGatewayError(); }
}

void main().catch(() => { console.error("Private app gateway startup failed."); process.exitCode = 1; });
