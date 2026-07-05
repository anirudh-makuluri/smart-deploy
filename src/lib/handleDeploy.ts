import config from "../config";
import {
	DeploymentTarget,
	DeployConfig,
	CloudResources,
	DeployStep,
	SDArtifactsResponse,
	DeploymentReleaseArtifact,
} from "../app/types";
import { cloudResourcesFromDeployResult, isEcsCloudResources } from "./cloudResources";
import { hostedSubdomainOrDefault, hostedUrlFromSubdomain, subdomainFromHostedUrl } from "./hostedUrl";
import { buildVerificationCandidates, fetchWithTimeout } from "./deploymentHealthProbe";
import { dbHelper } from "../db-helper";
import { createDeployStepsLogger } from "./websocketLogger";
import {
	type ActiveDeployRun,
	adoptDeploymentRun,
	startDeploymentRun,
	createDeployRunStepFlushHandler,
} from "./deployRunTracker";
import { uploadDeployRunLogs } from "./aws/deployRunLogs";
import type { DeployResult } from "./deployResult";
import { captureDeploymentScreenshotAndUpload } from "./deploymentScreenshot";
import { isSdArtifactsAnalyzeScan } from "./scanResultNormalization";
import {
	hasUsableRailpackPlan,
	pickDeployUnitForBuild,
	resolveSdArtifactsPrebuiltImage,
} from "./sdArtifactsBuildContext";

// AWS imports
import { isExistingDockerUnit } from "./deployRouting";

// CodeBuild + ECR imports
import {
	getAwsAccountId,
	getEcrRegistry,
	getEcrImageUri,
	buildScopedEcrRepoName,
	ensureEcrRepository,
	ecrImageTagExists,
	describeEcrImageByTag,
} from "./aws/ecrHelpers";
import { collectEcsFailureDiagnostics } from "./aws/ecsCloudWatchLogs";
import {
	ensureCodeBuildRole,
	ensureCodeBuildProject,
	generateBuildspec,
	startBuild,
	waitForBuildAndStreamLogsPhased,
} from "./aws/codebuildHelpers";
import {
	deployRailpackServerToEcs,
	ecsRailpackFromEcrConfigured,
	waitForEcsServiceRollout,
} from "./aws/ecsRailpackDeploy";
import {
	buildStaticSiteS3Prefix,
	runStaticSiteCodeBuildPipeline,
	shouldDeployStaticSiteToS3,
	staticSiteDeployConfigured,
} from "./aws/staticSiteCodebuild";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { getAwsClientConfig } from "./aws/sdkClients";
import { captureServerEvent } from "./analytics/posthogServer";

import { addRoute53DnsRecord, AddRoute53DnsResult, getDeployUrlHostname } from "./route53Dns";
import { ensureHostRule } from "./aws/awsHelpers";
import { fetchRepoMetadata, parseGithubOwnerRepo } from "./githubRepoArchive";
import { transitionDeploymentStatus } from "./deploymentStatus";
import * as deployLogsStore from "./deployLogsStore";
import {
	attachDeployConfigToReleaseArtifact,
	buildEcrImageReleaseArtifact,
	buildStaticSiteReleaseArtifact,
} from "./deploymentReleaseArtifacts";
import { classifyDeploymentFailure, type DeploymentFailureRecord } from "./deploymentFailureClassification";
import type { DeployLoggerOptions } from "@/lib/deployLoggerOptions";
import { emitWorkerSocketEvent, WORKER_SOCKET_SERVER_EVENTS } from "@/lib/workerSocketEvents";

type DeploymentLifecycleOptions = {
	errorMessage?: string | null;
	finalStatus?: DeployConfig["status"] | null;
	releaseArtifact?: DeploymentReleaseArtifact | Record<string, unknown> | null;
	failure?: DeploymentFailureRecord | null;
};

type VerificationResult =
	| {
		success: true;
		verifiedUrl: string;
		statusCode: number;
	}
	| {
		success: false;
		errorMessage: string;
	};

type DockerHubCredentials = {
	username: string;
	token: string;
};

type AnalyzeBuildInputs = {
	scanResultsTyped: SDArtifactsResponse | null;
	scanResultsForCodebuild?: SDArtifactsResponse;
	railpackUnit: ReturnType<typeof pickDeployUnitForBuild> | null;
	railpackPlan: SDArtifactsResponse["deploy_units"][number]["artifacts"]["railpack_plan"] | null | undefined;
	useRailpackBuild: boolean;
	shouldStaticS3Build: boolean;
	useStaticS3: boolean;
	isExistingDocker: boolean;
	canBuildContainerImage: boolean;
};

function imageRefFromUriAndDigest(imageUri: string, imageDigest?: string | null): string {
	if (!imageDigest) return imageUri;
	const base = imageUri.includes("@")
		? imageUri.split("@")[0]
		: imageUri.replace(/:[^/:@]+$/, "");
	return `${base}@${imageDigest}`;
}

function parseRegistryFromImageUri(imageUri: string): string | null {
	const trimmed = imageUri.trim();
	if (!trimmed) return null;
	const slash = trimmed.indexOf("/");
	if (slash <= 0) return null;
	return trimmed.slice(0, slash);
}

async function describeImageRefWithFallback(params: {
	region: string;
	ecrRegistry: string;
	ecrRepoName: string;
	imageTag: string;
	serviceName?: string;
	send: (msg: string, stepId: string) => void;
}): Promise<{ imageUri: string; imageDigest?: string | null }> {
	const imageUri = `${params.ecrRegistry}/${params.ecrRepoName}:${params.imageTag}`;
	try {
		const image = await describeEcrImageByTag(params.region, params.ecrRepoName, params.imageTag);
		return {
			imageUri: imageRefFromUriAndDigest(imageUri, image.imageDigest),
			imageDigest: image.imageDigest ?? null,
		};
	} catch (error) {
		const label = params.serviceName ? `${params.serviceName} image` : "image";
		const message = error instanceof Error ? error.message : String(error);
		params.send(`Warning: could not read ECR digest for ${label}; rollback will use tag ref. ${message}`, "build");
		return { imageUri, imageDigest: null };
	}
}

function setStepState(steps: DeployStep[], stepId: string, status: DeployStep["status"]) {
	const step = steps.find((entry) => entry.id === stepId);
	if (step) {
		step.status = status;
	}
}

function deployConfigForStatusPersist(config: DeployConfig): DeployConfig {
	const { scanResults: _scanResults, ...rest } = config;
	return rest as DeployConfig;
}

async function updatePersistedDeploymentStatus(
	deployConfig: DeployConfig,
	userID: string | undefined,
	status: DeployConfig["status"],
	overrides: Partial<DeployConfig> = {}
) {
	if (!userID) return;
	await dbHelper.updateDeployments(
		deployConfigForStatusPersist({
			...deployConfig,
			...overrides,
			status,
		}),
		userID
	);
}

function createTrackedDeployLogger(
	ws: any,
	deploySteps: DeployStep[],
	options: DeployLoggerOptions,
	getActiveDeployRun: () => ActiveDeployRun | null
) {
	// One logger fans out to three audiences at once:
	// 1. the live websocket UI
	// 2. the in-memory step list used during this request
	// 3. the persisted deploy-run record used later for debugging and AI failure analysis
	return createDeployStepsLogger(ws, deploySteps, {
		...options,
		onStepsChange: (steps) => {
			const activeDeployRun = getActiveDeployRun();
			if (activeDeployRun) {
				createDeployRunStepFlushHandler(activeDeployRun, () => deploySteps)(steps);
			}
			options?.onStepsChange?.(steps);
		},
	});
}

async function startTrackedDeployRun(
	deployConfig: DeployConfig,
	userID: string,
	ws: any
): Promise<ActiveDeployRun | null> {
	const activeDeployRun = await startDeploymentRun({
		userId: userID,
		repoName: deployConfig.repoName,
		serviceName: deployConfig.serviceName,
		branch: deployConfig.branch,
		commitSha: deployConfig.commitSha ?? undefined,
		responseId: deployConfig.responseId ?? null,
		region: deployConfig.region,
	});

	if (ws && activeDeployRun) {
		(ws as any).__deployRun = activeDeployRun;
	}

	return activeDeployRun;
}

function resolveDockerHubCredentials(
	send: (msg: string, stepId: string) => void
): DockerHubCredentials | undefined {
	// Docker Hub auth is optional. We warn instead of failing because many repos build entirely
	// from public bases or from ECR-hosted parents.
	const dockerHubUser = config.DOCKERHUB_USERNAME?.trim();
	const dockerHubToken = config.DOCKERHUB_TOKEN?.trim();
	if (dockerHubUser && dockerHubToken) {
		return { username: dockerHubUser, token: dockerHubToken };
	}
	if (dockerHubUser && !dockerHubToken) {
		send("WARNING: DOCKERHUB_USERNAME is set but DOCKERHUB_TOKEN is missing. Docker Hub login will be skipped.", "build");
	}
	return undefined;
}

async function resolveDeploymentBranch(params: {
	deployConfig: DeployConfig;
	parsedRepo: ReturnType<typeof parseGithubOwnerRepo>;
	token: string;
	send: (msg: string, stepId: string) => void;
}): Promise<string> {
	// Operators often leave branch blank to mean "deploy the repo default".
	// We resolve and persist that choice once so the rest of the pipeline has an explicit branch.
	const branch = params.deployConfig.branch?.trim() ?? "";
	if (branch) {
		return branch;
	}

	if (!params.parsedRepo) {
		params.send("Set a deployment branch in workspace settings before deploying.", "auth");
		throw new Error("Missing deployment branch");
	}

	try {
		const { default_branch } = await fetchRepoMetadata(
			params.parsedRepo.owner,
			params.parsedRepo.repo,
			params.token
		);
		params.deployConfig.branch = default_branch;
		return default_branch;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		params.send(`Could not resolve default branch: ${msg}`, "auth");
		throw new Error("Missing deployment branch and could not resolve repository default");
	}
}

async function emitEcsVerificationDiagnostics(params: {
	deployConfig: DeployConfig;
	send: (msg: string, stepId: string) => void;
	serviceDetails?: ServiceDeployDetails | null;
}): Promise<void> {
	const ecsResources = isEcsCloudResources(params.serviceDetails?.cloudResources)
		? params.serviceDetails.cloudResources
		: isEcsCloudResources(params.deployConfig.cloudResources)
			? params.deployConfig.cloudResources
			: null;

	if (!ecsResources) return;

	const logGroup = ecsResources.logGroup?.trim() || config.ECS_LOG_GROUP?.trim() || "(unknown)";
	params.send(
		`diagnostics:ecs_service:start cluster=${ecsResources.cluster} service=${ecsResources.service}`,
		"verify"
	);

	const diagnostics = await collectEcsFailureDiagnostics({
		ecs: ecsResources,
		eventLimit: 5,
		logLimit: 80,
		relevantLogLimit: 12,
	});

	if (diagnostics.serviceEventsError) {
		params.send(
			`[ecs] failed to read ECS service events: ${diagnostics.serviceEventsError}`,
			"verify"
		);
	} else if (diagnostics.serviceEvents.length > 0) {
		for (const event of diagnostics.serviceEvents) {
			const timePrefix = event.createdAt ? `[${event.createdAt}] ` : "";
			params.send(`[ecs:event] ${timePrefix}${event.message ?? ""}`.trim(), "verify");
		}
	} else {
		params.send("[ecs:event] no recent ECS service events were returned.", "verify");
	}

	params.send(
		`diagnostics:ecs_logs:start logGroup=${logGroup} service=${ecsResources.service}`,
		"verify"
	);

	if (diagnostics.serviceLogsError) {
		params.send(
			`[ecs:log] failed to read CloudWatch logs from ${logGroup}: ${diagnostics.serviceLogsError}`,
			"verify"
		);
	} else if (diagnostics.relevantLogs.length > 0) {
		params.send(
			`[ecs:log] showing ${diagnostics.relevantLogs.length} high-signal line(s) from ${logGroup}.`,
			"verify"
		);
		for (const entry of diagnostics.relevantLogs) {
			const timePrefix = entry.timestamp ? `[${entry.timestamp}] ` : "";
			params.send(`[ecs:log] ${timePrefix}${entry.message ?? ""}`.trim(), "verify");
		}
	} else if (diagnostics.recentLogs.length > 0) {
		params.send(
			`[ecs:log] ${diagnostics.recentLogs.length} CloudWatch line(s) found in ${logGroup}, but none matched the high-signal filter.`,
			"verify"
		);
	} else {
		params.send(`[ecs:log] no recent CloudWatch log lines found in ${logGroup}.`, "verify");
	}

	params.send("diagnostics:ecs_logs:end", "verify");
	params.send("diagnostics:ecs_service:end", "verify");
}

async function verifyDeploymentReadiness(params: {
	deployConfig: DeployConfig;
	deployUrl: string;
	userID?: string;
	token?: string;
	send: (msg: string, stepId: string) => void;
	deploySteps: DeployStep[];
	serviceDetails?: ServiceDeployDetails | null;
}): Promise<VerificationResult> {
	const { deployConfig, deployUrl, userID, send, deploySteps, serviceDetails } = params;
	setStepState(deploySteps, "verify", "in_progress");
	await updatePersistedDeploymentStatus(deployConfig, userID, "deploying", {
		...(serviceDetails?.cloudResources ? { cloudResources: serviceDetails.cloudResources } : {}),
	});

	const targetUrl = deployUrl.trim();
	if (!targetUrl) {
		setStepState(deploySteps, "verify", "error");
		send("ERROR: Deployment verification could not start because no reachable URL was available.", "verify");
		return {
			success: false,
			errorMessage: "Deployment verification could not start because no reachable URL was available.",
		};
	}

	const maxRounds = 10;
	const requestTimeoutMs = 8_000;
	const roundDelayMs = 20_000;
	const verificationDeadlineMs = 300_000;
	const candidates = buildVerificationCandidates(targetUrl);
	if (candidates.length === 0) {
		setStepState(deploySteps, "verify", "error");
		send("ERROR: Deployment verification could not start because no reachable URL was available.", "verify");
		return {
			success: false,
			errorMessage: "Deployment verification could not start because no reachable URL was available.",
		};
	}

	send(`Starting verification: ${targetUrl}`, "verify");

	const verificationDeadlineAt = Date.now() + verificationDeadlineMs;
	const verifyRound = async (round: number): Promise<VerificationResult | null> => {
		if (round > maxRounds) {
			return null;
		}

		const remainingBudgetMs = verificationDeadlineAt - Date.now();
		if (remainingBudgetMs <= 0) {
			send("Verification deadline reached before a healthy response was observed.", "verify");
			return null;
		}

		send(`Verification round ${round}/${maxRounds}.`, "verify");
		const roundController = new AbortController();
		let roundResolved = false;
		const perCandidateTimeoutMs = Math.max(1_000, Math.min(requestTimeoutMs, remainingBudgetMs));
		const probes = candidates.map((candidate) => {
			send(`Verification attempt ${round}/${maxRounds}: ${candidate}`, "verify");
			return fetchWithTimeout(candidate, perCandidateTimeoutMs, roundController.signal)
				.then((response) => {
					if (response.status < 500) {
						return {
							candidate,
							statusCode: response.status,
						};
					}
					throw new Error(`HTTP ${response.status}`);
				})
				.catch((error) => {
					if (roundResolved && roundController.signal.aborted) {
						throw error;
					}
					throw error;
				});
		});

		try {
			const verified = await Promise.any(probes);
			roundResolved = true;
			roundController.abort();
			send(
				`SUCCESS: Verification passed with HTTP ${verified.statusCode} at ${verified.candidate}`,
				"verify"
			);
			setStepState(deploySteps, "verify", "success");
			return {
				success: true,
				verifiedUrl: verified.candidate,
				statusCode: verified.statusCode,
			};
		} catch {
			roundController.abort();
		}

		if (round < maxRounds) {
			const delayMs = Math.min(roundDelayMs, Math.max(0, verificationDeadlineAt - Date.now()));
			if (delayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}
		}
		return verifyRound(round + 1);
	};

	const verificationResult = await verifyRound(1);
	if (verificationResult) {
		return verificationResult;
	}

	setStepState(deploySteps, "verify", "error");
	send("ERROR: Deployment verification failed after all retry attempts.", "verify");
	await emitEcsVerificationDiagnostics({
		deployConfig,
		send,
		serviceDetails: serviceDetails ?? null,
	});
	return {
		success: false,
		errorMessage: "Deployment verification failed after all retry attempts.",
	};
}

function resolveAnalyzeBuildInputs(deployConfig: DeployConfig): AnalyzeBuildInputs {
	// Convert the sd-artifacts scan into one normalized build plan so the deploy orchestrator
	// does not have to repeatedly reason about Dockerfile vs Railpack vs static-site behavior.
	const scanResults = deployConfig.scanResults;
	const scanResultsTyped = isSdArtifactsAnalyzeScan(scanResults) ? scanResults : null;
	const scanResultsForCodebuild = isSdArtifactsAnalyzeScan(scanResults) ? scanResults : undefined;
	const railpackUnit =
		scanResultsForCodebuild?.deploy_units?.length
			? pickDeployUnitForBuild(scanResultsForCodebuild, deployConfig.serviceName)
			: null;
	const railpackPlan = railpackUnit?.artifacts?.railpack_plan;
	const useRailpackBuild = Boolean(railpackUnit && hasUsableRailpackPlan(railpackPlan));
	const shouldStaticS3Build = shouldDeployStaticSiteToS3(
		scanResultsForCodebuild,
		deployConfig.serviceName
	);
	const useStaticS3 = Boolean(shouldStaticS3Build && staticSiteDeployConfigured());
	const isExistingDocker = scanResultsForCodebuild
		? isExistingDockerUnit(scanResultsForCodebuild, deployConfig.serviceName)
		: false;

	return {
		scanResultsTyped,
		scanResultsForCodebuild,
		railpackUnit,
		railpackPlan,
		useRailpackBuild,
		shouldStaticS3Build,
		useStaticS3,
		isExistingDocker,
		canBuildContainerImage: useRailpackBuild || isExistingDocker,
	};
}

/**
 * Main deployment handler — CodeBuild + ECR, then runtime placement (ECS or static hosting).
 */
export async function handleDeploy(
	deployConfig: DeployConfig,
	token: string,
	ws: any,
	userID: string,
	options: DeployLoggerOptions,
	context?: {
		existingRunId?: string | null;
	}
): Promise<string> {
	const deployStartTime = Date.now();

	if (!(deployConfig.scanResults as SDArtifactsResponse).deploy_units?.length) {
		throw new Error("Analyze response has no deploy_units.");
	}

	// Initialize deployment steps for tracking all logs
	const deploySteps: DeployStep[] = [];
	let activeDeployRun: ActiveDeployRun | null = null;
	let runtimeEmitter = ws;
	const send = createTrackedDeployLogger(ws, deploySteps, options, () => activeDeployRun);
	if (ws) {
		(ws as any).__deploySend = send;
	}

	try {
		deployConfig.status = "deploying";
		await dbHelper.updateDeployments(
			deployConfigForStatusPersist({
				...deployConfig,
				status: "deploying",
			}),
			userID
		);
		activeDeployRun = context?.existingRunId?.trim()
			? adoptDeploymentRun({
				runId: context.existingRunId.trim(),
				userId: userID,
				region: deployConfig.region,
			})
			: await startTrackedDeployRun(deployConfig, userID, ws);
		if (ws && activeDeployRun) {
			(ws as any).__deployRun = activeDeployRun;
		}
		if (!ws && activeDeployRun) {
			runtimeEmitter = {
				emit: () => undefined,
				__deployRun: activeDeployRun,
				__deploySend: send,
			};
		}
		return await handleAWSCodeBuildDeploy(
			deployConfig,
			token,
			runtimeEmitter,
			userID,
			deployStartTime,
			send,
			deploySteps
		);
	} catch (error: any) {
		send(`ERROR: Deployment failed: ${error.message}`, 'error');
		const doneStep = deploySteps.find((step) => step.id === "done");
		if (doneStep) doneStep.status = "error";
		const durationMs = Date.now() - deployStartTime;
		await sendDeployComplete(runtimeEmitter, undefined, false, deployConfig, deploySteps, userID, deployConfig.deploymentTarget, null, null, durationMs, {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

export const __testing = {
	buildVerificationCandidates,
	verifyDeploymentReadiness,
	sendDeployComplete,
};

/** Step definitions per AWS target so the client shows accurate labels */
const AWS_DEPLOY_STEPS: Record<string, { id: string; label: string }[]> = {
	"ecs-codebuild": [
		{ id: "auth", label: "🔐 Authentication" },
		{ id: "build", label: "🐳 Build image (CodeBuild)" },
		{ id: "deploy", label: "🚀 Deploy to ECS Fargate" },
		{ id: "done", label: "✅ Done" },
	],
	"static-s3-codebuild": [
		{ id: "auth", label: "🔐 Authentication" },
		{ id: "build", label: "📦 Build static site (CodeBuild)" },
		{ id: "deploy", label: "🌐 Publish to S3 / CDN" },
		{ id: "done", label: "✅ Done" },
	],
};

function getTransportDeploySteps(
	steps: { id: string; label: string }[],
	preset?: string
): { id: string; label: string }[] {
	if (preset !== "ecs-codebuild") {
		return steps;
	}

	const next = [...steps];
	const deployIndex = next.findIndex((step) => step.id === "deploy");
	if (!next.some((step) => step.id === "publish")) {
		next.splice(deployIndex >= 0 ? deployIndex : next.length, 0, {
			id: "publish",
			label: "Publish image to ECR",
		});
	}
	const doneIndex = next.findIndex((step) => step.id === "done");
	const insertAt = doneIndex >= 0 ? doneIndex : next.length;
	if (!next.some((step) => step.id === "rollout")) {
		next.splice(insertAt, 0, { id: "rollout", label: "ECS rollout" });
	}
	if (!next.some((step) => step.id === "verify")) {
		const doneAfterRolloutIndex = next.findIndex((step) => step.id === "done");
		next.splice(doneAfterRolloutIndex >= 0 ? doneAfterRolloutIndex : next.length, 0, {
			id: "verify",
			label: "Verify deployment",
		});
	}
	return next;
}

function sendDeploySteps(ws: any, steps: { id: string; label: string }[], preset?: string) {
	emitWorkerSocketEvent(ws, WORKER_SOCKET_SERVER_EVENTS.deploySteps, {
		steps: getTransportDeploySteps(steps, preset),
	});
}

/**
 * Save deployment to database and record history
 * Called after deployment completes (success or failure)
 */
async function saveDeploymentToDB(
	deployConfig: DeployConfig,
	deployUrl: string | undefined,
	success: boolean,
	steps: DeployStep[],
	userID: string | undefined,
	serviceDetails: ServiceDeployDetails | null | undefined,
	durationMs?: number,
	releaseArtifact?: DeploymentReleaseArtifact | Record<string, unknown> | null,
	failure?: DeploymentFailureRecord | null,
	activeDeployRun?: ActiveDeployRun | null
): Promise<void> {
	if (!userID) {
		console.warn("No userID provided - skipping database save");
		captureServerEvent({
			distinctId: "anonymous",
			event: "deploy_persistence_skipped",
			properties: {
				reason: "missing_user_id",
				repo_name: deployConfig.repoName ?? null,
				service_name: deployConfig.serviceName ?? null,
				success,
				duration_ms: durationMs ?? null,
			},
		});
		return;
	}

	try {
		// Prepare minimal deployment config for DB (omit scanResults — lifecycle updates must not re-upsert analysis)
		const minimalDeployment: DeployConfig = deployConfigForStatusPersist({
			...deployConfig,
			status: success ? "running" : "failed",
			...(serviceDetails?.cloudResources ? { cloudResources: serviceDetails.cloudResources } : {}),
		});

		// Update deployment document (creates if doesn't exist)
		const updateResponse = await dbHelper.updateDeployments(minimalDeployment, userID);
		if (updateResponse.error) {
			console.error("Failed to update deployment:", updateResponse.error);
			captureServerEvent({
				distinctId: userID,
				event: "deploy_persistence_failed",
				properties: {
					phase: "update_deployments",
					repo_name: deployConfig.repoName ?? null,
					service_name: deployConfig.serviceName ?? null,
					success,
					error: String(updateResponse.error),
				},
			});
		} else {
			console.log("Deployment saved to DB:", updateResponse.success);

			// Kick off screenshot generation in the background so deploy completion isn't delayed.
			if (success) {
				const screenshotTargetUrl = deployUrl || "";
				if (screenshotTargetUrl.trim()) {
					void (async () => {
						try {
							const screenshotPublicUrl = await captureDeploymentScreenshotAndUpload({
								url: screenshotTargetUrl,
								ownerID: userID!,
								repoName: deployConfig.repoName,
								serviceName: deployConfig.serviceName,
							});
							
							// Update deployment with screenshot URL
							await dbHelper.updateDeployments(
								{
									...minimalDeployment,
									screenshotUrl: screenshotPublicUrl,
								},
								userID
							);
						} catch (err) {
							console.error("Screenshot generation failed:", err);
						}
					})();
				}
			}
		}

		if (activeDeployRun) {
			const finalArtifact =
				attachDeployConfigToReleaseArtifact(releaseArtifact, minimalDeployment) ?? releaseArtifact ?? {};
			const uploaded = await uploadDeployRunLogs({
				userId: activeDeployRun.userId,
				runId: activeDeployRun.runId,
				steps,
				region: activeDeployRun.region ?? deployConfig.region,
			});

			const finalizeResponse = await dbHelper.finalizeDeploymentRun({
				runId: activeDeployRun.runId,
				userId: activeDeployRun.userId,
				success,
				durationMs,
				steps,
				releaseArtifact: finalArtifact,
				failureCode: failure?.code ?? null,
				failureClassification: failure?.classification ?? null,
				logRef: uploaded?.logRef ?? null,
				stepSummary: uploaded?.stepSummary,
				logTail: uploaded?.logTail,
			});

			if (finalizeResponse.error) {
				console.error("Failed to finalize deployment run:", finalizeResponse.error);
				captureServerEvent({
					distinctId: userID,
					event: "deploy_persistence_failed",
					properties: {
						phase: "finalize_deployment_run",
						repo_name: deployConfig.repoName ?? null,
						service_name: deployConfig.serviceName ?? null,
						success,
						error: String(finalizeResponse.error),
					},
				});
			} else {
				console.log("Deployment run finalized:", activeDeployRun.runId);
			}
		}
	} catch (error) {
		console.error("Error saving deployment to DB:", error);
		captureServerEvent({
			distinctId: userID,
			event: "deploy_persistence_failed",
			properties: {
				phase: "save_deployment_to_db_exception",
				repo_name: deployConfig.repoName ?? null,
				service_name: deployConfig.serviceName ?? null,
				success,
				error: error instanceof Error ? error.message : String(error),
			},
		});
	}
}

function emitPersistenceWarningToDeployLogs(ws: any, deploySteps: DeployStep[], message: string): void {
	const doneStep = deploySteps.find((step) => step.id === "done") ?? deploySteps[deploySteps.length - 1];
	if (doneStep) {
		doneStep.logs.push(message);
	}
	emitWorkerSocketEvent(ws, WORKER_SOCKET_SERVER_EVENTS.deployLog, {
		id: doneStep?.id ?? "done",
		msg: message,
		time: new Date().toISOString(),
	});
}

/** Per-service details to persist after deploy */
type ServiceDeployDetails = {
	cloudResources?: CloudResources | null;
};

type DeployExecutionResult = {
	target: DeploymentTarget;
	deployResult: DeployResult;
	releaseArtifact: DeploymentReleaseArtifact;
};

async function sendDeployComplete(
	ws: any,
	deployUrl: string =  "",
	success: boolean,
	deployConfig: DeployConfig,
	deploySteps: DeployStep[],
	userID: string,
	deploymentTarget: string,
	customDns?: AddRoute53DnsResult | null,
	serviceDetails?: ServiceDeployDetails | null,
	durationMs?: number,
	lifecycle?: DeploymentLifecycleOptions
) {
	const doneStep = deploySteps.find((step) => step.id === "done");
	if (doneStep && doneStep.status === "in_progress") {
		doneStep.status = success ? "success" : "error";
	}

	// Persist before notifying the client so refetches and retries see instanceId
	console.log("Saving deployment result to database...");
	const failure =
		!success
			? (lifecycle?.failure ??
				classifyDeploymentFailure({
					deployConfig,
					steps: deploySteps,
					errorMessage: lifecycle?.errorMessage,
					finalStatus: lifecycle?.finalStatus ?? null,
				}))
			: null;
	if (!userID) {
		emitPersistenceWarningToDeployLogs(
			ws,
			deploySteps,
			"Warning: deploy metadata was not persisted because userID is missing."
		);
	}
	const activeDeployRun = (ws as { __deployRun?: ActiveDeployRun } | null | undefined)?.__deployRun ?? null;
	try {
		await saveDeploymentToDB(
			deployConfig,
			deployUrl,
			success,
			deploySteps,
			userID,
			serviceDetails,
			durationMs,
			lifecycle?.releaseArtifact ?? null,
			failure,
			activeDeployRun
		);
	} catch (err) {
		console.error("Failed to save deployment to DB:", err);
		emitPersistenceWarningToDeployLogs(
			ws,
			deploySteps,
			`Warning: failed to persist deploy metadata: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	// PostHog: server-truth event (never blocks deploy completion).
	if (userID) {
		const failedStep = deploySteps.find((s) => s.status === "error")?.id ?? null;
		captureServerEvent({
			distinctId: userID,
			event: "deploy_completed",
			properties: {
				success,
				duration_ms: durationMs ?? null,
				repo_name: deployConfig.repoName ?? null,
				service_name: deployConfig.serviceName ?? null,
				branch: deployConfig.branch ?? null,
				commit_sha: deployConfig.commitSha ?? null,
				failed_step: failedStep,
				steps_count: deploySteps.length,
				has_custom_domain: Boolean(customDns?.success && customDns.deployUrl),
			},
		});
	}

	const resolvedHostedSubdomain = hostedSubdomainOrDefault(
		deployConfig.repoName,
		deployConfig.hostedSubdomain
	);
	if (!resolvedHostedSubdomain) {
		throw new Error("Missing hosted subdomain for deploy completion payload.");
	}
	const resolvedFinalStatus =
		lifecycle?.finalStatus ??
		(success
			? transitionDeploymentStatus(deployConfig.status, "deployment_succeeded")
			: transitionDeploymentStatus(deployConfig.status, "deployment_failed"));

	const payload: {
		success: boolean;
		hosted_subdomain: string;
		deploymentTarget: string | null;
		finalStatus: DeployConfig["status"];
		customDnsAdded?: boolean;
		customDnsError?: string | null;
		error?: string | null;
		cloudResources?: CloudResources | null;
	} = {
		success,
		hosted_subdomain: resolvedHostedSubdomain,
		deploymentTarget: deploymentTarget ?? null,
		finalStatus: resolvedFinalStatus,
	};
	if (serviceDetails?.cloudResources) payload.cloudResources = serviceDetails.cloudResources;
	if (customDns) {
		payload.customDnsAdded = customDns.success;
		if (!customDns.success) {
			payload.customDnsError = customDns.error ?? null;
		}
	}
	if (!success && lifecycle?.errorMessage) {
		payload.error = lifecycle.errorMessage;
	}

	if (userID && deployConfig.repoName && deployConfig.serviceName) {
		deployLogsStore.setStatus(
			userID,
			deployConfig.repoName,
			deployConfig.serviceName,
			success ? "success" : "error",
			success ? null : (payload.error ?? "Deployment failed")
		);
		deployLogsStore.broadcastCompletion(
			userID,
			deployConfig.repoName,
			deployConfig.serviceName,
			payload
		);
	} else {
		emitWorkerSocketEvent(ws, WORKER_SOCKET_SERVER_EVENTS.deployComplete, payload);
	}
}

async function runStaticSiteDeployment(params: {
	region: string;
	repoName: string;
	repoFullName: string;
	branch: string;
	commitSha?: string;
	deployConfig: DeployConfig;
	scanResultsForCodebuild?: SDArtifactsResponse;
	dockerHub?: DockerHubCredentials;
	envVarsBase64?: string;
	token: string;
	send: (msg: string, stepId: string) => void;
}): Promise<DeployExecutionResult> {
	// Static deploys are intentionally modeled to look like runtime deploys:
	// we still return a deploy result plus a release artifact so history, analysis,
	// and UI rendering can stay provider-agnostic.
	// send("Publishing static site via CodeBuild -> S3...", "build");
	const staticBuild = await runStaticSiteCodeBuildPipeline({
		region: params.region,
		deployConfig: params.deployConfig,
		repoFullName: params.repoFullName,
		branch: params.branch,
		commitSha: params.commitSha,
		token: params.token,
		envVarsBase64: params.envVarsBase64,
		dockerHub: params.dockerHub,
		send: params.send,
	});
	if (!staticBuild.success) {
		params.send("Static site build or S3 sync failed. Check CodeBuild logs above.", "build");
		throw new Error("CodeBuild failed: static site pipeline did not succeed");
	}

	const bucket = config.STATIC_SITE_BUCKET!.trim();
	const prefix = buildStaticSiteS3Prefix(
		params.repoName,
		params.deployConfig.serviceName
	).replace(/^\/+/, "");
	const publicBase = config.STATIC_SITE_PUBLIC_BASE_URL!.trim().replace(/\/+$/, "");
	const unitForUrl = pickDeployUnitForBuild(
		params.scanResultsForCodebuild!,
		params.deployConfig.serviceName
	);
	const serviceUrls = new Map<string, string>();
	if (unitForUrl?.name) serviceUrls.set(unitForUrl.name, publicBase);
	else serviceUrls.set("site", publicBase);

	return {
		target: "static_s3",
		deployResult: {
			success: true,
			baseUrl: publicBase,
			serviceUrls,
			instanceId: `s3:${bucket}/${prefix}`,
			sharedAlbDns: config.STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID?.trim() || "",
		},
		releaseArtifact: buildStaticSiteReleaseArtifact({
			deployConfig: params.deployConfig,
			region: params.region,
			bucket,
			keyPrefix: prefix,
			publicBaseUrl: publicBase,
			cloudFrontDistributionId: config.STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID?.trim() || null,
		}),
	};
}

async function runContainerDeployment(params: {
	region: string;
	accountId: string;
	repoName: string;
	repoFullName: string;
	branch: string;
	commitSha?: string;
	imageTag: string;
	deployConfig: DeployConfig;
	buildInputs: AnalyzeBuildInputs;
	dockerHub?: DockerHubCredentials;
	envVarsBase64?: string;
	token: string;
	ws: any;
	send: (msg: string, stepId: string) => void;
}): Promise<DeployExecutionResult> {
	// Container deploys have two operator-relevant branches:
	// 1. reuse a prebuilt image discovered by analyze/stream
	// 2. build a new image in CodeBuild, then roll it out to ECS
	const {
		buildInputs,
		region,
		accountId,
		repoName,
		repoFullName,
		branch,
		commitSha,
		imageTag,
		deployConfig,
		dockerHub,
		envVarsBase64,
		token,
		ws,
		send,
	} = params;

	const ecrRegistry = getEcrRegistry(accountId, region);
	const ecrRepoName = buildScopedEcrRepoName(repoName, buildInputs.scanResultsTyped?.package_path);
	const prebuiltImage =
		buildInputs.useRailpackBuild && buildInputs.scanResultsForCodebuild
			? resolveSdArtifactsPrebuiltImage({
				scan: buildInputs.scanResultsForCodebuild,
				repoName,
				preferredServiceName: deployConfig.serviceName,
			})
			: null;

	let releaseEcrRegistry = ecrRegistry;
	let releaseEcrRepoName = ecrRepoName;
	let releaseImageTag = imageTag;
	let resolvedImageUri = getEcrImageUri(accountId, region, ecrRepoName, imageTag);
	let resolvedImageDigest: string | null = null;

	if (prebuiltImage) {
		// The analyze pipeline may already have produced the exact image we want.
		// Reusing it makes retries faster and keeps the release artifact tied to the original image digest.
		releaseEcrRegistry = parseRegistryFromImageUri(prebuiltImage.imageUri || "") || ecrRegistry;
		releaseEcrRepoName = prebuiltImage.ecrRepoName;
		releaseImageTag = prebuiltImage.imageTag;
		resolvedImageUri = prebuiltImage.imageUri
			? imageRefFromUriAndDigest(prebuiltImage.imageUri, prebuiltImage.imageDigest)
			: getEcrImageUri(accountId, region, prebuiltImage.ecrRepoName, prebuiltImage.imageTag);
		resolvedImageDigest = prebuiltImage.imageDigest;
		send(
			`Using prebuilt image for ${prebuiltImage.unit.name}; skipping CodeBuild rebuild (${resolvedImageUri}).`,
			"build"
		);
	} else {
		send("Preparing ECR repositories...", "build");
		await ensureEcrRepository(ecrRepoName, region, send);

		const hasCommit = Boolean(commitSha);
		let imageTagExists = hasCommit;
		if (hasCommit) {
			// If this immutable tag already exists, treat the image as a cached release candidate
			// and avoid rebuilding unless we truly need to.
			imageTagExists = await ecrImageTagExists(region, ecrRepoName, imageTag);
		}

		if (!hasCommit || !imageTagExists) {
			const roleArn = await ensureCodeBuildRole(region, send);
			const projectName = await ensureCodeBuildProject(region, roleArn, send);
			const imageUriForBuild = getEcrImageUri(accountId, region, ecrRepoName, imageTag);

			if (buildInputs.isExistingDocker) {
				send("CodeBuild will build from the repository Dockerfile.", "build");
			} else if (buildInputs.useRailpackBuild) {
				send("CodeBuild will use Railpack.", "build");
			} else if (!buildInputs.canBuildContainerImage) {
				throw new Error("No Railpack plan or existing Dockerfile found for container build.");
			}

			const buildspec = generateBuildspec({
				ecrRegistry,
				ecrRepoName,
				imageTag,
				region,
				scanResults: buildInputs.scanResultsForCodebuild,
				deployUnit: buildInputs.railpackUnit,
				railpack:
					buildInputs.useRailpackBuild &&
					buildInputs.railpackUnit &&
					hasUsableRailpackPlan(buildInputs.railpackPlan)
						? {
							plan: buildInputs.railpackPlan,
							contextRelative: buildInputs.railpackUnit.root || ".",
							railpackVersion: buildInputs.scanResultsForCodebuild?.railpack_version ?? null,
							imageUri: imageUriForBuild,
						}
						: undefined,
			});

			const buildId = await startBuild({
				region,
				projectName,
				repoFullName,
				branch,
				commitSha,
				githubToken: token,
				buildspec,
				envVarsBase64,
				dockerHub,
				send,
			});

			const buildResult = await waitForBuildAndStreamLogsPhased({ buildId, region, send });
			if (!buildResult.success) {
				send("Docker image build failed. Check build logs above.", "build");
				throw new Error("CodeBuild failed: Docker image build did not succeed");
			}
		} else {
			send(`CodeBuild skipped: image ${imageTag} already exists in ECR.`, "build");
		}

		const primaryImage = await describeImageRefWithFallback({
			region,
			ecrRegistry,
			ecrRepoName,
			imageTag,
			send,
		});
		resolvedImageUri = primaryImage.imageUri || resolvedImageUri;
		resolvedImageDigest = primaryImage.imageDigest ?? null;
	}

	send(`Image ready: ${resolvedImageUri}`, "build");
	send("Deploying to ECS Fargate...", "deploy");
	const deployResult = await deployRailpackServerToEcs({
		deployConfig,
		region,
		repoName,
		imageUri: resolvedImageUri,
		containerPort: buildInputs.railpackUnit?.port || 3000,
		unitName: buildInputs.railpackUnit?.name || "app",
		ws,
		send,
	});

	const ecsInstanceRef = deployResult.instanceId.slice(4)
	const rolloutParts = ecsInstanceRef.split("/");
	const rolloutCluster = rolloutParts[0]?.trim() || config.ECS_CLUSTER_NAME?.trim() || "";
	const rolloutServiceName = rolloutParts[1]?.trim() || "";
	const rolloutTaskDefinitionArn = deployResult.taskDefinitionArn?.trim() || "";
	if (rolloutCluster && rolloutServiceName && rolloutTaskDefinitionArn) {
		// This is the earliest place we can distinguish "ECS accepted the update" from
		// "new tasks actually became healthy". When this fails, operators should inspect ECS events first.
		const rolloutResult = await waitForEcsServiceRollout({
			region,
			cluster: rolloutCluster,
			serviceName: rolloutServiceName,
			taskDefinitionArn: rolloutTaskDefinitionArn,
			logGroup: config.ECS_LOG_GROUP?.trim() || "/ecs/smartdeploy-railpack",
			send,
		});
		if (!rolloutResult.success) {
			throw new Error(`ECS rollout failed: ${rolloutResult.message}`);
		}
	} else {
		// We still continue to HTTP verification because some older/partial deploy records
		// do not expose enough ECS metadata for the rollout watcher.
		send(
			"OK: ECS rollout watcher skipped because task metadata was unavailable; continuing to verification.",
			"rollout"
		);
	}

	return {
		target: "ecs",
		deployResult,
		releaseArtifact: buildEcrImageReleaseArtifact({
			deployConfig,
			region,
			ecrRegistry: releaseEcrRegistry,
			ecrRepoName: releaseEcrRepoName,
			imageTag: releaseImageTag,
			imageUri: resolvedImageUri,
			imageDigest: resolvedImageDigest,
			serviceImages: [],
		}),
	};
}

async function configureDeploymentDns(params: {
	deployResult: DeployResult;
	deployConfig: DeployConfig;
	target: DeploymentTarget;
	region: string;
	ws: any;
	send: (msg: string, stepId: string) => void;
}): Promise<{ deployUrl: string; dnsResult: AddRoute53DnsResult | null }> {
	// Verification should always be able to fall back to the provider URL even if custom DNS is slow
	// or misconfigured, so we keep both the pre-DNS and post-DNS URLs around.
	
	const dnsResult: AddRoute53DnsResult | null = null;
	const sharedAlbDns = params.deployResult.sharedAlbDns?.trim() || "";
	const hostedSubdomain = params.deployConfig.hostedSubdomain;

	if(!hostedSubdomain) {
		return { deployUrl: "", dnsResult }
	}

	const deployUrl = hostedUrlFromSubdomain(hostedSubdomain);

	if (!(params.deployResult.success && params.deployConfig.serviceName?.trim() && (sharedAlbDns || deployUrl))) {
		return { deployUrl, dnsResult };
	}

	params.send("Configuring Route 53 DNS...", "done");
	const resolvedDnsResult = await addRoute53DnsRecord(
		deployUrl,
		hostedSubdomain,
		params.deployConfig.serviceName,
		{
			deploymentTarget: params.target,
			sharedAlbDns: sharedAlbDns || null,
			awsRegion: params.region,
		}
	);

	if (resolvedDnsResult.success) {
		params.send(`Route 53 DNS ready: ${resolvedDnsResult.deployUrl}`, "done");
		const customHost = getDeployUrlHostname(resolvedDnsResult.deployUrl);
		if (customHost && params.deployResult.albListenerArn && params.deployResult.targetGroupArn) {
			params.send(`Configuring ALB host rule for ${customHost}...`, "done");
			await ensureHostRule(
				params.deployResult.albListenerArn,
				customHost,
				params.deployResult.targetGroupArn,
				params.region,
				params.ws
			);
		}
	} else {
		params.send(`WARNING: Route 53 DNS failed: ${resolvedDnsResult?.error ?? "Unknown error"}`, "done");
		console.warn(`Route 53 DNS failed for ${deployUrl}: ${resolvedDnsResult?.error ?? "Unknown error"}`);
	}

	return { deployUrl, dnsResult: resolvedDnsResult };
}

/**
 * Handles AWS deployment using CodeBuild + ECR pipeline.
 * No local clone required: CodeBuild pulls source directly from GitHub.
 *
 * Operator flow map:
 * 1. Validate AWS + deploy prerequisites
 * 2. Resolve the exact source branch and artifact to release
 * 3. Deploy to the provider target and capture cloud resource metadata
 * 4. Attach Smart Deploy DNS when available
 * 5. Verify the live service and persist the final outcome
 */
async function handleAWSCodeBuildDeploy(
	deployConfig: DeployConfig,
	token: string,
	ws: any,
	userID: string,
	deployStartTime: number,
	send: (msg: string, stepId: string) => void,
	deploySteps: DeployStep[],
): Promise<string> {
	// This is the top-level deploy orchestrator for build-and-run AWS targets.
	// It intentionally reads as a phase pipeline so developers can debug from top to bottom.
	const region = deployConfig.region || config.AWS_REGION;
	const repoUrl = deployConfig.repoUrl;
	const repoName = repoUrl.split('/').pop()?.replace('.git', '') || 'app';
	const parsed = parseGithubOwnerRepo(repoUrl);
	const repoFullName = parsed ? `${parsed.owner}/${parsed.repo}` : repoName;
	const buildInputs = resolveAnalyzeBuildInputs(deployConfig);
	const { useStaticS3 } = buildInputs;
	let target: DeploymentTarget = useStaticS3 ? 'static_s3' : 'ecs';
	deployConfig.deploymentTarget = target;

	const deployStepsKey = useStaticS3 ? 'static-s3-codebuild' : 'ecs-codebuild';
	sendDeploySteps(ws, AWS_DEPLOY_STEPS[deployStepsKey], deployStepsKey);

	// Phase 1: validate credentials and target prerequisites before we touch any mutable infra.
	send('Authenticating with AWS...', 'auth');
	if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
		process.env.AWS_ACCESS_KEY_ID = config.AWS_ACCESS_KEY_ID;
		process.env.AWS_SECRET_ACCESS_KEY = config.AWS_SECRET_ACCESS_KEY;
	}
	process.env.AWS_DEFAULT_REGION = region;

	const stsClient = new STSClient(getAwsClientConfig(region));
	const identity = await stsClient.send(new GetCallerIdentityCommand({}));
	void identity;

	if (buildInputs.shouldStaticS3Build && !staticSiteDeployConfigured()) {
		throw new Error(
			'Static site deploy requires STATIC_SITE_BUCKET and STATIC_SITE_PUBLIC_BASE_URL on the Smart Deploy server.'
		);
	}
	if (!useStaticS3 && !ecsRailpackFromEcrConfigured()) {
		throw new Error(
			'Container deploy requires ECS configuration. Set ECS_CLUSTER_NAME, ECS_SUBNET_IDS (comma-separated), ECS_SECURITY_GROUP_IDS (comma-separated), and ECS_EXECUTION_ROLE_ARN.'
		);
	}

	const branch = await resolveDeploymentBranch({
		deployConfig,
		parsedRepo: parsed,
		token,
		send,
	});
	const commitSha = deployConfig.commitSha?.trim();
	const imageTag = commitSha ? commitSha.substring(0, 6) : `deploy-${Date.now().toString(36)}`;

	// Phase 2: produce the release artifact, then hand it to the chosen runtime target.
	const envBase64 = deployConfig.envVars
		? Buffer.from(deployConfig.envVars, 'utf8').toString('base64')
		: undefined;
	const dockerHub = resolveDockerHubCredentials(send);
	const execution = useStaticS3
		? await runStaticSiteDeployment({
			region,
			repoName,
			repoFullName,
			branch,
			commitSha,
			deployConfig,
			scanResultsForCodebuild: buildInputs.scanResultsForCodebuild,
			dockerHub,
			envVarsBase64: envBase64,
			token,
			send,
		})
		: await runContainerDeployment({
			region,
			accountId: await getAwsAccountId(region),
			repoName,
			repoFullName,
			branch,
			commitSha,
			imageTag,
			deployConfig,
			buildInputs,
			dockerHub,
			envVarsBase64: envBase64,
			token,
			ws,
			send,
		});
	target = execution.target;
	deployConfig.deploymentTarget = execution.target;
	const deployResult = execution.deployResult;
	let releaseArtifact = execution.releaseArtifact;

	// Capture enough provider metadata to make history, rollback, and failure analysis reproducible.
	const serviceDetails: ServiceDeployDetails = {};
	serviceDetails.cloudResources = cloudResourcesFromDeployResult(
		target,
		region,
		deployResult,
		target === 'static_s3'
			? {
				bucket: config.STATIC_SITE_BUCKET?.trim(),
				keyPrefix: buildStaticSiteS3Prefix(repoName, deployConfig.serviceName).replace(/^\/+/, ''),
				cloudFrontDistributionId: config.STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID?.trim() || null,
			}
			: {
				cluster: config.ECS_CLUSTER_NAME?.trim(),
				service: deployResult.instanceId.slice(4).split('/').pop(),
			}
	);
	const mergedRelease = attachDeployConfigToReleaseArtifact(releaseArtifact, {
		...deployConfig,
		...(serviceDetails.cloudResources ? { cloudResources: serviceDetails.cloudResources } : {}),
	} as DeployConfig);
	if (mergedRelease) {
		releaseArtifact = mergedRelease as DeploymentReleaseArtifact;
	}

	// Phase 3: normalize the provider result into a deploy URL.
	if (!deployResult.success || deployResult.baseUrl === '') {
		send('Deployment failed: Server is not responding. Check your application and try again.', 'deploy');
		throw new Error('Deployment failed: Server is not responding. Check your application and try again.')
	}

	let deployUrl = deployResult.baseUrl;
	deployConfig.hostedSubdomain = subdomainFromHostedUrl(deployUrl);


	// Phase 4: attach our stable custom hostname when DNS is configured for this service.
	const dnsOutcome = await configureDeploymentDns({
		deployResult,
		deployConfig,
		target,
		region,
		ws,
		send
	});
	deployUrl = dnsOutcome.deployUrl;
	const dnsResult = dnsOutcome.dnsResult;
	console.log(dnsResult)

	// Phase 5: verify what is live, then persist the final status and release metadata.
	let finalSuccess: boolean = deployResult.success;
	let lifecycle: DeploymentLifecycleOptions | undefined;
	const prematureDoneStep = deploySteps.find((step) => step.id === 'done');
	if (prematureDoneStep) {
		// The UI may have seen a provisional "done" during deploy/DNS steps.
		// Hold that step open until live verification tells us whether the release is actually healthy.
		prematureDoneStep.status = 'pending';
	}
	if (!dnsResult || !dnsResult.success) {
		finalSuccess = false;
		const dnsError = dnsResult?.success === false ? dnsResult.error : "DNS not configured properly.";
		setStepState(deploySteps, "verify", "error");
		send(`ERROR: DNS not configured properly: ${dnsError}`, "verify");
		lifecycle = {
			errorMessage: `DNS not configured properly: ${dnsError}`,
			finalStatus: "failed",
			releaseArtifact,
		};
	} else if (deployResult.success && deployUrl) {
		const verification = await verifyDeploymentReadiness({
			deployConfig,
			deployUrl,
			userID,
			token,
			send,
			deploySteps,
			serviceDetails,
		});
		finalSuccess = verification.success;
		if (!verification.success) {
			lifecycle = {
				errorMessage: verification.errorMessage,
				finalStatus: "failed",
				releaseArtifact,
			};
		}
	}

	if (finalSuccess) {
		let deploySummary = 'Deployment completed.\n';
		deploySummary += `Verified URL: ${deployUrl}\n`;
		deploySummary += `Runtime ID: ${deployResult.instanceId}\n`;
		deploySummary += '\nService URLs:\n';
		for (const [name, url] of deployResult.serviceUrls.entries()) {
			deploySummary += `  - ${name}: ${url}\n`;
		}
		send(`SUCCESS: ${deploySummary.trimEnd()}`, 'done');
	}

	const doneStep = deploySteps.find((step) => step.id === 'done');
	if (doneStep) doneStep.status = finalSuccess ? 'success' : 'error';

	const durationMs = Date.now() - deployStartTime;
	await sendDeployComplete(
		ws,
		deployUrl,
		finalSuccess,
		deployConfig,
		deploySteps,
		userID,
		target,
		dnsResult,
		serviceDetails,
		durationMs,
		lifecycle ?? { releaseArtifact }
	);

	return finalSuccess ? "success" : 'error';
}

