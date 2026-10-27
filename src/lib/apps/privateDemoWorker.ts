import { createServer, type Server } from "node:http";
import { isAbsolute } from "node:path";
import { createWorkerSocketServer } from "../workerSocketServer";
import { installRuntimeControlSocket } from "./runtimeControlSocket";
import type { ConfiguredRuntimeControl } from "./runtimeControlBootstrap";

export interface PrivateDemoWorker { server: Server; close(): Promise<void> }

/** Dedicated process only: install before opening the shared session pool. */
export function demoWorkerDatabaseUrl(connectionString: string, caFile: string): string {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.pathname || url.pathname === "/" || !isAbsolute(caFile)) throw Error("Demo worker database unavailable.");
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith("ssl") || key.toLowerCase() === "uselibpqcompat") url.searchParams.delete(key);
  url.searchParams.set("sslmode", "verify-full"); url.searchParams.set("sslrootcert", caFile);
  return url.href;
}

/** No deployment/agent imports, event handlers, internal event bridge or background reconciliation. */
export function createPrivateDemoWorker(control: ConfiguredRuntimeControl, origin: string, version: string): PrivateDemoWorker {
  const url = new URL(origin); const remaining = control.expiresAt - Date.now();
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password || !/^[a-f0-9]{40}$/.test(version)
    || !Number.isSafeInteger(control.expiresAt) || remaining <= 0 || remaining > 7200000) throw Error("Demo worker configuration unavailable.");
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    request.resume();
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Connection", "close"); response.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD"].includes(request.method ?? "") || !["/", "/health"].includes(request.url ?? "")) { response.writeHead(404).end(); return; }
    const address = server.address(); if (!address || typeof address === "string") { response.writeHead(503).end(); return; }
    const live = Date.now() < control.expiresAt;
    const body = JSON.stringify({ ok: live, service: "websocket", environment: "production", port: address.port, version, mode: "private-app-demo", expiresAt: control.expiresAt });
    response.writeHead(live ? 200 : 503, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    response.end(request.method === "HEAD" ? undefined : body);
  });
  server.maxConnections = 32; server.maxHeadersCount = 32; server.requestTimeout = 5000; server.headersTimeout = 3000; server.keepAliveTimeout = 1000; server.maxRequestsPerSocket = 16;
  const io = createWorkerSocketServer(server, [origin]);
  io.on("connection", socket => {
    socket.on("error", () => {});
    socket.onAny((event: string, ...arguments_: unknown[]) => {
      if (event === "apps:runtime") return;
      const acknowledge = arguments_.at(-1);
      if (socket.connected && typeof acknowledge === "function") acknowledge({ ok: false, status: 503, error: "Only prepared app runtime controls are available during this demo." });
    });
    installRuntimeControlSocket(socket, Promise.resolve(control));
  });
  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      clearTimeout(timer); let failed = false;
      try { control.close(); } catch { failed = true; }
      io.disconnectSockets(true);
      const stopped = new Promise<void>(resolve => { void io.close(() => resolve()); }); server.closeAllConnections(); await stopped;
      if (failed) throw Error("Demo worker shutdown unavailable.");
    })();
    return closing;
  };
  const stop = () => { void close().catch(() => {}); };
  const timer = setTimeout(stop, remaining); timer.unref(); server.once("error", stop); server.once("close", stop);
  return { server, close };
}
