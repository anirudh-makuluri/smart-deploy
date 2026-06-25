import type { DeployConfig, RuntimeHealthAppEntry, RuntimeHealthState, RuntimeHealthSample } from "@/app/types";
import { dbHelper } from "@/db-helper";
import { getRuntimeAlbHealth, getRuntimeEcsHealth } from "@/lib/aws/runtimeHealthSignals";
import { isEcsCloudResources } from "@/lib/cloudResources";
import { normalizeDeploymentStatus } from "@/lib/deploymentStatus";
import { probeDeploymentHealth } from "@/lib/deploymentHealthProbe";
import { getDeploymentHostedUrl } from "@/lib/hostedUrl";
import { appendRuntimeHealthSample } from "@/lib/runtimeHealthStore";
import { emitToWorkerDeploymentRoom, emitToWorkerUserRoom } from "@/lib/workerSocketServer";
import { WORKER_SOCKET_SERVER_EVENTS } from "@/lib/workerSocketEvents";

const RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
const PROBE_COUNT = 3;
const PROBE_GAP_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;

export type ReconcileStatus = "running" | "failed";

/** Decide whether to flip status based on burst probe results (anti-flap). */
export function resolveReconciledStatus(
	storedStatus: ReconcileStatus,
	probeResults: boolean[]
): ReconcileStatus | null {
	const healthyCount = probeResults.filter(Boolean).length;
	if (storedStatus === "failed" && healthyCount >= 2) {
		return "running";
	}
	if (storedStatus === "running" && healthyCount === 0) {
		return "failed";
	}
	return null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function msUntilNextTenMinuteMark(now = new Date()): number {
	const min = now.getMinutes();
	const sec = now.getSeconds();
	const ms = now.getMilliseconds();
	const minPastDecade = min % 10;
	if (minPastDecade === 0 && sec === 0 && ms < 500) {
		return 0;
	}
	const minutesToWait = minPastDecade === 0 ? 10 : 10 - minPastDecade;
	return minutesToWait * 60_000 - sec * 1000 - ms;
}

function summarizeProbeHealth(probeResults: boolean[]): RuntimeHealthState {
	if (probeResults.length === 0) return "unknown";
	const healthyCount = probeResults.filter(Boolean).length;
	if (healthyCount === probeResults.length) return "healthy";
	if (healthyCount === 0) return "unreachable";
	return "degraded";
}

async function collectRuntimeHealthAttempts(
	baseUrl: string,
	remainingAttempts: number,
	attempts: Array<Awaited<ReturnType<typeof probeDeploymentHealth>>> = []
): Promise<Array<Awaited<ReturnType<typeof probeDeploymentHealth>>>> {
	if (remainingAttempts <= 0) {
		return attempts;
	}

	const result = await probeDeploymentHealth(baseUrl, REQUEST_TIMEOUT_MS);
	const nextAttempts = [...attempts, result];
	if (remainingAttempts === 1) {
		return nextAttempts;
	}

	await sleep(PROBE_GAP_MS);
	return collectRuntimeHealthAttempts(baseUrl, remainingAttempts - 1, nextAttempts);
}

async function buildRuntimeAppHealth(baseUrl: string): Promise<RuntimeHealthAppEntry> {
	const attempts = await collectRuntimeHealthAttempts(baseUrl, PROBE_COUNT);

	const probeResults = attempts.map((attempt) => attempt.reachable);
	const representative =
		[...attempts].reverse().find((attempt) => attempt.reachable) ??
		attempts[attempts.length - 1] ?? {
			reachable: false,
			checkedUrl: null,
			httpStatus: null,
			latencyMs: null,
		};

	return {
		checkedUrl: representative.checkedUrl,
		httpStatus: representative.httpStatus,
		latencyMs: representative.latencyMs,
		probeResults,
		overallStatus: summarizeProbeHealth(probeResults),
	};
}

function deployConfigForStatusUpdate(deployment: DeployConfig): DeployConfig {
	const { scanResults: _scanResults, ...rest } = deployment;
	return rest as DeployConfig;
}

export async function reconcileDeploymentsHealth(): Promise<void> {
	const listed = await dbHelper.listDeploymentsForHealthReconcile();
	if (listed.error) {
		console.error("[health-reconcile] failed to list deployments:", listed.error);
		return;
	}

	const deployments = listed.deployments ?? [];
	if (deployments.length === 0) {
		console.log("[health-reconcile] no running/failed deployments to check");
		return;
	}

	console.log(`[health-reconcile] checking ${deployments.length} deployment(s)`);
	let updated = 0;

	const reconcileResults = await Promise.all(
		deployments.map(async ({ deployment, ownerID }) => {
			const storedStatus = normalizeDeploymentStatus(deployment.status);
			if (storedStatus !== "running" && storedStatus !== "failed") {
				return false;
			}

			const baseUrl = getDeploymentHostedUrl(deployment);
			if (!baseUrl) {
				return false;
			}

			try {
				const appHealth = await buildRuntimeAppHealth(baseUrl);
				const probeResults = appHealth.probeResults;
				const ecsResources = isEcsCloudResources(deployment.cloudResources) ? deployment.cloudResources : null;
				const [ecsResult, albResult] = await Promise.allSettled([
					ecsResources ? getRuntimeEcsHealth(ecsResources) : Promise.resolve(null),
					ecsResources ? getRuntimeAlbHealth(ecsResources) : Promise.resolve(null),
				]);
				const healthSample: RuntimeHealthSample = {
					checkedAt: new Date().toISOString(),
					app: appHealth,
					ecs: ecsResult.status === "fulfilled" ? ecsResult.value : null,
					alb: albResult.status === "fulfilled" ? albResult.value : null,
				};

				if (ecsResult.status === "rejected") {
					console.warn(
						`[health-reconcile] failed to read ECS health for ${deployment.repoName}/${deployment.serviceName}:`,
						ecsResult.reason
					);
				}
				if (albResult.status === "rejected") {
					console.warn(
						`[health-reconcile] failed to read ALB health for ${deployment.repoName}/${deployment.serviceName}:`,
						albResult.reason
					);
				}

				try {
					await appendRuntimeHealthSample({
						userID: ownerID ?? undefined,
						repoName: deployment.repoName,
						serviceName: deployment.serviceName,
						entry: healthSample,
					});
				} catch (error) {
					console.error(
						`[health-reconcile] failed to persist runtime health for ${deployment.repoName}/${deployment.serviceName}:`,
						error
					);
				}

				const nextStatus = resolveReconciledStatus(storedStatus, probeResults);
				if (!nextStatus || nextStatus === storedStatus) {
					return false;
				}

				const updateResponse = await dbHelper.updateDeploymentSystem(
					deployConfigForStatusUpdate({
						...deployment,
						status: nextStatus,
					})
				);
				if (updateResponse.error) {
					console.error(
						`[health-reconcile] failed to update ${deployment.repoName}/${deployment.serviceName}:`,
						updateResponse.error
					);
					return false;
				}

				console.log(
					`[health-reconcile] ${deployment.repoName}/${deployment.serviceName}: ${storedStatus} -> ${nextStatus} (probes=${probeResults.map((ok) => (ok ? "ok" : "fail")).join(",")})`
				);
				if (ownerID) {
					const payload = {
						ownerID,
						repoName: deployment.repoName,
						serviceName: deployment.serviceName,
						status: nextStatus,
					};
					emitToWorkerUserRoom(ownerID, WORKER_SOCKET_SERVER_EVENTS.deploymentStatusChanged, payload);
					emitToWorkerDeploymentRoom(
						ownerID,
						deployment.repoName,
						deployment.serviceName,
						WORKER_SOCKET_SERVER_EVENTS.deploymentStatusChanged,
						payload
					);
				}
				return true;
			} catch (error) {
				console.error(
					`[health-reconcile] error checking ${deployment.repoName}/${deployment.serviceName}:`,
					error
				);
				return false;
			}
		})
	);

	updated = reconcileResults.filter(Boolean).length;

	console.log(`[health-reconcile] finished; ${updated} status update(s)`);
}

let reconcilerStarted = false;

export function startDeploymentHealthReconciler(): void {
	if (reconcilerStarted) return;
	if ((process.env.SMARTDEPLOY_DISABLE_HEALTH_RECONCILER || "").trim() === "1") {
		console.log("[health-reconcile] disabled via SMARTDEPLOY_DISABLE_HEALTH_RECONCILER=1");
		return;
	}

	reconcilerStarted = true;
	const run = () => {
		void reconcileDeploymentsHealth().catch((error) => {
			console.error("[health-reconcile] tick failed:", error);
		});
	};

	const initialDelayMs = msUntilNextTenMinuteMark();
	console.log(
		`[health-reconcile] starting; first run in ${Math.round(initialDelayMs / 1000)}s, then every 10 minutes`
	);

	setTimeout(() => {
		run();
		setInterval(run, RECONCILE_INTERVAL_MS);
	}, initialDelayMs);
}

export const __testing = {
	PROBE_COUNT,
	PROBE_GAP_MS,
	RECONCILE_INTERVAL_MS,
};
