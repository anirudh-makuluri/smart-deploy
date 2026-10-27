import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { expect, it } from "vitest";
import { demoWorkerDatabaseUrl } from "@/lib/apps/privateDemoWorker";
import { gatewayCertificate } from "../../helpers/gatewayCertificate";

it("forces the real pg client to use the operator CA and hostname verification despite URL overrides", async () => {
  const material = await gatewayCertificate({ bindingId: "11111111-1111-4111-8111-111111111111", environment: "preview", releaseId: "22222222-2222-4222-8222-222222222222" });
  const directory = await mkdtemp(path.join(tmpdir(), "smartdeploy-demo-auth-ca-")); const caFile = path.join(directory, "ca.pem");
  try {
    await writeFile(caFile, material.cert);
    const value = demoWorkerDatabaseUrl("postgres://fixture:local-only@pooler.example.test/platform?sslmode=no-verify&sslrootcert=missing.pem&sslcert=missing-client.pem&uselibpqcompat=true&application_name=demo", caFile);
    const url = new URL(value); expect(url.searchParams.get("sslmode")).toBe("verify-full"); expect(url.searchParams.get("sslrootcert")).toBe(caFile);
    expect(url.searchParams.has("sslcert")).toBe(false); expect(url.searchParams.has("uselibpqcompat")).toBe(false); expect(url.searchParams.get("application_name")).toBe("demo");
    const client = new Client({ connectionString: value });
    expect(client.ssl).toMatchObject({ ca: material.cert }); expect(client.ssl).not.toHaveProperty("rejectUnauthorized", false); expect(client.ssl).not.toHaveProperty("checkServerIdentity");
  } finally { await unlink(caFile); await rmdir(directory); await material.dispose(); }
});
it.each(["https://pooler.example.test/platform", "postgres://pooler.example.test/platform", "postgres://fixture@pooler.example.test/"])("rejects invalid database configuration (%s)", value => {
  expect(() => demoWorkerDatabaseUrl(value, path.resolve("ca.pem"))).toThrow();
});
it("rejects relative CA paths", () => { expect(() => demoWorkerDatabaseUrl("postgres://fixture@pooler.example.test/platform", "ca.pem")).toThrow(); });
