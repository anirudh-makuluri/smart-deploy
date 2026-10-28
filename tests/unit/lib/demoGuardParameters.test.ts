import { describe, expect, it } from "vitest";
import { demoGuardParameters, type DemoGuardInput } from "@/lib/aws/demoGuardParameters";
import { buildDemoGuardTemplate } from "../../../scripts/build-demo-guard.mjs";
import { CleanupWorkflowFixture, resolvedCleanupWorkflow } from "../../helpers/cleanupWorkflow";

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
		const workflow = resolvedCleanupWorkflow(substitutions); workflow.StartAt = "Initialize";
		workflow.States.Initialize.End = true; delete workflow.States.Initialize.Next;
		const fixture = new CleanupWorkflowFixture(async () => { throw Error("Unexpected AWS call"); });
		const output = await fixture.run(workflow) as { config: { expiresAt: number; workerInstanceId: string; workerEniId: string; parameters: string[] } };
		expect(output.config).toMatchObject({ expiresAt: config.cleanup.expiresAt, workerInstanceId: config.cleanup.workerInstanceId, workerEniId: config.cleanup.workerEniId });
		expect(output.config.parameters).toEqual(config.cleanup.runtimes.flatMap(row => [`/smartdeploy/pilot/gateways/${row.bindingId}/${row.runtimeId}`, `/smartdeploy/pilot/workloads/${row.bindingId}/${row.runtimeId}/tls-key`]));
		expect(Object.keys(values).sort()).toEqual(Object.keys(template.Parameters).sort());
	});
	it("evaluates the resolved native graph up to its durable expiry wait without AWS calls", async () => {
		const now = Date.now(); const config = input(); config.cleanup.expiresAt = Math.ceil((now + 600000) / 1000) * 1000;
		const values = Object.fromEntries(demoGuardParameters(config, now).map(row => [row.ParameterKey, row.ParameterValue]));
		const substitutions: Record<string, string> = { ...values, "AWS::Region": config.cleanup.region, "AWS::AccountId": config.cleanup.accountId };
		let requests = 0; const fixture = new CleanupWorkflowFixture(async () => { requests++; throw Error("Unexpected AWS call"); });
		fixture.now = now; fixture.pauseAtFirstWait = true;
		await expect(fixture.run(resolvedCleanupWorkflow(substitutions))).rejects.toThrow("WaitingForExpiry");
		expect(requests).toBe(0); expect(fixture.now).toBeLessThan(config.cleanup.expiresAt);
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
