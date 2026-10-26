import { z } from "zod";
import { privateRuntimeOrigin, RuntimeScope, runtimeCredentialParameter, type CurrentAppRuntime } from "../apps/runtimeMetadata";
import { secureOrigin } from "./controlClient";
import { GatewayHttpLimits } from "./httpLease";
import { GatewayUpstreamTls, type GatewayUpstreamOptions } from "./upstreamTls";

export const ManagedGatewayOptions = z.strictObject({
	scope: RuntimeScope, appId: z.uuid(), environment: z.enum(["preview", "published"]),
	platformOrigin: z.string(), documentsEnabled: z.boolean(), timeoutMs: z.number().int().min(1).max(5000),
	controlTimeoutMs: z.number().int().min(1).max(5000), limits: GatewayHttpLimits,
});
export type ManagedGatewayOptions = z.infer<typeof ManagedGatewayOptions>;
export class ManagedGatewayError extends Error {
	constructor() { super("Private app gateway configuration unavailable."); }
}
const Current = z.object({ id: z.uuid(), runtimeId: z.uuid(), appId: z.uuid(), workspaceId: z.uuid(), bindingId: z.uuid(),
	environment: z.enum(["preview", "published"]), releaseId: z.uuid(), deploymentId: z.string().min(1).max(2000), credentialId: z.uuid(),
	taskArn: z.string().max(512), privateIp: z.string(), port: z.number().int().min(1).max(65535), certificatePem: z.string().min(1).max(8192),
	registeredAt: z.date(), retiredAt: z.null(), generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	origin: z.string(), credentialParameter: z.string(),
});

export function managedUpstream(row: CurrentAppRuntime, options: ManagedGatewayOptions): GatewayUpstreamOptions {
	try {
		const parsed = Current.parse(row);
		const taskPrefix = `arn:aws:ecs:${options.scope.region}:${options.scope.accountId}:task/${options.scope.clusterName}/`;
		if (parsed.appId !== options.appId || parsed.environment !== options.environment || parsed.runtimeId !== parsed.id
			|| parsed.origin !== privateRuntimeOrigin(parsed.bindingId, options.scope)
			|| parsed.credentialParameter !== runtimeCredentialParameter(parsed.bindingId, parsed.id)
			|| !parsed.taskArn.startsWith(taskPrefix) || !/^[a-f0-9]{32}$/.test(parsed.taskArn.slice(taskPrefix.length))
			|| secureOrigin(parsed.origin).hostname === secureOrigin(options.platformOrigin).hostname) throw new Error();
		const upstream: GatewayUpstreamOptions = { bindingId: parsed.bindingId, environment: parsed.environment, releaseId: parsed.releaseId,
			privateIp: parsed.privateIp, port: parsed.port, certificatePem: parsed.certificatePem, timeoutMs: options.timeoutMs, maxConnections: options.limits.maxConnections };
		new GatewayUpstreamTls(upstream); // Validate the registered private address and exact release certificate before secret retrieval.
		return upstream;
	} catch { throw new ManagedGatewayError(); }
}

export function managedSelection(row: CurrentAppRuntime): string {
	return JSON.stringify([row.id, row.runtimeId, row.appId, row.workspaceId, row.bindingId, row.environment, row.releaseId, row.deploymentId,
		row.credentialId, row.taskArn, row.privateIp, row.port, row.certificatePem, row.registeredAt.toISOString(), row.retiredAt,
		row.generation, row.origin, row.credentialParameter]);
}
