import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { demoGuardParameters, type DemoGuardInput } from "@/lib/aws/demoGuardParameters";
import { buildDemoGuardTemplate } from "../../../scripts/build-demo-guard.mjs";

const NOW = Date.UTC(2026, 9, 26, 16);
function input(): DemoGuardInput {
	return { hostedZoneId: "Z1234567890", appDomain: "apps.smart-deploy.xyz", cleanup: {
		accountId: "111122223333", region: "us-west-2", demoId: "8cef73997867400d9213", appId: "9d888612-4141-4402-bbfd-23736a11bd46",
		expiresAt: NOW + 7200000, clusterName: "pilot", workerInstanceId: "i-11111111", workerEniId: "eni-11111111", runtimes: [
			{ bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac", runtimeId: "997a2326-5b9b-4c08-aaef-45c618db01d3", environment: "published" },
			{ bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac", runtimeId: "91843492-f2ea-437c-a540-b144c3bc8ed2", environment: "published" },
			{ bindingId: "61502dbe-c33b-468c-8257-a904bc5b3653", runtimeId: "01567024-3f62-4ee3-bf6d-406896d1fa9b", environment: "preview" },
		],
	} };
}
describe("demo guard clock and parameter binding", () => {
	it("derives every time and resource binding from one validated manifest", async () => {
		const config = input(); const values = Object.fromEntries(demoGuardParameters(config, NOW).map(row => [row.ParameterKey, row.ParameterValue]));
		expect(values.CleanupStartUtc).toBe("2026-10-26T18:00:00Z"); expect(values.CleanupEndUtc).toBe("2026-10-26T18:30:00Z");
		const template = await buildDemoGuardTemplate(); const substitutions: Record<string, string> = { ...values, "AWS::Region": config.cleanup.region, "AWS::AccountId": config.cleanup.accountId };
		const encoded = template.Resources.CleanupFunction.Properties.Environment.Variables.DEMO_CONFIG["Fn::Sub"];
		expect(JSON.parse(encoded.replace(/\$\{([^}]+)\}/g, (_match: string, key: string) => substitutions[key]))).toEqual(config.cleanup);
		expect(Object.keys(values).sort()).toEqual(Object.keys(template.Parameters).sort());
	});
	it("executes the rendered inline CommonJS Lambda with the real local SDK and resolved environment", async () => {
		const now = Date.now(); const config = input(); config.cleanup.expiresAt = Math.ceil((now + 600000) / 1000) * 1000;
		const values = Object.fromEntries(demoGuardParameters(config, now).map(row => [row.ParameterKey, row.ParameterValue]));
		const template = await buildDemoGuardTemplate();
		const substitutions: Record<string, string> = { ...values, "AWS::Region": config.cleanup.region, "AWS::AccountId": config.cleanup.accountId };
		const env = template.Resources.CleanupFunction.Properties.Environment.Variables.DEMO_CONFIG["Fn::Sub"].replace(/\$\{([^}]+)\}/g, (_match: string, key: string) => substitutions[key]);
		const exports: { handler: (event: unknown, context: { invokedFunctionArn: string }) => Promise<unknown> } = { handler: async () => { throw Error("Missing compiled handler"); } };
		runInNewContext(template.Resources.CleanupFunction.Properties.Code.ZipFile, {
			exports, require: createRequire(path.resolve("package.json")), process: { env: { DEMO_CONFIG: env } },
			Buffer, AbortController, setTimeout, clearTimeout,
		}, { timeout: 5000 });
		expect(await exports.handler({ mode: "cleanup" }, { invokedFunctionArn: `arn:aws:lambda:us-west-2:${config.cleanup.accountId}:function:validation-only` })).toEqual({ status: "armed", worker: "not_inspected", stack: "not_inspected", loadBalancer: "not_inspected", requested: 0 });
	});
	it.each([NaN, Infinity, NOW + 0.5])("rejects an invalid admission clock", now => { expect(() => demoGuardParameters(input(), now)).toThrow(); });
	it.each([NOW, NOW + 300000, NOW + 7201000, NOW + 3600001])("rejects expired, too-short, overlong or subsecond leases", expiresAt => {
		const config = input(); config.cleanup.expiresAt = expiresAt; expect(() => demoGuardParameters(config, NOW)).toThrow();
	});
	it("rejects other domains and malformed hosted-zone identities", () => {
		expect(() => demoGuardParameters({ ...input(), appDomain: "unrelated.example.test" }, NOW)).toThrow();
		expect(() => demoGuardParameters({ ...input(), hostedZoneId: "*" }, NOW)).toThrow();
		expect(() => demoGuardParameters({ ...input(), hostedZoneId: "Z1234567890\n" }, NOW)).toThrow();
	});
});
