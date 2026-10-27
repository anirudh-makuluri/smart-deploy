const ADDRESS = Object.freeze({ collection: "team-notes", id: "shared" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class NotesRequestError extends Error {
  constructor(status) { super("Saved note could not be confirmed."); this.status = status; }
}
export async function noteRequest(operation, signal) {
  const response = await fetch("/__smartdeploy/documents", { method: "POST", mode: "same-origin", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...ADDRESS, ...operation }), signal });
  if (!response.ok) throw new NotesRequestError(response.status);
  const text = await response.text(); if (new TextEncoder().encode(text).length > 32768) throw new NotesRequestError(503);
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || !Object.hasOwn(value, "document")) throw new NotesRequestError(503);
  if (value.document === null && operation.action === "get") return { text: "", version: null };
  const row = value.document;
  if (!row || row.collection !== ADDRESS.collection || row.id !== ADDRESS.id || !UUID.test(row.version) || typeof row.json !== "string" || new TextEncoder().encode(row.json).length > 8192) throw new NotesRequestError(503);
  const note = JSON.parse(row.json);
  if (!note || typeof note !== "object" || Object.keys(note).length !== 1 || typeof note.text !== "string" || note.text.length > 1800) throw new NotesRequestError(503);
  if (operation.action === "put" && JSON.stringify(note) !== operation.json) throw new NotesRequestError(503);
  return { text: note.text, version: row.version };
}

/** No browser credentials, app scope, optimistic success or automatic write retries. */
export function mountNotebook(root) {
  const field = root.querySelector("#note"), save = root.querySelector("#save"), reload = root.querySelector("#reload"), status = root.querySelector("#status");
  if (!(field instanceof HTMLTextAreaElement) || !(save instanceof HTMLButtonElement) || !(reload instanceof HTMLButtonElement) || !status) throw Error("Notebook controls unavailable.");
  let version = null, pending = false, confirmed = false, retired = false;
  const lifetime = new AbortController();
  function controls() { save.disabled = pending || !confirmed || retired; reload.disabled = pending || retired; field.disabled = pending || retired || !confirmed; }
  async function perform(action) {
    if (pending || retired || (action === "put" && !confirmed)) return;
    const json = JSON.stringify({ text: field.value });
    if (action === "put" && (field.value.length > 1800 || new TextEncoder().encode(json).length > 8192)) { status.textContent = "Keep the note within 1,800 characters."; return; }
    pending = true; controls(); status.textContent = action === "put" ? "Saving the note…" : "Loading the saved note…";
    const controller = new AbortController(); const stop = () => controller.abort(); lifetime.signal.addEventListener("abort", stop, { once: true }); const timer = setTimeout(stop, 7000);
    try {
      const result = await noteRequest(action === "get" ? { action } : { action, json, expectedVersion: version }, controller.signal);
      controller.signal.throwIfAborted(); if (retired) return;
      version = result.version; field.value = result.text; confirmed = true; status.textContent = action === "put" ? "Saved. Your note will stay through the next release." : result.version ? "Loaded the saved note." : "No saved note yet. Start one for your team.";
    } catch (error) {
      if (retired) return;
      confirmed = false;
      if (error instanceof NotesRequestError && [401, 403].includes(error.status)) { retired = true; field.value = ""; status.textContent = "App access is unavailable. Open the app again with an authorized account."; }
      else status.textContent = error instanceof NotesRequestError && error.status === 409 ? "The saved note changed. Reload it before saving again." : "The request could not be confirmed and may have completed. Reload the saved note before trying again.";
    } finally { clearTimeout(timer); lifetime.signal.removeEventListener("abort", stop); pending = false; controls(); }
  }
  const onSave = () => { void perform("put"); }, onReload = () => { void perform("get"); };
  save.addEventListener("click", onSave); reload.addEventListener("click", onReload);
  return { ready: perform("get"), close() { retired = true; lifetime.abort(); save.removeEventListener("click", onSave); reload.removeEventListener("click", onReload); field.value = ""; controls(); } };
}
if (typeof document !== "undefined") { const root = document.querySelector("#notebook"); if (root) { const notebook = mountNotebook(root); window.addEventListener("pagehide", () => notebook.close(), { once: true }); } }
