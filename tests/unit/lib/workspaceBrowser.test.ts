import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAck, workspaceRequest } from "@/lib/apps/workspaceBrowser";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("workspace browser transport", () => {
	it("uses same-origin JSON with no redirects, cache or automatic write retry", async () => {
		const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
		expect(await workspaceRequest("/api/apps/app/grants", "POST", { userId: "colleague" }, WorkspaceAck, new AbortController().signal)).toEqual({ ok: true });
		expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledWith("/api/apps/app/grants", expect.objectContaining({ method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", body: '{"userId":"colleague"}' }));
	});
	it.each([{}, { ok: false }, { ok: "true" }])("does not confirm an invalid successful acknowledgement", async value => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value)));
		await expect(workspaceRequest("/api/apps/app/grants", "DELETE", {}, WorkspaceAck, new AbortController().signal)).rejects.toThrow("may have completed");
	});
	it.each(["https://foreign.test/api/workspaces", "//foreign.test/api/workspaces", "/api/workspaces?token=secret", "/api/workspaces#secret", "/api/\\foreign.test"])('rejects unsafe path %s before sending', async path => {
		const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
		await expect(workspaceRequest(path, "POST", {}, WorkspaceAck, new AbortController().signal)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
	});
	it("rejects cancelled input, GET bodies and oversized UTF-8 before transport", async () => {
		const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
		await expect(workspaceRequest("/api/workspaces", "POST", {}, WorkspaceAck, AbortSignal.abort())).rejects.toThrow();
		await expect(workspaceRequest("/api/workspaces", "GET", {}, WorkspaceAck, new AbortController().signal)).rejects.toThrow();
		await expect(workspaceRequest("/api/workspaces", "POST", { name: "é".repeat(2100) }, WorkspaceAck, new AbortController().signal)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
	});
	it("redacts provider errors and preserves a rejected status", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "provider secret" }, { status: 403 })));
		await expect(workspaceRequest("/api/workspaces", "POST", {}, WorkspaceAck, new AbortController().signal)).rejects.toMatchObject({ status: 403, message: expect.not.stringContaining("provider secret") });
	});
	it("aborts at eight seconds and releases its timer", async () => {
		vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(Error("deadline")), { once: true }))));
		const rejection = expect(workspaceRequest("/api/workspaces", "POST", {}, WorkspaceAck, new AbortController().signal)).rejects.toThrow("may have completed");
		await vi.advanceTimersByTimeAsync(8000); await rejection; expect(vi.getTimerCount()).toBe(0);
	});
	it("propagates cancellation and rejects late success", async () => {
		let finish = (_response: Response) => {}; const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetcher);
		const controller = new AbortController(); const result = workspaceRequest("/api/workspaces", "POST", {}, WorkspaceAck, controller.signal); controller.abort();
		expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true); finish(Response.json({ ok: true })); await expect(result).rejects.toThrow("may have completed");
	});
});
