import type { Parameter } from "@aws-sdk/client-cloudformation";
import { DemoCleanupError, parseDemoCleanupConfig, type DemoCleanupConfig } from "./demoCleanup";

export interface DemoGuardInput { cleanup: DemoCleanupConfig; hostedZoneId: string; appDomain: string }
export function demoGuardParameters(input: DemoGuardInput, now: number): Parameter[] {
	const config = parseDemoCleanupConfig(JSON.stringify(input.cleanup));
	if (!Number.isSafeInteger(now) || config.expiresAt % 1000 !== 0 || config.expiresAt <= now + 300000 || config.expiresAt > now + 7200000
		|| input.hostedZoneId.trim() !== input.hostedZoneId || !/^Z[A-Z0-9]{6,32}$/.test(input.hostedZoneId) || input.appDomain !== "apps.smart-deploy.xyz") throw new DemoCleanupError();
	const published = config.runtimes.filter(row => row.environment === "published"); const preview = config.runtimes.find(row => row.environment === "preview");
	if (!preview) throw new DemoCleanupError();
	const values: Record<string, string> = { DemoId: config.demoId, AppId: config.appId, PublishedBinding: published[0].bindingId,
		PreviewBinding: preview.bindingId, PublishedRuntimeV1: published[0].runtimeId, PublishedRuntimeV2: published[1].runtimeId,
		PreviewRuntime: preview.runtimeId, WorkerInstanceId: config.workerInstanceId, WorkerEniId: config.workerEniId, ClusterName: config.clusterName,
		HostedZoneId: input.hostedZoneId, AppDomain: input.appDomain, ExpiresAt: String(config.expiresAt),
		CleanupStartUtc: new Date(config.expiresAt).toISOString().replace(".000Z", "Z"),
		CleanupEndUtc: new Date(config.expiresAt + 1800000).toISOString().replace(".000Z", "Z"),
	};
	return Object.entries(values).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue }));
}
