import { describe, expect, it, vi } from "vitest";
import { requestRuntimeControl } from "@/lib/apps/runtimeControlBrowser";
import { RUNTIME_APP, RUNTIME_REQUEST, RELEASE_TWO, runtimeView } from "../helpers/runtimeView";
const command = { action: "inspect" as const, appId: RUNTIME_APP, requestId: RUNTIME_REQUEST };
function reply() { return { ok: true, appId: RUNTIME_APP, requestId: RUNTIME_REQUEST, view: runtimeView() }; }
describe("validated runtime control browser receipts", () => {
	it("accepts one matching actor-current inspection without introducing HTTP requests or retries", async () => {
		const send = vi.fn().mockResolvedValue(reply()); expect(await requestRuntimeControl(command, new AbortController().signal, () => true, send)).toEqual(expect.objectContaining({ choices: expect.any(Array) })); expect(send).toHaveBeenCalledOnce();
	});
	it.each([{}, { ok: true }, { ...reply(), appId: RUNTIME_REQUEST }, { ...reply(), requestId: RUNTIME_APP }])("rejects malformed or unrelated successful acknowledgements", async value => {
		await expect(requestRuntimeControl(command, new AbortController().signal, () => true, async () => value)).rejects.toThrow("may have completed");
	});
	it("does not treat a still-selected old release as successful publication", async () => {
		await expect(requestRuntimeControl({ ...command, action: "activate", environment: "published", releaseId: RELEASE_TWO, expectedCurrentId: null }, new AbortController().signal, () => true, async () => reply())).rejects.toThrow("may have completed");
	});
	it("rejects unsafe origins, duplicate environments and selections outside the reviewed catalog", async () => {
		for (const variant of ["url", "duplicate", "foreign"]) {
			const value = reply(); if (variant === "url") value.view.selected[0].origin = "javascript:alert(1)";
			if (variant === "duplicate") value.view.selected.push({ ...value.view.selected[0] });
			if (variant === "foreign") value.view.selected[0].releaseId = RUNTIME_REQUEST;
			await expect(requestRuntimeControl(command, new AbortController().signal, () => true, async () => value)).rejects.toThrow();
		}
	});
	it("does not transmit after cancellation or actor/socket retirement", async () => {
		const send = vi.fn(); await expect(requestRuntimeControl(command, AbortSignal.abort(), () => true, send)).rejects.toThrow(); await expect(requestRuntimeControl(command, new AbortController().signal, () => false, send)).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
	});
	it("discards a valid late acknowledgement after actor/socket retirement or cancellation", async () => {
		for (const variant of ["actor", "cancel"]) {
			let finish = (_value: ReturnType<typeof reply>) => {}; let current = true; const signal = new AbortController();
			const result = requestRuntimeControl(command, signal.signal, () => current, () => new Promise(resolve => { finish = resolve; }));
			if (variant === "actor") current = false; else signal.abort(); finish(reply()); await expect(result).rejects.toThrow("may have completed");
		}
	});
	it("redacts a provider rejection and does not retry an uncertain write", async () => {
		const send = vi.fn().mockRejectedValue(Error("private worker details")); await expect(requestRuntimeControl(command, new AbortController().signal, () => true, send)).rejects.toThrow("may have completed"); expect(send).toHaveBeenCalledOnce();
	});
});
