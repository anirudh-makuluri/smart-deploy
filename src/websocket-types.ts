import { DeployConfig, DeployStep, EC2Details } from "./app/types";
import config from "./config";
import { getInitialLogs } from "./gcloud-logs/getInitialLogs";
import { streamLogs } from "./gcloud-logs/streamLogs";
import { handleDeploy } from "@/lib/handleDeploy";
import { dbHelper } from "./db-helper";
import { getInitialEc2ServiceLogs, streamEc2ServiceLogs } from "./lib/aws/ec2ServiceLogs";
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

	if (deployConfig?.status !== "running") return;

	if (deployConfig?.ec2 && typeof deployConfig.ec2 === "object") {
		const ec2Details = deployConfig.ec2 as EC2Details;
		const region = deployConfig.awsRegion || config.AWS_REGION;
		const logs = await getInitialEc2ServiceLogs({
			instanceId: ec2Details.instanceId,
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