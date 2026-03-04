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

	if (deployConfig.dockerfileInfo) {
		const { name, content } = deployConfig.dockerfileInfo;
		const base64 = content.split(",")[1];
		const buffer = Buffer.from(base64, "base64");
		deployConfig.dockerfileContent = buffer.toString();
	}

	const deploymentId = deployConfig.id;
	deployLogsStore.createEntry(userID, deploymentId, ws);

	const options = {
		onStepsChange: (steps: DeployStep[]) => {
			deployLogsStore.updateSteps(userID, deploymentId, steps);
		},
		broadcast: (id: string, msg: string) => {
			deployLogsStore.broadcastLog(userID, deploymentId, id, msg);
		},
	};

	try {
		await handleDeploy(deployConfig, token, ws, userID, options);
		deployLogsStore.setStatus(userID, deploymentId, "success");
	} catch (err: any) {
		deployLogsStore.setStatus(userID, deploymentId, "error", err?.message ?? "Deployment failed");
		throw err;
	}
}

export async function serviceLogs(payload: { serviceName?: string; deploymentId?: string }, ws: any) {
	const serviceName = payload?.serviceName?.trim();
	const deploymentId = payload?.deploymentId?.trim();

	if (!serviceName && !deploymentId) {
		if (ws?.readyState === ws?.OPEN) {
			ws.send(JSON.stringify({ type: "initial_logs", payload: { logs: [] } }));
		}
		return;
	}

	let deployConfig: DeployConfig | undefined;
	if (deploymentId) {
		const deployment = await dbHelper.getDeployment(deploymentId);
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