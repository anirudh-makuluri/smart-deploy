import { afterEach, describe, expect, it, vi } from "vitest";
import { requestInvitation } from "@/lib/apps/invitationBrowser";
const TOKEN = "a".repeat(43); const ID = "9d888612-4141-4402-bbfd-23736a11bd46";
const DETAILS = { workspace: { id: ID, name: "Test team" }, role: "member", expiresAt: "2026-10-27T00:00:00Z" };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("browser invitation transport", () => {
	it("uses only the existing same-origin POST endpoint and validates its display projection", async () => {
		const fetcher = vi.fn().mockResolvedValue(Response.json(DETAILS)); vi.stubGlobal("fetch", fetcher);
		expect(await requestInvitation("inspect", TOKEN, new AbortController().signal)).toEqual(DETAILS);
		expect(fetcher).toHaveBeenCalledWith("/api/workspace-invitations/inspect", expect.objectContaining({ method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", body: JSON.stringify({ token: TOKEN }) }));
	});
	it.each([{}, { ...DETAILS, role: "owner" }, { ...DETAILS, expiresAt: "bad" }, { ...DETAILS, workspace: { id: "foreign", name: "Wrong" } }])("rejects malformed successful inspection", async value => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value))); await expect(requestInvitation("inspect", TOKEN, new AbortController().signal)).rejects.toThrow("Invitation unavailable.");
	});
	it("does not treat an HTML acknowledgement as acceptance", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>error</html>"))); await expect(requestInvitation("accept", TOKEN, new AbortController().signal)).rejects.toThrow("Invitation unavailable.");
	});
	it("rejects malformed/cancelled input without transport", async () => {
		const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
		await expect(requestInvitation("inspect", TOKEN + "\n", new AbortController().signal)).rejects.toThrow();
		await expect(requestInvitation("inspect", TOKEN, AbortSignal.abort())).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
	});
	it("aborts on its bounded deadline and clears its timer", async () => {
		vi.useFakeTimers(); const fetcher = vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(Error("cancelled")), { once: true }))); vi.stubGlobal("fetch", fetcher);
		const result = requestInvitation("inspect", TOKEN, new AbortController().signal); const rejection = expect(result).rejects.toThrow("Invitation unavailable.");
		await vi.advanceTimersByTimeAsync(8000); await rejection; expect(vi.getTimerCount()).toBe(0);
	});
});
