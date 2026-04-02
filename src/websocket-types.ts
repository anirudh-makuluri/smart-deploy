import { DeployConfig, DeployStep } from "./app/types";
import config from "./config";
import { getInitialLogs } from "./gcloud-logs/getInitialLogs";
import { streamLogs } from "./gcloud-logs/streamLogs";
import { handleDeploy } from "./lib/handleDeploy";
import { dbHelper } from "./db-helper";
import { getInitialEc2ServiceLogs, streamEc2ServiceLogs } from "./lib/aws/ec2ServiceLogs";
import * as deployLogsStore from "./lib/deployLogsStore";

export async function deploy(payload: { deployConfig: DeployConfig; token: string; userID?: string }, ws: any) {
	const {
		deployConfig,
		token,
		userID,
	}: { deployConfig: DeployConfig; token: string; userID?: string } = payload;

	const repoName = deployConfig.repo_name;
	const serviceName = deployConfig.service_name;
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
		await handleDeploy(deployConfig, token, ws, userID, options);
		deployLogsStore.setStatus(userID, repoName, serviceName, "success");
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

	if (deployConfig?.ec2?.instanceId) {
		const region = deployConfig.awsRegion || config.AWS_REGION;
		const logs = await getInitialEc2ServiceLogs({
			instanceId: deployConfig.ec2.instanceId,
			region,
			serviceName,
			limit: 200,
		});

		if (ws?.readyState === ws?.OPEN) {
			ws.send(
				JSON.stringify({
					type: "initial_logs",
					payload: { logs },
				})
			);
		}

		streamEc2ServiceLogs({
			instanceId: deployConfig.ec2.instanceId,
			region,
			serviceName,
			ws,
		});
		return;
	}

	// Only stream gcloud logs for Cloud Run deployments
	if (!serviceName || deployConfig?.deploymentTarget !== "cloud_run") {
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