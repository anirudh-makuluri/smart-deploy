import { isIPv4 } from "node:net";
import { z } from "zod";
import { RuntimeScope } from "../apps/runtimeMetadata";

const GroupId = z.string().regex(/^sg-[a-f0-9]{8}(?:[a-f0-9]{9})?$/);
const EniId = z.string().regex(/^eni-[a-f0-9]{8}(?:[a-f0-9]{9})?$/);
export const PilotRuntimeScope = RuntimeScope.extend({
	vpcId: z.string().regex(/^vpc-[a-f0-9]{8}(?:[a-f0-9]{9})?$/),
	subnetIds: z.array(z.string().regex(/^subnet-[a-f0-9]{8}(?:[a-f0-9]{9})?$/)).min(1).max(3),
	gatewayGroupId: GroupId, gatewayEniId: EniId,
	gatewayInstanceId: z.string().regex(/^i-[a-f0-9]{8}(?:[a-f0-9]{9})?$/),
	tlsImage: z.string().max(2048), timeoutMs: z.number().int().min(1).max(5000), maxPending: z.number().int().min(1).max(4),
});
export type PilotRuntimeScope = z.infer<typeof PilotRuntimeScope>;
export const ExpectedPilotRuntime = z.strictObject({
	appId: z.uuid(), bindingId: z.uuid(), releaseId: z.uuid(), runtimeId: z.uuid(), environment: z.enum(["preview", "published"]),
	taskArn: z.string().max(512), taskDefinitionArn: z.string().max(512), executionRoleArn: z.string().max(512),
	appGroupId: GroupId, appImage: z.string().max(2048), appPort: z.number().int().min(1).max(65535),
	originPort: z.number().int().min(1).max(65535),
});
export type ExpectedPilotRuntime = z.infer<typeof ExpectedPilotRuntime>;
export interface PilotRuntimeObservation {
	taskArn: string; taskDefinitionArn: string; networkInterfaceId: string; privateIp: string; subnetId: string; port: number;
	appImageDigest: string; tlsImageDigest: string; observedAt: Date;
}
export class PilotRuntimeVerificationError extends Error {
	constructor(public readonly status: 409 | 503) { super("Private app runtime verification unavailable."); }
}
export function requirePilotEvidence(condition: unknown): asserts condition {
	if (!condition) throw new PilotRuntimeVerificationError(409);
}
export function pilotImageDigest(scope: RuntimeScope, image: string): string {
	const prefix = `${scope.accountId}.dkr.ecr.${scope.region}.amazonaws.com/`;
	const match = /^([a-z0-9]+(?:[._/-]+[a-z0-9]+)*)@(sha256:[a-f0-9]{64})$/.exec(image.slice(prefix.length));
	requirePilotEvidence(image.startsWith(prefix) && match); return match[2];
}
export function pilotRuntimeTags(input: ExpectedPilotRuntime): Record<string, string> {
	return { "smartdeploy:app-id": input.appId, "smartdeploy:binding-id": input.bindingId, "smartdeploy:environment": input.environment,
		"smartdeploy:release-id": input.releaseId, "smartdeploy:runtime-id": input.runtimeId };
}
export function requirePilotTags(tags: { key: string | undefined; value: string | undefined }[], expected: Record<string, string>): void {
	for (const [key, value] of Object.entries(expected)) {
		const found = tags.filter((tag) => tag.key === key); requirePilotEvidence(found.length === 1 && found[0].value === value);
	}
}
export function requirePilotPrivateIp(ip: string | undefined): asserts ip is string {
	requirePilotEvidence(ip && isIPv4(ip)); const [first, second] = ip.split(".").map(Number);
	requirePilotEvidence(first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168));
}
export function validatePilotExpectation(scope: PilotRuntimeScope, input: ExpectedPilotRuntime): void {
	const ecsPrefix = `arn:aws:ecs:${scope.region}:${scope.accountId}:`;
	requirePilotEvidence(input.taskArn.startsWith(ecsPrefix + `task/${scope.clusterName}/`)
		&& /^[a-f0-9]{32}$/.test(input.taskArn.slice((ecsPrefix + `task/${scope.clusterName}/`).length)));
	requirePilotEvidence(input.taskDefinitionArn.startsWith(ecsPrefix + "task-definition/")
		&& /^[A-Za-z0-9_-]{1,255}:[1-9]\d*$/.test(input.taskDefinitionArn.slice((ecsPrefix + "task-definition/").length)));
	requirePilotEvidence(input.executionRoleArn.startsWith(`arn:aws:iam::${scope.accountId}:role/`)
		&& /^[A-Za-z0-9_+=,.@/-]+$/.test(input.executionRoleArn.slice(`arn:aws:iam::${scope.accountId}:role/`.length)));
	requirePilotEvidence(input.appGroupId !== scope.gatewayGroupId && input.appPort !== input.originPort);
	pilotImageDigest(scope, input.appImage); pilotImageDigest(scope, scope.tlsImage);
}
