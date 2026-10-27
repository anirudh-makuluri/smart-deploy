import { RuntimeControlRequest, type RuntimeControlReply } from "./runtimeControlProtocol";
import type { RuntimeControlPrincipal } from "./runtimeController";

export interface RuntimeControlPort {
	request(principal: RuntimeControlPrincipal, payload: unknown, signal: AbortSignal): Promise<RuntimeControlReply>;
	close(): void;
}
interface RuntimeControlSocket {
	data: { userID: string; sessionID: string };
	connected: boolean;
	on(event: "apps:runtime", handler: (payload: unknown, acknowledge: unknown) => void): unknown;
	once(event: "disconnect", handler: () => void): unknown;
}
export function installRuntimeControlSocket(socket: RuntimeControlSocket, configured: Promise<RuntimeControlPort | null>): void {
	let pending: AbortController | null = null;
	socket.once("disconnect", () => pending?.abort());
	socket.on("apps:runtime", (payload, acknowledge) => {
		if (typeof acknowledge !== "function") return;
		const parsed = RuntimeControlRequest.safeParse(payload);
		const fail = (status: number): RuntimeControlReply => ({ ok: false, requestId: parsed.success ? parsed.data.requestId : null, status, error: "App runtime change could not be confirmed. Refresh the current state before trying again." });
		if (!parsed.success) { acknowledge(fail(400)); return; }
		if (pending) { acknowledge(fail(503)); return; }
		const controller = new AbortController(); pending = controller; let replied = false;
		const reply = (response: RuntimeControlReply) => { if (replied) return; replied = true; if (socket.connected) acknowledge(response); };
		const timer = setTimeout(() => { controller.abort(); reply(fail(503)); }, 20000); timer.unref();
		const principal = { userId: socket.data.userID, sessionId: socket.data.sessionID };
		void (async () => {
			try {
				const port = await configured; controller.signal.throwIfAborted();
				if (!port) { reply(fail(503)); return; }
				const result = await port.request(principal, parsed.data, controller.signal);
				reply(controller.signal.aborted ? fail(503) : result);
			} catch { reply(fail(503)); }
			finally { clearTimeout(timer); if (pending === controller) pending = null; controller.abort(); }
		})();
	});
}
