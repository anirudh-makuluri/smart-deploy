import { X509Certificate } from "node:crypto";
import { z } from "zod";
import { GatewayUpstreamTls } from "../gateway/upstreamTls";
import { WorkspaceError } from "./workspaceStore";
import type { AppEnvironment } from "./types";

export const RuntimeScope = z.strictObject({
	accountId: z.string().regex(/^\d{12}$/), region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/),
	clusterName: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/), privateDomain: z.string().max(200).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
});
export type RuntimeScope = z.infer<typeof RuntimeScope>;
export const RuntimeRegistrationInput = z.strictObject({
	id: z.uuid(), bindingId: z.uuid(), releaseId: z.uuid(), credentialId: z.uuid(),
	taskArn: z.string().max(512), privateIp: z.string(), port: z.number().int().min(1).max(65535),
	certificatePem: z.string().min(1).max(8192), observedImageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	expectedSourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export type RuntimeRegistrationInput = z.infer<typeof RuntimeRegistrationInput>;
export interface RuntimeBinding { id: string; appId: string; workspaceId: string; origin: string; environment: AppEnvironment; managed: boolean }
export interface RuntimeSource {
	id: string; appId: string | null; workspaceId: string | null; repoName: string; serviceName: string; commitSha: string | null;
	success: boolean | null; finishedAt: Date | null; artifact: unknown;
}
export interface AppRuntime {
	id: string; appId: string; workspaceId: string; bindingId: string; environment: AppEnvironment; releaseId: string;
	deploymentId: string; credentialId: string; taskArn: string; privateIp: string; port: number; certificatePem: string;
	registeredAt: Date; retiredAt: Date | null;
}
export interface AppRuntimeRoute { runtimeId: string; generation: number }
export interface RuntimeReleasePreflight {
	binding: RuntimeBinding; releaseId: string; deploymentId: string; imageReference: string; imageDigest: string; sourceFingerprint: string;
}
const Digest = /^sha256:[a-f0-9]{64}$/;
const Artifact = z.looseObject({
	kind: z.literal("ecr_image"), cloudProvider: z.literal("aws"), deploymentTarget: z.literal("ecs"), region: z.string(),
	ecrRegistry: z.string(), ecrRepoName: z.string().min(1).max(256).regex(/^[a-z0-9]+(?:[._/-]+[a-z0-9]+)*$/),
	imageUri: z.string().max(2048), imageDigest: z.string().regex(Digest),
	deployConfig: z.looseObject({ id: z.string().min(1).max(2000), repoName: z.string(), serviceName: z.string(), commitSha: z.string().regex(/^[a-f0-9]{40}$/), cloudProvider: z.literal("aws"), deploymentTarget: z.literal("ecs"), region: z.string() }),
});

export function privateRuntimeOrigin(bindingId: string, scope: RuntimeScope): string {
	return `https://${z.uuid().parse(bindingId).toLowerCase()}.${RuntimeScope.parse(scope).privateDomain}`;
}
export function runtimeCredentialParameter(bindingId: string, runtimeId: string): string {
	return `/smartdeploy/pilot/gateways/${z.uuid().parse(bindingId).toLowerCase()}/${z.uuid().parse(runtimeId).toLowerCase()}`;
}

/** Validate a snapshot, never clone its config/secrets into another environment. */
export function runtimeReleaseSource(source: RuntimeSource, binding: RuntimeBinding, scope: RuntimeScope): { deploymentId: string; imageReference: string; imageDigest: string } {
	const parsed = Artifact.safeParse(source.artifact);
	if (!parsed.success || source.success !== true || !source.finishedAt || source.appId !== binding.appId || source.workspaceId !== binding.workspaceId) throw new WorkspaceError(409, "A matching successful AWS/ECS release is required.");
	const artifact = parsed.data; const snapshot = artifact.deployConfig;
	if (artifact.region !== scope.region || snapshot.region !== scope.region || snapshot.repoName !== source.repoName
		|| snapshot.serviceName !== source.serviceName || snapshot.commitSha !== source.commitSha) throw new WorkspaceError(409, "Release source does not match its deployment.");
	const registry = `${scope.accountId}.dkr.ecr.${scope.region}.amazonaws.com`; const base = `${registry}/${artifact.ecrRepoName}`;
	const suffix = artifact.imageUri.slice(base.length);
	if (artifact.ecrRegistry !== registry || !artifact.imageUri.startsWith(base)
		|| !(suffix === "@" + artifact.imageDigest || /^:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(suffix))) throw new WorkspaceError(409, "A pinned image in the configured AWS registry is required.");
	return { deploymentId: snapshot.id, imageReference: base + "@" + artifact.imageDigest, imageDigest: artifact.imageDigest };
}

/** Caller must verify actual ECS task/ENI/SG/container evidence before registration.
 * This validates metadata consistency, not AWS state or network reachability. */
export function runtimeEndpoint(input: RuntimeRegistrationInput, binding: RuntimeBinding, scope: RuntimeScope): RuntimeRegistrationInput {
	const parsed = RuntimeRegistrationInput.safeParse(input);
	if (!parsed.success || !binding.managed || input.bindingId.toLowerCase() !== binding.id.toLowerCase() || binding.origin !== privateRuntimeOrigin(binding.id, scope)) throw new WorkspaceError(409, "A fresh managed private binding is required.");
	const prefix = `arn:aws:ecs:${scope.region}:${scope.accountId}:task/${scope.clusterName}/`;
	if (!input.taskArn.startsWith(prefix) || !/^[a-f0-9]{32}$/.test(input.taskArn.slice(prefix.length))) throw new WorkspaceError(409, "Task does not belong to the configured AWS cluster.");
	try {
		new GatewayUpstreamTls({ bindingId: binding.id, environment: binding.environment, releaseId: input.releaseId,
			privateIp: input.privateIp, port: input.port, certificatePem: input.certificatePem, timeoutMs: 5000, maxConnections: 1 });
		return { ...parsed.data, certificatePem: new X509Certificate(input.certificatePem).toString() };
	} catch { throw new WorkspaceError(409, "Workload TLS identity and private address are required."); }
}
