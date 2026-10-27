import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RELEASES = new Set(["v1", "v2", "preview"]);
const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

/** Curated architecture demo only. The gateway supplies authentication and document access. */
export async function createNotesServer(release) {
  if (!RELEASES.has(release)) throw Error("Notes demo unavailable.");
  const [template, client, styles] = await Promise.all(["index.html", "client.js", "style.css"].map(name => readFile(path.join(DIRECTORY, name), "utf8")));
  const pages = new Map([
    ["/", { content: template.replaceAll("{{RELEASE}}", release), type: "text/html; charset=utf-8" }],
    ["/client.js", { content: client, type: "text/javascript; charset=utf-8" }],
    ["/style.css", { content: styles, type: "text/css; charset=utf-8" }],
    ["/health", { content: JSON.stringify({ ok: true, release }), type: "application/json" }],
  ]);
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    request.resume();
    const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
    const page = pages.get((request.url ?? "").split("?")[0]);
    if (!["GET", "HEAD"].includes(request.method ?? "")) { response.writeHead(405, { ...headers, Allow: "GET, HEAD" }).end(); return; }
    if (!page) { response.writeHead(404, headers).end(); return; }
    response.writeHead(200, { ...headers, "Content-Type": page.type }); response.end(request.method === "HEAD" ? undefined : page.content);
  });
  server.maxConnections = 16; server.maxHeadersCount = 24; server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000; server.maxRequestsPerSocket = 32;
  return server;
}

async function main() {
  try {
    const port = process.env.PORT ?? "3000";
    if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw Error();
    const server = await createNotesServer(process.env.NOTES_RELEASE);
    server.on("error", () => { process.stderr.write("Notes demo unavailable.\n"); process.exit(1); });
    server.listen(Number(port), "127.0.0.1");
    const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
    process.once("SIGTERM", stop); process.once("SIGINT", stop);
  } catch { process.stderr.write("Notes demo unavailable.\n"); process.exit(1); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
