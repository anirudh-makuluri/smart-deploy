import { DeployConfig, DeployStep } from "./app/types";
import { isEcsCloudResources } from "@/lib/cloudResources";
import { getEcsServiceLogs } from "@/lib/aws/ecsCloudWatchLogs";
import config from "./config";
import { getInitialLogs } from "./gcloud-logs/getInitialLogs";
import { streamLogs } from "./gcloud-logs/streamLogs";
import { handleDeploy, handleManualRollback } from "@/lib/handleDeploy";
import { dbHelper } from "./db-helper";
import * as deployLogsStore from "./lib/deployLogsStore";

export async function deploy(payload: { deployConfig: DeployConfig; token: string; userID?: string }, ws: any) {
	const {
		deployConfig,
		token,
		userID,
	}: { deployConfig: DeployConfig; token: string; userID?: string } = payload;

	const repoName = deployConfig.repoName;
	const serviceName = deployConfig.serviceName;
	deployLogsStore.createEntry(userID, repoName, serviceName, ws);

	const options = {
		onStepsChange: (steps: DeployStep[]) => {
			deployLogsStore.updateSteps(userID, repoName, serviceName, steps);
		},
		broadcast: (id: string, msg: string) => {
			deployLogsStore.broadcastLog(userID, repoName, serviceName, id, msg);
		},
	};

	try {
		const result = await handleDeploy(deployConfig, token, ws, userID, options);
		if (result === "error") {
			deployLogsStore.setStatus(userID, repoName, serviceName, "error", "Deployment failed");
		} else {
			deployLogsStore.setStatus(userID, repoName, serviceName, "success");
		}
	} catch (err: any) {
		deployLogsStore.setStatus(userID, repoName, serviceName, "error", err?.message ?? "Deployment failed");
		throw err;
	}
}

export async function rollback(
	payload: { repoName: string; serviceName: string; historyEntryId: string; token: string; userID?: string },
	ws: any
) {
	const repoName = payload.repoName?.trim();
	const serviceName = payload.serviceName?.trim();
	const historyEntryId = payload.historyEntryId?.trim();
	const userID = payload.userID;

	if (!repoName || !serviceName || !historyEntryId) {
		throw new Error("repoName, serviceName, and historyEntryId are required");
	}

	deployLogsStore.createEntry(userID, repoName, serviceName, ws);

	const options = {
		onStepsChange: (steps: DeployStep[]) => {
			deployLogsStore.updateSteps(userID, repoName, serviceName, steps);
		},
		broadcast: (id: string, msg: string) => {
			deployLogsStore.broadcastLog(userID, repoName, serviceName, id, msg);
		},
	};

	try {
		const result = await handleManualRollback({
			repoName,
			serviceName,
			historyEntryId,
			token: payload.token,
			ws,
			userID,
			options,
		});
		if (result === "error") {
			deployLogsStore.setStatus(userID, repoName, serviceName, "error", "Rollback failed");
		} else {
			deployLogsStore.setStatus(userID, repoName, serviceName, "success");
		}
	} catch (err: any) {
		deployLogsStore.setStatus(userID, repoName, serviceName, "error", err?.message ?? "Rollback failed");
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
