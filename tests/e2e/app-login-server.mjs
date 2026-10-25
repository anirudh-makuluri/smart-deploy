import { createServer } from "node:https";
import { readFile } from "node:fs/promises";
import next from "next";

if (process.env.RUN_APP_LOGIN_BROWSER_TESTS !== "1" || process.env.BETTER_AUTH_URL !== "https://localhost:34433"
	|| !process.env.APP_LOGIN_TEST_KEY || !process.env.APP_LOGIN_TEST_CERT || !process.send) throw new Error("Explicit local HTTPS child fixture required.");
const sockets = new Set();
let application;
const server = createServer({ key: await readFile(process.env.APP_LOGIN_TEST_KEY), cert: await readFile(process.env.APP_LOGIN_TEST_CERT) }, async (request, response) => {
	if (request.headers.host !== "localhost:34433") { response.writeHead(403).end(); return; }
	request.headers["x-forwarded-proto"] = "https";
	try { await application.getRequestHandler()(request, response); }
	catch { if (!response.headersSent) response.writeHead(500); response.end(); }
});
server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
application = next({ dev: false, hostname: "localhost", port: 34433, httpServer: server });
await application.prepare();
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(34433, "127.0.0.1", resolve); });
process.send({ ready: true });
let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	for (const socket of sockets) socket.destroy();
	let status = 0;
	try { await new Promise((resolve) => server.close(resolve)); await application.close(); }
	catch { status = 1; }
	finally { process.exit(status); }
}
process.on("message", (message) => { if (message && message.stop === true) void stop(); });
process.on("disconnect", () => void stop());
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
