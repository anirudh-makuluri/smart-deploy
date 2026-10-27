import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManagedGatewayRouter, type ManagedRouterTiming } from "@/lib/gateway/managedRouter";
import type { ManagedGatewayRoute } from "@/lib/gateway/managedRoute";

const ORIGIN = "https://app.example.test";
const routers: ManagedGatewayRouter[] = [];
function route(runtimeId = "one", generation = 1, origin = ORIGIN): ManagedGatewayRoute {
	return { origin, runtimeId, generation, handle: vi.fn(async () => new Response(runtimeId)), close: vi.fn() };
}
function timing(): ManagedRouterTiming { return { refreshMs: 100, maxAgeMs: 1000, expiresAt: Date.now() + 60000 }; }
async function fixture() {
	const initial = route(); const load = vi.fn().mockResolvedValue(initial);
	const router = await ManagedGatewayRouter.open({ load }, timing(), new AbortController().signal); routers.push(router);
	return { router, initial, load };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const router of routers.splice(0)) router.close(); vi.useRealTimers(); });
describe("managed gateway selection reload", () => {
	it("serves only the validated initial route and retires it when the selection changes", async () => {
		const { router, initial, load } = await fixture(); const next = route("two", 2); load.mockResolvedValueOnce(next);
		expect(await (await router.handle(new Request(ORIGIN))).text()).toBe("one"); await router.refresh();
		expect(initial.close).toHaveBeenCalledTimes(1); expect(await (await router.handle(new Request(ORIGIN))).text()).toBe("two");
	});
	it("preserves in-flight login state when the runtime selection is unchanged", async () => {
		const { router, initial, load } = await fixture(); const duplicate = route(); load.mockResolvedValueOnce(duplicate);
		await router.refresh(); expect(duplicate.close).toHaveBeenCalledTimes(1); expect(initial.close).not.toHaveBeenCalled();
		await router.handle(new Request(ORIGIN)); expect(initial.handle).toHaveBeenCalledTimes(1); expect(duplicate.handle).not.toHaveBeenCalled();
	});
	it("fails closed on reload failure and recovers only after a fresh successful load", async () => {
		const { router, initial, load } = await fixture(); load.mockRejectedValueOnce(new Error("secret detail")); await router.refresh();
		const unavailable = await router.handle(new Request(ORIGIN)); expect(unavailable.status).toBe(503); expect(await unavailable.text()).not.toContain("secret detail");
		expect(initial.close).toHaveBeenCalledTimes(1); const recovered = route("two", 1); load.mockResolvedValueOnce(recovered); await router.refresh();
		expect(await (await router.handle(new Request(ORIGIN))).text()).toBe("two");
	});
	it("does not change the server's configured host when a binding changes", async () => {
		const { router, initial, load } = await fixture(); const foreign = route("two", 2, "https://other.example.test"); load.mockResolvedValueOnce(foreign);
		await router.refresh(); expect(router.origin).toBe(ORIGIN); expect(initial.close).toHaveBeenCalled(); expect(foreign.close).toHaveBeenCalled();
		expect((await router.handle(new Request(ORIGIN))).status).toBe(503);
	});
	it("keeps only one refresh in flight and drops stale routes while it is pending", async () => {
		const { router, initial, load } = await fixture(); let finish = (_value: ManagedGatewayRoute) => {};
		load.mockImplementationOnce(() => new Promise<ManagedGatewayRoute>(resolve => { finish = resolve; }));
		const pending = router.refresh(); await router.refresh(); expect(load).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1001); expect((await router.handle(new Request(ORIGIN))).status).toBe(503); expect(initial.close).toHaveBeenCalled();
		const next = route("two", 2); finish(next); await pending; expect(await (await router.handle(new Request(ORIGIN))).text()).toBe("two");
	});
	it("closes a late candidate after retirement and never restarts polling", async () => {
		const { router, load } = await fixture(); let finish = (_value: ManagedGatewayRoute) => {};
		load.mockImplementationOnce(() => new Promise<ManagedGatewayRoute>(resolve => { finish = resolve; }));
		const pending = router.refresh(); const signal = load.mock.calls[1][0] as AbortSignal; router.close(); expect(signal.aborted).toBe(true);
		const late = route("two", 2); finish(late); await pending; expect(late.close).toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(10000);
		expect(load).toHaveBeenCalledTimes(2); expect((await router.handle(new Request(ORIGIN))).status).toBe(503);
	});
	it("stops serving automatically at the explicit demo expiry", async () => {
		const initial = route(); const load = vi.fn().mockImplementation(async () => route());
		load.mockResolvedValueOnce(initial); const router = await ManagedGatewayRouter.open({ load }, { ...timing(), expiresAt: Date.now() + 150 }, new AbortController().signal); routers.push(router);
		await vi.advanceTimersByTimeAsync(151); expect((await router.handle(new Request(ORIGIN))).status).toBe(503); expect(initial.close).toHaveBeenCalled();
		const calls = load.mock.calls.length; await vi.advanceTimersByTimeAsync(1000); expect(load).toHaveBeenCalledTimes(calls);
	});
	it("rejects invalid timing and pre-aborted startup before loading", async () => {
		const load = vi.fn(); const signal = new AbortController().signal;
		for (const config of [{ ...timing(), expiresAt: Date.now() }, { ...timing(), expiresAt: Date.now() + 7200001 }, { ...timing(), refreshMs: 6000 }]) {
			await expect(ManagedGatewayRouter.open({ load }, config, signal)).rejects.toThrow("Private app gateway configuration unavailable.");
		}
		await expect(ManagedGatewayRouter.open({ load }, timing(), AbortSignal.abort())).rejects.toThrow(); expect(load).not.toHaveBeenCalled();
	});
});
