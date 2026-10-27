import { z } from "zod";
import { ExpectedPilotRuntime, PilotRuntimeScope, validatePilotExpectation } from "../aws/pilotRuntimeSchema";
import { privateRuntimeOrigin, type RuntimeScope } from "./runtimeMetadata";
import { GatewayUpstreamTls } from "../gateway/upstreamTls";

const Target = z.strictObject({ expected: ExpectedPilotRuntime, credentialId: z.uuid(), certificatePem: z.string().min(1).max(8192), label: z.string().min(1).max(80) });
export type RuntimeControlTarget = z.infer<typeof Target>;
export function runtimeControlScope(scope: PilotRuntimeScope): RuntimeScope {
	return { accountId: scope.accountId, region: scope.region, clusterName: scope.clusterName, privateDomain: scope.privateDomain };
}
export const RuntimeControlSettings = z.strictObject({ scope: PilotRuntimeScope, appId: z.uuid(), expiresAt: z.number().int().positive(), targets: z.array(Target).length(3) }).superRefine((value, context) => {
	const expected = value.targets.map(target => target.expected); const published = expected.filter(target => target.environment === "published"); const preview = expected.filter(target => target.environment === "preview");
	const unique = (field: "runtimeId" | "releaseId" | "taskArn") => new Set(expected.map(target => target[field])).size === 3;
	if (published.length !== 2 || preview.length !== 1 || published[0].bindingId !== published[1].bindingId || published[0].bindingId === preview[0].bindingId
		|| expected.some(target => target.appId !== value.appId) || !unique("runtimeId") || !unique("releaseId") || !unique("taskArn") || new Set(value.targets.map(target => target.credentialId)).size !== 3) context.addIssue({ code: "custom", message: "An isolated three-runtime pilot catalog is required." });
	for (const target of value.targets) {
		try {
			validatePilotExpectation(value.scope, target.expected);
			new GatewayUpstreamTls({ bindingId: target.expected.bindingId, environment: target.expected.environment, releaseId: target.expected.releaseId,
				privateIp: "10.0.0.1", port: target.expected.originPort, certificatePem: target.certificatePem, timeoutMs: 2000, maxConnections: 1 });
			privateRuntimeOrigin(target.expected.bindingId, runtimeControlScope(value.scope));
		} catch { context.addIssue({ code: "custom", message: "Invalid trusted runtime expectation." }); }
	}
});
export type RuntimeControlSettings = z.infer<typeof RuntimeControlSettings>;
