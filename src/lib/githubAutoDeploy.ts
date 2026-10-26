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
	const createRunId = dependencies.createRunId ?? (() => crypto.randomUUID());
	const matching = await db.getLiveDeploymentsForGithubPush({
		repositoryUrl: push.repositoryUrl,
		branch: push.branch,
	});
	if (matching.error) throw new Error(matching.error);

	let queuedRuns = 0;
	let skippedDeployments = 0;
	const entries = matching.deployments ?? [];
	let nextIndex = 0;
	let admissionStopped = false;

	async function queueOne(entry: GithubPushDeployment): Promise<void> {
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
			return;
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
			admissionStopped = true;
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

	// Deployment reservations are independent; bound control-plane dispatch to two.
	// Stop admitting work on failure and drain both workers before returning it.
	async function dispatchNext(): Promise<void> {
		if (admissionStopped || nextIndex >= entries.length) return;
		const entry = entries[nextIndex++];
		try { await queueOne(entry); }
		catch (error) { admissionStopped = true; throw error; }
		return dispatchNext();
	}
	const results = await Promise.allSettled([dispatchNext(), dispatchNext()]);
	const failure = results.find(result => result.status === "rejected");
	if (failure?.status === "rejected") throw failure.reason;

	return { queuedRuns, skippedDeployments };
}
