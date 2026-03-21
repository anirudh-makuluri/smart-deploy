import { DeployConfig } from "./app/types";
import config from "./config";
import { getInitialLogs } from "./gcloud-logs/getInitialLogs";
import { streamLogs } from "./gcloud-logs/streamLogs";
import { dbHelper } from "./db-helper";
import { getInitialEc2ServiceLogs, streamEc2ServiceLogs } from "./lib/aws/ec2ServiceLogs";
import { runDeploymentJob } from "./lib/runDeploymentJob";

export async function deploy(payload: { deployConfig: DeployConfig; token: string; userID?: string }, ws: any) {
	const {
		deployConfig,
		token,
		userID,
	}: { deployConfig: DeployConfig; token: string; userID?: string } = payload;

	if (!userID) {
		throw new Error("userID is required for deploy");
	}

	await runDeploymentJob({ deployConfig, gitAccessToken: token, userID, ws });
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