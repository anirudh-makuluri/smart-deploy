import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountNotebook, noteRequest } from "../../../demo/notes/client.js";
const VERSION = "a26441db-af38-4ace-a464-c68d2b190f69";
const documents = (text: string) => ({ document: { collection: "team-notes", id: "shared", version: VERSION, json: JSON.stringify({ text }) } });
const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
let notebook: ReturnType<typeof mountNotebook> | null;
beforeEach(() => { document.body.innerHTML = '<main id="fixture"><textarea id="note"></textarea><button id="save">Save note</button><button id="reload">Reload saved note</button><p id="status" role="status"></p></main>'; notebook = null; });
afterEach(() => { notebook?.close(); document.body.innerHTML = ""; vi.restoreAllMocks(); });
const field = () => document.querySelector("textarea")!;
const save = () => document.querySelector<HTMLButtonElement>("#save")!;
const reload = () => document.querySelector<HTMLButtonElement>("#reload")!;
function mount() { notebook = mountNotebook(document.querySelector("#fixture")!); return notebook; }
describe("curated persistent notebook", () => {
  it("loads only the same-origin document broker without browser identity or cloud credentials", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(documents("Keep this through v2"))); await mount().ready;
    expect(field().value).toBe("Keep this through v2"); expect(save()).toBeEnabled();
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/__smartdeploy/documents", { method: "POST", mode: "same-origin", credentials: "same-origin", cache: "no-store", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collection: "team-notes", id: "shared", action: "get" }), signal: expect.any(AbortSignal) });
  });
  it("writes only after a click with the last confirmed document version", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(documents("Before"))).mockResolvedValueOnce(reply(documents("After"))); await mount().ready;
    field().value = "After"; save().click(); await vi.waitFor(() => expect(document.querySelector("#status")).toHaveTextContent("Saved."));
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({ collection: "team-notes", id: "shared", action: "put", json: JSON.stringify({ text: "After" }), expectedVersion: VERSION }); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("creates the first note with a null precondition after an observed empty read", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply({ document: null })).mockResolvedValueOnce(reply(documents("First"))); await mount().ready; field().value = "First"; save().click(); await vi.waitFor(() => expect(save()).toBeEnabled()); expect(JSON.parse(fetch.mock.calls[1][1]!.body as string).expectedVersion).toBeNull();
  });
  it.each([409, 503])("preserves the draft and blocks another save after status %i until an explicit reload", async status => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(documents("Original"))).mockResolvedValueOnce(new Response("provider-secret", { status })).mockResolvedValueOnce(reply(documents("Observed")));
    await mount().ready; field().value = "Unsaved draft"; save().click(); await vi.waitFor(() => expect(reload()).toBeEnabled());
    expect(save()).toBeDisabled(); expect(field().value).toBe("Unsaved draft"); expect(document.body.textContent).not.toContain("provider-secret"); save().click(); expect(fetch).toHaveBeenCalledTimes(2);
    reload().click(); await vi.waitFor(() => expect(save()).toBeEnabled()); expect(field().value).toBe("Observed"); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each([401, 403])("clears the note and retires controls when access is denied with %i", async status => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(documents("Private"))).mockResolvedValueOnce(new Response("", { status })); await mount().ready; save().click(); await vi.waitFor(() => expect(document.querySelector("#status")).toHaveTextContent("App access is unavailable")); expect(field().value).toBe(""); expect(save()).toBeDisabled(); expect(reload()).toBeDisabled();
  });
  it("rejects a malformed or unrelated write receipt and never reports optimistic success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(documents("Original"))).mockResolvedValueOnce(reply(documents("Different"))); await mount().ready; field().value = "Draft"; save().click(); await vi.waitFor(() => expect(reload()).toBeEnabled()); expect(save()).toBeDisabled(); expect(field().value).toBe("Draft"); expect(document.querySelector("#status")).toHaveTextContent("may have completed");
  });
  it("does not accept a delayed read after page retirement", async () => {
    let finish = (_response: Response) => {}; vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>(resolve => { finish = resolve; })); const active = mount(); active.close(); finish(reply(documents("Late private note"))); await active.ready; expect(field().value).toBe(""); expect(save()).toBeDisabled();
  });
  it("bounds note length before transmitting a save", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply({ document: null })); await mount().ready; field().value = "x".repeat(1801); save().click(); await vi.waitFor(() => expect(document.querySelector("#status")).toHaveTextContent("1,800")); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ document: null }, { document: {} }, { document: { ...documents("Text").document, id: "other" } }, { document: { ...documents("Text").document, version: "bad" } }])("rejects invalid or foreign write responses", async value => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(value)); await expect(noteRequest({ action: "put", json: JSON.stringify({ text: "Text" }), expectedVersion: null }, new AbortController().signal)).rejects.toThrow();
  });
});
