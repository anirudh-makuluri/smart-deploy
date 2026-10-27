import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installRuntimeControlSocket, type RuntimeControlPort } from "@/lib/apps/runtimeControlSocket";
import { CONTROL_APP, CONTROL_REQUEST } from "../../helpers/runtimeControlFixture";
import { RuntimeControlView } from "@/lib/apps/runtimeControlProtocol";

const payload = { action: "inspect", appId: CONTROL_APP, requestId: CONTROL_REQUEST };
function fixture() {
	let receive = (_payload: unknown, _acknowledge: unknown) => {}; let disconnect = () => {};
	const socket = { connected: true, data: { userID: "authenticated-owner", sessionID: "authenticated-session" },
		on: (_event: "apps:runtime", handler: typeof receive) => { receive = handler; }, once: (_event: "disconnect", handler: () => void) => { disconnect = handler; } };
	const request = vi.fn<RuntimeControlPort["request"]>().mockResolvedValue({ ok: true, requestId: CONTROL_REQUEST, appId: CONTROL_APP, view: { expiresAt: Date.now() + 60000, choices: [], selected: [] } });
	return { socket, request, receive: (value: unknown, acknowledge: unknown) => receive(value, acknowledge), disconnect: () => { socket.connected = false; disconnect(); } };
}
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
describe("authenticated runtime control acknowledgements", () => {
	it("accepts only canonical HTTPS app origins and a minimal display projection", () => {
		const row = { environment: "published", runtimeId: CONTROL_REQUEST, releaseId: CONTROL_REQUEST, generation: 1, origin: "https://app.example.test", available: true };
		const view = { expiresAt: Date.now() + 60000, choices: [], selected: [row] }; expect(RuntimeControlView.safeParse(view).success).toBe(true);
		for (const origin of ["javascript:alert(1)", "http://app.example.test", "https://user:secret@app.example.test", "https://app.example.test/private?token=secret"]) expect(RuntimeControlView.safeParse({ ...view, selected: [{ ...row, origin }] }).success).toBe(false);
		expect(RuntimeControlView.safeParse({ ...view, selected: [{ ...row, credential: "private" }] }).success).toBe(false);
	});
	it("derives identity only from the authenticated socket and replies only to its acknowledgement", async () => {
		const value = fixture(); const acknowledge = vi.fn(); installRuntimeControlSocket(value.socket, Promise.resolve({ request: value.request, close() {} })); value.receive(payload, acknowledge);
		await vi.advanceTimersByTimeAsync(1); expect(value.request).toHaveBeenCalledWith({ userId: "authenticated-owner", sessionId: "authenticated-session" }, payload, expect.any(AbortSignal)); expect(acknowledge).toHaveBeenCalledOnce(); expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
	});
	it("rejects forged identity and cloud fields before invoking the controller", async () => {
		const value = fixture(); const acknowledge = vi.fn(); installRuntimeControlSocket(value.socket, Promise.resolve({ request: value.request, close() {} })); value.receive({ ...payload, userId: "other", taskArn: "foreign" }, acknowledge);
		expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ ok: false, status: 400 })); expect(value.request).not.toHaveBeenCalled();
	});
	it("does not perform a fire-and-forget action or start overlapping requests", async () => {
		const value = fixture(); value.request.mockImplementation(() => new Promise(() => {})); const acknowledge = vi.fn(); installRuntimeControlSocket(value.socket, Promise.resolve({ request: value.request, close() {} }));
		value.receive(payload, null); expect(value.request).not.toHaveBeenCalled(); value.receive(payload, acknowledge); await vi.advanceTimersByTimeAsync(1); value.receive(payload, acknowledge);
		expect(value.request).toHaveBeenCalledOnce(); expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ ok: false, status: 503 })); value.disconnect();
	});
	it("cancels disconnected work and never delivers its late success", async () => {
		const value = fixture(); let finish = (_value: Awaited<ReturnType<RuntimeControlPort["request"]>>) => {}; value.request.mockImplementation(() => new Promise(resolve => { finish = resolve; })); const acknowledge = vi.fn();
		installRuntimeControlSocket(value.socket, Promise.resolve({ request: value.request, close() {} })); value.receive(payload, acknowledge); await vi.advanceTimersByTimeAsync(1); value.disconnect();
		expect(value.request.mock.calls[0][2].aborted).toBe(true); finish({ ok: false, requestId: CONTROL_REQUEST, status: 503, error: "unavailable" }); await vi.advanceTimersByTimeAsync(1); expect(acknowledge).not.toHaveBeenCalled();
	});
	it("bounds configuration startup and never starts a late action after its timeout", async () => {
		const value = fixture(); let finish = (_port: RuntimeControlPort) => {}; const configured = new Promise<RuntimeControlPort>(resolve => { finish = resolve; }); const acknowledge = vi.fn();
		installRuntimeControlSocket(value.socket, configured); value.receive(payload, acknowledge); await vi.advanceTimersByTimeAsync(20000); expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ ok: false, status: 503 }));
		finish({ request: value.request, close() {} }); await vi.advanceTimersByTimeAsync(1); expect(value.request).not.toHaveBeenCalled(); expect(acknowledge).toHaveBeenCalledOnce();
	});
	it("fails closed without a configured publisher and redacts internal errors", async () => {
		const value = fixture(); const acknowledge = vi.fn(); installRuntimeControlSocket(value.socket, Promise.resolve(null)); value.receive(payload, acknowledge); await vi.advanceTimersByTimeAsync(1); expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ ok: false, status: 503 }));
		const second = fixture(); second.request.mockRejectedValue(Error("private operator configuration")); installRuntimeControlSocket(second.socket, Promise.resolve({ request: second.request, close() {} })); second.receive(payload, acknowledge); await vi.advanceTimersByTimeAsync(1); expect(JSON.stringify(acknowledge.mock.calls)).not.toContain("private operator configuration");
	});
});
