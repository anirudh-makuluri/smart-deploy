import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/platformAccess", () => ({ requirePlatformSession: mocks.session }));
// Route native timer imports through Vitest's virtual clock; production retains
// real Node timers so idle checks can be unreferenced.
vi.mock("node:timers", () => {
	const clock = {
	setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay),
	clearTimeout: (timer: ReturnType<typeof globalThis.setTimeout> | undefined) => globalThis.clearTimeout(timer),
	setInterval: (callback: () => void, delay: number) => {
		const timer = globalThis.setInterval(callback, delay);
		return { unref: () => {}, cancel: () => globalThis.clearInterval(timer) };
	},
	clearInterval: (timer: { cancel: () => void }) => timer.cancel(),
	};
	return { ...clock, default: clock };
});
import { installWorkerSessionGuard, requireWorkerSession } from "@/lib/workerSocketAuthorization";

class GuardSocket {
	connected = true;
	middleware: ((event: unknown[], next: (error: Error | undefined) => void) => void) | null = null;
	onDisconnect: (() => void) | null = null;
	disconnect = vi.fn(() => { this.connected = false; this.onDisconnect?.(); return this; });
	use(middleware: (event: unknown[], next: (error: Error | undefined) => void) => void) { this.middleware = middleware; return this; }
	once(_event: "disconnect", listener: () => void) { this.onDisconnect = listener; return this; }
	packet(): Promise<Error | undefined> {
		const middleware = this.middleware;
		if (!middleware) throw new Error("Missing guard");
		return new Promise((resolve) => middleware(["work"], resolve));
	}
}
beforeEach(() => { vi.useFakeTimers(); mocks.session.mockReset().mockResolvedValue({ id: "actor" }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("live worker session authorization", () => {
	it("rechecks every packet without caching a successful decision", async () => {
		const socket = new GuardSocket();
		const cleanup = installWorkerSessionGuard(socket, "actor", "platform-session");
		expect(await socket.packet()).toBeUndefined();
		expect(await socket.packet()).toBeUndefined();
		expect(mocks.session).toHaveBeenCalledTimes(2);
		expect(mocks.session).toHaveBeenCalledWith("actor", "platform-session");
		cleanup();
	});
	it("denies a packet and closes its connection after permission or session loss", async () => {
		const socket = new GuardSocket();
		installWorkerSessionGuard(socket, "actor", "platform-session");
		mocks.session.mockRejectedValue(new Error("session revoked"));
		expect(await socket.packet()).toMatchObject({ message: "Unauthorized" });
		expect(socket.disconnect).toHaveBeenCalledWith(true);
	});
	it("revalidates idle streams and stops the timer after disconnect", async () => {
		const socket = new GuardSocket();
		installWorkerSessionGuard(socket, "actor", "platform-session");
		mocks.session.mockRejectedValue(new Error("verification removed"));
		await vi.advanceTimersByTimeAsync(30_000);
		expect(socket.disconnect).toHaveBeenCalledWith(true);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("fails closed within the deadline when a backend never responds", async () => {
		mocks.session.mockImplementation(() => new Promise(() => {}));
		const rejection = expect(requireWorkerSession("actor", "platform-session")).rejects.toThrow("Unauthorized");
		await vi.advanceTimersByTimeAsync(5000);
		await rejection;
		expect(vi.getTimerCount()).toBe(0);
	});
	it("does not authorize a packet or disconnect again after teardown", async () => {
		let release = () => {};
		mocks.session.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
		const socket = new GuardSocket();
		const cleanup = installWorkerSessionGuard(socket, "actor", "platform-session");
		const packet = socket.packet();
		cleanup();
		release();
		expect(await packet).toMatchObject({ message: "Unauthorized" });
		expect(socket.disconnect).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
