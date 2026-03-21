import type { DeployConfig, DeployStep } from "../app/types";
import { handleDeploy } from "./handleDeploy";
import * as deployLogsStore from "./deployLogsStore";

/**
 * Shared entry for interactive (WebSocket) and headless (GitHub App) deploys.
 */
export async function runDeploymentJob(opts: {
	deployConfig: DeployConfig;
	gitAccessToken: string;
	userID: string;
	ws?: unknown;
}): Promise<void> {
	const { deployConfig, gitAccessToken, userID, ws } = opts;
	const repoName = deployConfig.repo_name;
	const serviceName = deployConfig.service_name;

	const existing = deployLogsStore.getEntry(userID, repoName, serviceName);
	if (existing?.status === "running") {
		throw new Error("A deployment is already in progress for this service");
	}

	deployLogsStore.createEntry(userID, repoName, serviceName, ws ?? null);

	const options = {
		onStepsChange: (steps: DeployStep[]) => {
			deployLogsStore.updateSteps(userID, repoName, serviceName, steps);
		},
		broadcast: (id: string, msg: string) => {
			deployLogsStore.broadcastLog(userID, repoName, serviceName, id, msg);
		},
	};

	try {
		await handleDeploy(deployConfig, gitAccessToken, ws ?? null, userID, options);
		deployLogsStore.setStatus(userID, repoName, serviceName, "success");
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Deployment failed";
		deployLogsStore.setStatus(userID, repoName, serviceName, "error", message);
		throw err;
	}
}
