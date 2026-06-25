import { DeployConfig, DeployStep } from "./app/types";
import { isEcsCloudResources } from "@/lib/cloudResources";
import { getEcsServiceLogs } from "@/lib/aws/ecsCloudWatchLogs";
import type { DeployLoggerOptions } from "@/lib/deployLoggerOptions";
import { handleDeploy } from "@/lib/handleDeploy";
import { dbHelper } from "./db-helper";
import * as deployLogsStore from "./lib/deployLogsStore";
import { emitWorkerSocketEvent, WORKER_SOCKET_SERVER_EVENTS } from "@/lib/workerSocketEvents";

export async function deploy(payload: { deployConfig: DeployConfig; token: string; userID: string }, ws: any) {
	const {
		deployConfig,
		token,
		userID,
	}: { deployConfig: DeployConfig; token: string; userID: string } = payload;

	const repoName = deployConfig.repoName;
	const serviceName = deployConfig.serviceName;
	deployLogsStore.createEntry(userID, repoName, serviceName, ws);

	const options: DeployLoggerOptions = {
		onStepsChange: (steps: DeployStep[]) => {
			deployLogsStore.updateSteps(userID, repoName, serviceName, steps);
		},
		broadcast: (id: string, msg: string) => {
			deployLogsStore.broadcastLog(userID, repoName, serviceName, id, msg);
		},
	};

	try {
		await handleDeploy(deployConfig, token, ws, userID, options);
	} catch (err: any) {
		throw err;
	} finally {
		deployLogsStore.deleteEntry(userID, repoName, serviceName);
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
