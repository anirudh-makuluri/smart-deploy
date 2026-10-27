import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gatewayDatabaseOptions, gatewayFile, gatewayServerFiles } from "@/lib/gateway/serverConfig";
import { gatewayCertificate } from "../../helpers/gatewayCertificate";

let material: Awaited<ReturnType<typeof gatewayCertificate>>;
let directory: string;
const files: string[] = [];
async function file(name: string, contents: string | Buffer) { const target = path.join(directory, name); files.push(target); await writeFile(target, contents); return target; }
beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), "smartdeploy-gateway-server-")); material = await gatewayCertificate({ bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac", environment: "published", releaseId: "997a2326-5b9b-4c08-aaef-45c618db01d3" }); });
afterAll(async () => { for (const name of files) await unlink(name); await rmdir(directory); await material.dispose(); });
describe("gateway operator configuration", () => {
	it("requires verified DB TLS while preserving non-SSL connection options", () => {
		const options = gatewayDatabaseOptions("postgres://fixture:local-only@db.example.test/platform?sslmode=no-verify&sslrootcert=untrusted&ssl=false&uselibpqcompat=true&application_name=fixture", material.cert);
		const url = new URL(String(options.connectionString)); expect([...url.searchParams.keys()]).toEqual(["application_name"]);
		expect(options).toMatchObject({ ssl: { ca: material.cert, rejectUnauthorized: true, minVersion: "TLSv1.2" }, max: 2, connectionTimeoutMillis: 1500, query_timeout: 2200, statement_timeout: 2000 });
	});
	it.each(["https://db.example.test/platform", "postgres://db.example.test/platform", "postgres://fixture@db.example.test/"])("rejects an invalid database URL", value => {
		expect(() => gatewayDatabaseOptions(value, material.cert)).toThrow("Private app gateway configuration unavailable.");
	});
	it("rejects invalid CA material", () => { expect(() => gatewayDatabaseOptions("postgres://fixture@db.example.test/platform", "not a CA")).toThrow(); });
	it("bounds actual file bytes and rejects relative paths, empty files and directories", async () => {
		expect((await gatewayFile(await file("exact", "1234"), 4)).toString()).toBe("1234");
		await expect(gatewayFile(await file("large", "12345"), 4)).rejects.toThrow(); await expect(gatewayFile(await file("empty", ""), 4)).rejects.toThrow();
		await expect(gatewayFile("relative.json", 4)).rejects.toThrow(); await expect(gatewayFile(directory, 4)).rejects.toThrow();
	});
	it("loads only explicit operator settings and matching key/certificate files", async () => {
		const key = await file("gateway.key", material.key); const cert = await file("gateway.pem", material.cert);
		const settings = { gateway: { scope: { accountId: "111122223333", region: "us-west-2", clusterName: "pilot", privateDomain: "apps.example.test" },
			appId: "9d888612-4141-4402-bbfd-23736a11bd46", environment: "published", platformOrigin: "https://control.test", documentsEnabled: true,
			timeoutMs: 1000, controlTimeoutMs: 1000, limits: { maxConnections: 2, maxRequestBytes: 32768, maxResponseBytes: 32768, timeoutMs: 5000, idleMs: 1000 } },
			timing: { refreshMs: 1000, maxAgeMs: 5000, expiresAt: Date.now() + 60000 }, address: "127.0.0.1", port: 8444,
			tlsKeyFile: key, tlsCertificateFile: cert, databaseCaFile: cert };
		const config = await file("gateway.json", JSON.stringify(settings)); expect((await gatewayServerFiles(config)).settings).toEqual(settings);
		await expect(gatewayServerFiles(await file("unknown.json", JSON.stringify({ ...settings, serviceCredential: "not allowed here" })))).rejects.toThrow();
		await expect(gatewayServerFiles(await file("wrong-key.json", JSON.stringify({ ...settings, tlsKeyFile: cert })))).rejects.toThrow();
	});
});
