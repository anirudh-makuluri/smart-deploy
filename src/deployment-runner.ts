import dotenv from "dotenv";
dotenv.config();

import type { DeployConfig } from "@/app/types";
import { loadRuntimeSecretEnv } from "@/lib/runtimeSecretEnv";

function readEnv(name: string): string {
	return (process.env[name] || "").trim();
}

function extractDeployConfig(
	releaseArtifact: unknown,
	withDeployInfraDefaults: (deployConfig: DeployConfig) => DeployConfig
): DeployConfig {
	const deployConfig = (releaseArtifact as { deployConfig?: unknown } | null | undefined)?.deployConfig;
	if (!deployConfig || typeof deployConfig !== "object" || Array.isArray(deployConfig)) {
		throw new Error("release_artifact.deployConfig is missing from the deployment run.");
	}
	return withDeployInfraDefaults(deployConfig as DeployConfig);
}

type DeploymentRunnerDbHelper = {
	finalizeDeploymentRun: (args: {
		runId: string;
		userId: string;
		success: boolean;
		steps: [];
		releaseArtifact: Record<string, unknown>;
	}) => Promise<unknown>;
	updateDeploymentSystem: (args: {
		repoName: string;
		serviceName: string;
		status: "failed";
		activeRunId: null;
	}) => Promise<unknown>;
	getDeploymentRunSystem: (runId: string) => Promise<{
		error?: unknown;
		run?: {
			id: string;
			userId: string;
			repoName: string;
			serviceName: string;
			status: "queued" | "deploying" | "completed";
			releaseArtifact: unknown;
		} | null;
	}>;
	clearDeploymentActiveRunIfMatches: (args: {
		repoName: string;
		serviceName: string;
		runId: string;
	}) => Promise<unknown>;
};

async function failRun(args: {
	dbHelper: DeploymentRunnerDbHelper;
	runId: string;
	userId: string;
	repoName: string;
	serviceName: string;
	releaseArtifact: unknown;
	error: unknown;
}) {
	const message = args.error instanceof Error ? args.error.message : String(args.error);
	await args.dbHelper.finalizeDeploymentRun({
		runId: args.runId,
		userId: args.userId,
		success: false,
		steps: [],
		releaseArtifact: (args.releaseArtifact as Record<string, unknown>) ?? {},
	});
	await args.dbHelper.updateDeploymentSystem({
		repoName: args.repoName,
		serviceName: args.serviceName,
		status: "failed",
		activeRunId: null,
	});
	console.error(`[deployment-runner] ${message}`);
}

async function main() {
	const loaded = await loadRuntimeSecretEnv();
	if (loaded.secretArn) {
		console.log(`[deployment-runner] loaded ${loaded.loaded} env var(s) from runtime secret.`);
	}

	const [
		{ dbHelper },
		{ getGithubAccessTokenForUserId },
		{ handleDeploy },
		{ withDeployInfraDefaults },
	] = await Promise.all([
		import("@/db-helper"),
		import("@/lib/githubAccessToken"),
		import("@/lib/handleDeploy"),
		import("@/lib/deployInfraDefaults"),
	]);

	const runId = readEnv("DEPLOYMENT_RUN_ID");
	const envUserId = readEnv("DEPLOYMENT_USER_ID");
	if (!runId) {
		throw new Error("DEPLOYMENT_RUN_ID is required.");
	}

	const runResponse = await dbHelper.getDeploymentRunSystem(runId);
	if (runResponse.error) {
		throw new Error(
			typeof runResponse.error === "string"
				? runResponse.error
				: "Failed to load deployment run."
		);
	}

	const run = runResponse.run;
	if (!run) {
		throw new Error(`Deployment run ${runId} was not found.`);
	}
	if (run.status === "completed") {
		console.log(`[deployment-runner] run ${runId} is already completed; exiting.`);
		return;
	}

	const userId = envUserId || run.userId;
	const deployConfig = extractDeployConfig(run.releaseArtifact, withDeployInfraDefaults);

	const token = await getGithubAccessTokenForUserId(userId);
	if (!token) {
		await failRun({
			dbHelper,
			runId: run.id,
			userId,
			repoName: run.repoName,
			serviceName: run.serviceName,
			releaseArtifact: run.releaseArtifact,
			error: new Error("GitHub is not connected for this deployment run."),
		});
		throw new Error("GitHub is not connected for this deployment run.");
	}

	try {
		await handleDeploy(
			deployConfig,
			token,
			null,
			userId,
			{
				onStepsChange: () => undefined,
				broadcast: () => undefined,
			},
			{
				existingRunId: run.id,
			}
		);
	} catch (error) {
		const latestRun = await dbHelper.getDeploymentRunSystem(run.id);
		if (latestRun.run?.status !== "completed") {
			await failRun({
				dbHelper,
				runId: run.id,
				userId,
				repoName: run.repoName,
				serviceName: run.serviceName,
				releaseArtifact: run.releaseArtifact,
				error,
			});
		}
		throw error;
	} finally {
		await dbHelper.clearDeploymentActiveRunIfMatches({
			repoName: run.repoName,
			serviceName: run.serviceName,
			runId: run.id,
		});
	}
}

async function shutdownRuntimeResources(): Promise<void> {
	try {
		const { closeDbPool } = await import("@/lib/dbPool");
		await closeDbPool();
	} catch (error) {
		console.warn("[deployment-runner] cleanup warning:", error);
	}
}

void main()
	.then(async () => {
		await shutdownRuntimeResources();
		console.log("[deployment-runner] completed; exiting.");
		process.exit(0);
	})
	.catch(async (error) => {
		console.error("[deployment-runner] fatal error:", error);
		await shutdownRuntimeResources();
		process.exit(1);
	});
