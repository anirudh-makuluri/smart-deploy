import config from "./config";
import { configuredRuntimeControl } from "./lib/apps/runtimeControlBootstrap";
import { createPrivateDemoWorker, demoWorkerDatabaseUrl } from "./lib/apps/privateDemoWorker";
import { closeDbPool } from "./lib/dbPool";
import { parseAllowedOrigins } from "./lib/wsOrigin";

async function main(): Promise<void> {
  const origins = parseAllowedOrigins(process.env.WS_ALLOWED_ORIGINS);
  const publicBase = process.env.NEXT_PUBLIC_WS_URL ?? "";
  if (!URL.canParse(publicBase)) throw Error("Demo worker configuration unavailable.");
  const publicUrl = new URL(publicBase);
  const port = Number(process.env.WS_PORT ?? "4001");
  if (process.argv.length !== 2 || process.env.NODE_ENV !== "production" || !config.WAITING_LIST_ENABLED || !process.env.BETTER_AUTH_SECRET?.trim()
    || origins.length !== 1 || origins[0] !== "https://smart-deploy.xyz" || publicUrl.protocol !== "wss:" || publicUrl.hostname !== "ws.smart-deploy.xyz"
    || publicUrl.port || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash
    || !Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Demo worker configuration unavailable.");
  const control = await configuredRuntimeControl(); if (!control) throw Error("Demo worker configuration unavailable.");
  try {
    // Explicit CA/hostname verification also covers the shared handshake/per-packet session pool.
    await closeDbPool();
    process.env.DATABASE_URL = demoWorkerDatabaseUrl(process.env.DATABASE_URL ?? "", control.databaseCaFile); process.env.DB_POOL_MAX = "2";
    const worker = createPrivateDemoWorker(control, origins[0], process.env.WORKER_VERSION ?? "");
    let shuttingDown = false;
    const stop = () => {
      if (shuttingDown) return; shuttingDown = true;
      const deadline = setTimeout(() => process.exit(1), 3000); deadline.unref();
      void (async () => {
        try { const results = await Promise.allSettled([worker.close(), closeDbPool()]); if (results.some(result => result.status === "rejected")) process.exitCode = 1; }
        finally { clearTimeout(deadline); }
      })();
    };
    process.once("SIGTERM", stop); process.once("SIGINT", stop); worker.server.once("close", stop); worker.server.once("error", stop);
    await new Promise<void>((resolve, reject) => { worker.server.once("error", reject); worker.server.listen(port, "0.0.0.0", resolve); });
    console.info("Private app demo control worker started.");
  } catch { control.close(); throw Error("Demo worker startup unavailable."); }
}

void main().catch(() => { console.error("Private app demo control worker startup failed."); process.exitCode = 1; });
