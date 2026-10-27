import { randomUUID } from "node:crypto";
import { createServer } from "node:https";
import type { AppStore } from "../../src/lib/apps/appStore";
import { RuntimeControlRequest, type RuntimeControlView } from "../../src/lib/apps/runtimeControlProtocol";
import { installRuntimeControlSocket, type RuntimeControlPort } from "../../src/lib/apps/runtimeControlSocket";
import { closeDbPool } from "../../src/lib/dbPool";
import { createWorkerSocketServer } from "../../src/lib/workerSocketServer";

/** Actual worker authentication/transport; controlled release metadata, with no AWS publication claim. */
export async function runtimePublishingFixture(key: Buffer, cert: Buffer, apps: AppStore, appId: string) {
	if (process.env.NEXT_PUBLIC_WS_URL !== "wss://localhost:34435/ws" || process.env.PRIVATE_APP_PUBLISH_ENABLED !== "true") throw new Error("Exact disposable publishing transport configuration required.");
	const one = randomUUID(), two = randomUUID(), preview = randomUUID();
	const view: RuntimeControlView = { expiresAt: Date.now() + 600000, choices: [
		{ releaseId: one, label: "Curated notes v1", environment: "published", available: true },
		{ releaseId: two, label: "Curated notes v2", environment: "published", available: true },
		{ releaseId: preview, label: "Curated draft", environment: "preview", available: true },
	], selected: [{ runtimeId: randomUUID(), releaseId: one, environment: "published", origin: "https://app.localhost", generation: 1, available: true }] };
	const writes: Array<Extract<RuntimeControlRequest, { action: "activate" }>> = [];
	let malformedNextWrite = false;
	const port: RuntimeControlPort = { close() {}, async request(principal, payload, signal) {
		const command = RuntimeControlRequest.parse(payload); signal.throwIfAborted();
		if (command.appId !== appId) return { ok: false, requestId: command.requestId, status: 404, error: "Fixture catalog has no app." };
		await apps.listGrants(appId, principal.userId); signal.throwIfAborted();
		if (command.action === "activate") {
			writes.push(command);
			if (malformedNextWrite) { malformedNextWrite = false; return { ok: true, requestId: randomUUID(), appId, view: structuredClone(view) }; }
			const current = view.selected.find(row => row.environment === command.environment);
			const choice = view.choices.find(row => row.releaseId === command.releaseId && row.environment === command.environment && row.available);
			if (!choice || (current?.runtimeId ?? null) !== command.expectedCurrentId) return { ok: false, requestId: command.requestId, status: 409, error: "Fixture selection changed." };
			view.selected = [...view.selected.filter(row => row.environment !== command.environment), { runtimeId: randomUUID(), releaseId: choice.releaseId, environment: choice.environment, origin: choice.environment === "published" ? "https://app.localhost" : "https://preview.localhost", generation: (current?.generation ?? 0) + 1, available: true }];
			if (current) { const previous = view.choices.find(row => row.releaseId === current.releaseId); if (previous) previous.available = false; }
		}
		return { ok: true, requestId: command.requestId, appId, view: structuredClone(view) };
	} };
	const server = createServer({ key, cert }, (request, response) => { request.resume(); response.writeHead(404).end(); });
	const worker = createWorkerSocketServer(server, ["https://localhost:34433"]);
	worker.on("connection", socket => { socket.on("error", () => {}); installRuntimeControlSocket(socket, Promise.resolve(port)); });
	await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(34435, "127.0.0.1", resolve); });
	return { one, two, preview, writes, view, malformedWrite: () => { malformedNextWrite = true; }, async close() { await new Promise<void>(resolve => worker.close(() => resolve())); await closeDbPool(); } };
}
