import { dbHelper } from "../db-helper";
import { getInstallationAccessToken } from "./githubAppAuth";
import { runDeploymentJob } from "./runDeploymentJob";
import type { DeployConfig } from "../app/types";

export type AutoDeployJobPayload = {
	installationId: number;
	fullName: string;
	branch: string;
	commitSha: string;
	deliveryId?: string;
};

function stripOwnerId(dep: DeployConfig & { ownerID: string }): DeployConfig {
	const { ownerID, ...config } = dep;
	void ownerID;
	return config as DeployConfig;
}

/**
 * Runs auto-deploy for every matching deployment row (multi-service repos may yield several).
 */
export async function processAutoDeployJob(payload: AutoDeployJobPayload): Promise<void> {
	const { installationId, fullName, branch, commitSha } = payload;
	const { deployments, error } = await dbHelper.getDeploymentsForAutoDeploy(installationId, fullName);
	if (error) {
		console.error("getDeploymentsForAutoDeploy:", error);
		return;
	}
	if (!deployments?.length) {
		return;
	}

	let token: string;
	try {
		token = await getInstallationAccessToken(installationId);
	} catch (e) {
		console.error("Installation token failed:", e);
		return;
	}

	for (const dep of deployments) {
		const targetBranch = (dep.auto_deploy_branch || dep.branch || "main").trim();
		if (targetBranch !== branch) {
			continue;
		}
		if (dep.last_auto_deploy_sha === commitSha) {
			continue;
		}

		const userID = dep.ownerID;
		const deployConfig: DeployConfig = {
			...stripOwnerId(dep),
			branch,
			commitSha,
		};

		try {
			await runDeploymentJob({ deployConfig, gitAccessToken: token, userID, ws: undefined });
			await dbHelper.updateLastAutoDeploySha(dep.repo_name, dep.service_name, commitSha);
		} catch (e) {
			console.error("Auto-deploy failed", dep.repo_name, dep.service_name, e);
		}
	}
}
