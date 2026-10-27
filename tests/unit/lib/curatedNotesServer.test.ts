import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNotesServer } from "../../../demo/notes/server.mjs";
let server: Awaited<ReturnType<typeof createNotesServer>>;
let origin: string;
beforeAll(async () => { server = await createNotesServer("v2"); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw Error("No loopback fixture."); origin = `http://127.0.0.1:${address.port}`; });
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
describe("actual curated notes HTTP process surface", () => {
  it("labels the curated release and serves only local scripts/styles with restrictive headers", async () => {
    const page = await fetch(origin); expect(page.status).toBe(200); const html = await page.text(); expect(html).toContain('class="release">v2'); expect(html).toContain("curated architecture demo"); expect(html).not.toContain("{{RELEASE}}");
    expect(page.headers.get("content-security-policy")).toContain("connect-src 'self'"); expect(page.headers.get("cache-control")).toContain("no-store"); expect(page.headers.get("set-cookie")).toBeNull();
    for (const asset of ["/client.js", "/style.css"]) expect((await fetch(origin + asset)).status).toBe(200);
  });
  it("leaves document POSTs to the gateway instead of accepting data or authentication", async () => {
    const response = await fetch(origin + "/__smartdeploy/documents", { method: "POST", body: "private-note" }); expect(response.status).toBe(405); expect(await response.text()).toBe("");
    expect((await fetch(origin + "/.env")).status).toBe(404); expect((await fetch(origin + "/../server.mjs")).status).toBe(404);
  });
  it("provides local readiness metadata and an empty HEAD without accepting arbitrary release labels", async () => {
    expect(await (await fetch(origin + "/health")).json()).toEqual({ ok: true, release: "v2" }); expect(await (await fetch(origin, { method: "HEAD" })).text()).toBe(""); await expect(createNotesServer("<script>secret</script>")).rejects.toThrow("Notes demo unavailable.");
  });
});
