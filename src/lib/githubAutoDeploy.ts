import { dbHelper } from "@/db-helper";
import { enqueueDeploymentRun } from "@/lib/aws/deploymentQueue";
import type { DeployConfig } from "@/app/types";
import type { GithubPushWebhook } from "@/lib/githubWebhook";

type GithubAppReleaseContext = {
	installationId: number;
	repositoryId: number;
};

type GithubPushDeployment = {
	userId: string;
	deployment: DeployConfig;
};

type GithubAutoDeployDb = {
	getLiveDeploymentsForGithubPush: (args: {
		repositoryUrl: string;
		branch: string;
	}) => Promise<{ error?: string; deployments?: GithubPushDeployment[] }>;
	createAndReserveGithubPushDeployment: (args: {
		userId: string;
		repoName: string;
		serviceName: string;
		runId: string;
		commitSha: string;
		branch: string;
		responseId: string | null;
		releaseArtifact: Record<string, unknown>;
	}) => Promise<{ error?: string; reserved: boolean }>;
	updateGithubPushDeploymentState: (args: {
		userId: string;
		repoName: string;
		serviceName: string;
		status: "running" | "failed";
		runId: string;
	}) => Promise<{ error?: string }>;
	finalizeDeploymentRun: (args: {
		runId: string;
		userId: string;
		success: boolean;
		steps: [];
		releaseArtifact: Record<string, unknown>;
	}) => Promise<unknown>;
};

function autoDeployConfig(deployment: DeployConfig, push: GithubPushWebhook, runId: string): DeployConfig {
	return {
		...deployment,
		branch: push.branch,
		commitSha: push.commitSha,
		activeRunId: runId,
		status: "deploying",
	};
}

function releaseArtifact(args: {
	deployment: DeployConfig;
	push: GithubPushWebhook;
	runId: string;
}): Record<string, unknown> {
	const githubApp: GithubAppReleaseContext = {
		installationId: args.push.installationId,
		repositoryId: args.push.repositoryId,
	};
	return {
		deployConfig: autoDeployConfig(args.deployment, args.push, args.runId),
		githubApp,
	};
}

export type GithubAutoDeployResult = {
	queuedRuns: number;
	skippedDeployments: number;
};

export async function queueGithubPushDeployments(
	push: GithubPushWebhook,
	dependencies: {
		db?: GithubAutoDeployDb;
		enqueue?: typeof enqueueDeploymentRun;
		createRunId?: () => string;
	} = {}
): Promise<GithubAutoDeployResult> {
	const db = dependencies.db ?? (dbHelper as unknown as GithubAutoDeployDb);
	const enqueue = dependencies.enqueue ?? enqueueDeploymentRun;
	const createRunId = dependencies.createRunId ?? crypto.randomUUID;
	const matching = await db.getLiveDeploymentsForGithubPush({
		repositoryUrl: push.repositoryUrl,
		branch: push.branch,
	});
	if (matching.error) throw new Error(matching.error);

	let queuedRuns = 0;
	let skippedDeployments = 0;
	for (const entry of matching.deployments ?? []) {
		const runId = createRunId();
		const artifact = releaseArtifact({ deployment: entry.deployment, push, runId });
		const reserved = await db.createAndReserveGithubPushDeployment({
			userId: entry.userId,
			repoName: entry.deployment.repoName,
			serviceName: entry.deployment.serviceName,
			runId,
			commitSha: push.commitSha,
			branch: push.branch,
			responseId: entry.deployment.responseId ?? null,
			releaseArtifact: artifact,
		});
		if (reserved.error) throw new Error(reserved.error);
		if (!reserved.reserved) {
			skippedDeployments += 1;
			continue;
		}

		try {
			await enqueue({
				runId,
				userId: entry.userId,
				repoName: entry.deployment.repoName,
				serviceName: entry.deployment.serviceName,
			});
			queuedRuns += 1;
		} catch (error) {
			await db.finalizeDeploymentRun({
				runId,
				userId: entry.userId,
				success: false,
				steps: [],
				releaseArtifact: artifact,
			});
			await db.updateGithubPushDeploymentState({
				userId: entry.userId,
				repoName: entry.deployment.repoName,
				serviceName: entry.deployment.serviceName,
				status: "failed",
				runId,
			});
			throw error;
		}
	}

	return { queuedRuns, skippedDeployments };
}
