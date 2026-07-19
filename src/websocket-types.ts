import { DeployConfig } from "./app/types";
import { isEcsCloudResources } from "@/lib/cloudResources";
import { getEcsServiceLogs } from "@/lib/aws/ecsCloudWatchLogs";
import { enqueueDeploymentRun } from "@/lib/aws/deploymentQueue";
import { dbHelper } from "./db-helper";
import * as deployLogsStore from "@/lib/deployLogsStore";
import { emitWorkerSocketEvent, WORKER_SOCKET_SERVER_EVENTS } from "@/lib/workerSocketEvents";

export async function deploy(payload: { deployConfig: DeployConfig; token: string; userID: string }, ws: any) {
	const {
		deployConfig,
		userID,
	}: { deployConfig: DeployConfig; token: string; userID: string } = payload;

	const repoName = deployConfig.repoName;
	const serviceName = deployConfig.serviceName;
	if (!repoName || !serviceName) {
		throw new Error("repoName and serviceName are required.");
	}

	const queuedReleaseArtifact = {
		deployConfig: {
			...deployConfig,
		},
	};
	let runId: string | undefined;
	try {
		const createdRun = await dbHelper.createDeploymentRun({
			userId: userID,
			repoName,
			serviceName,
			branch: deployConfig.branch,
			commitSha: deployConfig.commitSha ?? undefined,
			responseId: deployConfig.responseId ?? null,
			releaseArtifact: queuedReleaseArtifact,
		});
		if (createdRun.error || !createdRun.runId) {
			throw new Error(
				typeof createdRun.error === "string"
					? createdRun.error
					: "Failed to create deployment run."
			);
		}
		runId = createdRun.runId;

		const updateResponse = await dbHelper.updateDeployments(
			{
				...deployConfig,
				activeRunId: runId,
			} as DeployConfig & { activeRunId: string },
			userID
		);
		if (updateResponse.error) {
			throw new Error(
				typeof updateResponse.error === "string"
					? updateResponse.error
					: "Failed to update deployment before queueing."
			);
		}

		await enqueueDeploymentRun({
			runId,
			userId: userID,
			repoName,
			serviceName,
		});

		deployLogsStore.createEntry(userID, repoName, serviceName);
		const snapshot = deployLogsStore.getSocketSnapshot(userID, repoName, serviceName);
		if (snapshot) {
			emitWorkerSocketEvent(ws, WORKER_SOCKET_SERVER_EVENTS.deploySnapshot, snapshot);
		}
	} catch (err: any) {
		if (runId) {
			await dbHelper.finalizeDeploymentRun({
				runId,
				userId: userID,
				success: false,
				steps: [],
				releaseArtifact: queuedReleaseArtifact,
			});
			await dbHelper.updateDeployments(
				{
					...deployConfig,
					activeRunId: null,
					status: "failed",
				} as DeployConfig & { activeRunId: null },
				userID
			);
		}
		throw err;
	}
}

export async function serviceLogs(payload: { serviceName?: string; repoName?: string }, ws: any) {
	const serviceName = payload?.serviceName?.trim();
	const repoName = payload?.repoName?.trim();

	if (!serviceName && !repoName) {
		emitWorkerSocketEvent(ws, WORKER_SOCKET_SERVER_EVENTS.serviceLogs, { logs: [] });
		return;
	}

	let deployConfig: DeployConfig | undefined;
	if (repoName && serviceName) {
		const deployment = await dbHelper.getDeployment(repoName, serviceName);
		if (deployment.deployment) {
			deployConfig = deployment.deployment;
		}
	}

	if (isEcsCloudResources(deployConfig?.cloudResources)) {
		const logs = await getEcsServiceLogs({
			ecs: deployConfig.cloudResources,
			limit: 50,
		});
		emitWorkerSocketEvent(ws, WORKER_SOCKET_SERVER_EVENTS.serviceLogs, { logs });
		return;
	}

	emitWorkerSocketEvent(ws, WORKER_SOCKET_SERVER_EVENTS.serviceLogs, { logs: [] });
}
