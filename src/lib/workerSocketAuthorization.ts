import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import { requirePlatformSession } from "./platformAccess";

interface WorkerAccessTarget {
	connected: boolean;
	use(middleware: (event: unknown[], next: (error: Error | undefined) => void) => void): unknown;
	once(event: "disconnect", listener: () => void): unknown;
	disconnect(close: boolean): unknown;
}

/** Bound authorization latency independently of pool acquisition and provider timeouts. */
export async function requireWorkerSession(userID: string, sessionID: string): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Unauthorized")), 5000); });
	try { await Promise.race([requirePlatformSession(userID, sessionID), deadline]); }
	finally { clearTimeout(timer); }
}

/** Every packet needs current permission. Idle streams are closed within 30s + a 5s check. */
export function installWorkerSessionGuard(socket: WorkerAccessTarget, userID: string, sessionID: string): () => void {
	let active = true;
	let checking: Promise<void> | null = null;
	function check(): Promise<void> {
		checking ??= requireWorkerSession(userID, sessionID).finally(() => { checking = null; });
		return checking;
	}
	socket.use((_, next) => {
		void check().then(() => {
			if (active && socket.connected) next(undefined);
			else next(new Error("Unauthorized"));
		}, () => {
			if (active) socket.disconnect(true);
			next(new Error("Unauthorized"));
		});
	});
	const interval = setInterval(() => { void check().catch(() => { if (active) socket.disconnect(true); }); }, 30_000);
	interval.unref();
	const cleanup = () => { active = false; clearInterval(interval); };
	socket.once("disconnect", cleanup);
	return cleanup;
}
