import { createGatewayServiceCredential } from "../../src/lib/apps/gatewayServiceAuth";
import type { ExpectedPilotRuntime } from "../../src/lib/aws/pilotRuntimeSchema";
import type { RuntimeControlSettings } from "../../src/lib/apps/runtimeControlSettings";
import { gatewayCertificate } from "./gatewayCertificate";

export const CONTROL_APP = "11111111-1111-4111-8111-111111111111";
export const CONTROL_REQUEST = "99999999-9999-4999-8999-999999999999";
export async function runtimeControlFixture() {
	const materials: Awaited<ReturnType<typeof gatewayCertificate>>[] = [];
	const keys = [createGatewayServiceCredential(), createGatewayServiceCredential(), createGatewayServiceCredential()];
	const scope = { accountId: "111122223333", region: "us-west-2", clusterName: "pilot", privateDomain: "apps.example.test", vpcId: "vpc-11111111", subnetIds: ["subnet-11111111"],
		gatewayGroupId: "sg-11111111", gatewayEniId: "eni-11111111", gatewayInstanceId: "i-11111111", tlsImage: "111122223333.dkr.ecr.us-west-2.amazonaws.com/pilot/tls@sha256:" + "a".repeat(64), timeoutMs: 2000, maxPending: 1 };
	const targets: RuntimeControlSettings["targets"] = [];
	try {
		for (let index = 0; index < 3; index++) {
			const digit = String(index + 2);
			const expected: ExpectedPilotRuntime = { appId: CONTROL_APP, bindingId: index === 2 ? "33333333-3333-4333-8333-333333333333" : "22222222-2222-4222-8222-222222222222",
				releaseId: `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
				runtimeId: `${digit.repeat(8)}-aaaa-4aaa-8aaa-${digit.repeat(12)}`, environment: index === 2 ? "preview" : "published",
				taskArn: `arn:aws:ecs:us-west-2:111122223333:task/pilot/${digit.repeat(32)}`, taskDefinitionArn: `arn:aws:ecs:us-west-2:111122223333:task-definition/pilot-notes-${index}:1`,
				executionRoleArn: "arn:aws:iam::111122223333:role/pilot-execution", appGroupId: index === 2 ? "sg-33333333" : "sg-22222222",
				appImage: "111122223333.dkr.ecr.us-west-2.amazonaws.com/pilot/notes@sha256:" + "b".repeat(64), appPort: 3000, originPort: 8443 };
			const material = await gatewayCertificate({ bindingId: expected.bindingId, environment: expected.environment, releaseId: expected.releaseId }); materials.push(material);
			targets.push({ expected, credentialId: keys[index].id, certificatePem: material.cert, label: "Notes " + (index + 1) });
		}
		return { settings: { scope, appId: CONTROL_APP, expiresAt: Math.floor(Date.now() / 1000) * 1000 + 120000, targets } satisfies RuntimeControlSettings, materials, keys,
			dispose: async () => { for (const material of materials) await material.dispose(); } };
	} catch (error) { for (const material of materials) await material.dispose(); throw error; }
}
