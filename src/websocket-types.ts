import { DeployConfig } from "./app/types";
import config from "./config";
import { getInitialLogs } from "./gcloud-logs/getInitialLogs";
import { streamLogs } from "./gcloud-logs/streamLogs";
import { handleDeploy } from "./lib/handleDeploy";


export async function deploy(payload: { deployConfig: DeployConfig, token: string, userID?: string }, ws: any) {
	const {
		deployConfig,
		token,
		userID
	}: { deployConfig: DeployConfig, token: string, userID?: string } = payload;

	if (deployConfig.dockerfileInfo) {
		const { name, content } = deployConfig.dockerfileInfo;

		const base64 = content.split(',')[1];
		const buffer = Buffer.from(base64, 'base64');

		deployConfig.dockerfileContent = buffer.toString();
	}

	await handleDeploy(deployConfig, token, ws, userID);
}

export async function serviceLogs(payload: { serviceName: string }, ws: any) {
	console.log('in service logs')

	const projectId = config.GCP_PROJECT_ID;

	const logs = await getInitialLogs(payload.serviceName);
	const object = {
		type: 'initial_logs',
		payload : {
			logs
		}
	}

	ws.send(JSON.stringify(object))
	
	streamLogs(payload.serviceName, ws);
}