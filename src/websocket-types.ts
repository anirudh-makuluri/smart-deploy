import { DeployConfig, DeployStep } from "./app/types";
import { isEcsCloudResources } from "@/lib/cloudResources";
import { getEcsServiceLogs } from "@/lib/aws/ecsCloudWatchLogs";
import config from "./config";
import { getInitialLogs } from "./gcloud-logs/getInitialLogs";
import { streamLogs } from "./gcloud-logs/streamLogs";
import { handleDeploy } from "@/lib/handleDeploy";
import { dbHelper } from "./db-helper";
import * as deployLogsStore from "./lib/deployLogsStore";

export type DeployLoggerOptions = {
	onStepsChange: (steps: DeployStep[]) => void;
	broadcast: (id: string, msg: string) => void;
};

export async function deploy(payload: { deployConfig: DeployConfig; token: string; userID: string }, ws: any) {
	const {
		deployConfig,
		token,
		userID,
	}: { deployConfig: DeployConfig; token: string; userID: string } = payload;

	const repoName = deployConfig.repoName;
	const serviceName = deployConfig.serviceName;
	deployLogsStore.createEntry(userID, repoName, serviceName, ws);

	

	const options : DeployLoggerOptions = {
		onStepsChange: (steps: DeployStep[]) => {
			deployLogsStore.updateSteps(userID, repoName, serviceName, steps);
		},
		broadcast: (id: string, msg: string) => {
			deployLogsStore.broadcastLog(userID, repoName, serviceName, id, msg);
		},
	};

	try {
		await handleDeploy(deployConfig, token, ws, userID, options);
		deployLogsStore.deleteEntry(userID, repoName, serviceName);
	} catch (err: any) {
		deployLogsStore.setStatus(userID, repoName, serviceName, "error", err?.message ?? "Deployment failed");
		throw err;
	}
}

export async function serviceLogs(payload: { serviceName?: string; repoName?: string }, ws: any) {
	const serviceName = payload?.serviceName?.trim();
	const repoName = payload?.repoName?.trim();

	if (!serviceName && !repoName) {
		if (ws?.readyState === ws?.OPEN) {
			ws.send(JSON.stringify({ type: "initial_logs", payload: { logs: [] } }));
		}
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
		if (ws?.readyState === ws?.OPEN) {
			ws.send(JSON.stringify({ type: "initial_logs", payload: { logs } }));
		}
		return;
	}

	if (deployConfig?.status !== "running") return;

	if (!serviceName) {
		if (ws?.readyState === ws?.OPEN) {
			ws.send(JSON.stringify({ type: "initial_logs", payload: { logs: [] } }));
		}
		return;
	}

	const logs = await getInitialLogs(serviceName);
	if (ws?.readyState === ws?.OPEN) {
		ws.send(
			JSON.stringify({
				type: "initial_logs",
				payload: {
					logs,
				},
			})
		);
	}

	streamLogs(serviceName, ws);
}
