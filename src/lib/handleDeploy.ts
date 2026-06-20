import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import config from "../config";
import {
	DeploymentTarget,
	DeployConfig,
	CloudResources,
	DeployStep,
	SDArtifactsResponse,
	DeploymentHistoryEntry,
	DeploymentReleaseArtifact,
} from "../app/types";
import { cloudResourcesFromDeployResult, isEcsCloudResources } from "./cloudResources";
import { subdomainFromHostedUrl, getDeploymentHostedUrl } from "./hostedUrl";
import { buildVerificationCandidates, fetchWithTimeout } from "./deploymentHealthProbe";
import { MultiServiceConfig } from "./multiServiceDetector";
import { dbHelper } from "../db-helper";
import { createWebSocketLogger, createDeployStepsLogger } from "./websocketLogger";
import {
	type ActiveDeployRun,
	startDeploymentRun,
	createDeployRunStepFlushHandler,
} from "./deployRunTracker";
import { uploadDeployRunLogs } from "./aws/deployRunLogs";
import { captureDeploymentScreenshotAndUpload } from "./deploymentScreenshot";
import { isSdArtifactsAnalyzeScan } from "./scanResultNormalization";
import {
	hasUsableRailpackPlan,
	pickDeployUnitForBuild,
	resolveSdArtifactsPrebuiltImage,
} from "./sdArtifactsBuildContext";

// AWS imports
import { configureAlb, resolveServices, type EC2Result } from "./aws/handleEC2";
import { isExistingDockerUnit } from "./deployRouting";

// CodeBuild + ECR imports
import {
	getAwsAccountId,
	getEcrRegistry,
	getEcrImageUri,
	buildScopedEcrRepoName,
	ensureEcrRepository,
	ensureEc2EcrPullPolicy,
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
import { SSM_PROFILE_NAME } from "./aws/ec2SsmHelpers";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { EC2Client, TerminateInstancesCommand } from "@aws-sdk/client-ec2";
import { getAwsClientConfig } from "./aws/sdkClients";
import { captureServerEvent } from "./analytics/posthogServer";

import { addRoute53DnsRecord, AddRoute53DnsResult, getDeployUrlHostname } from "./route53Dns";
import { ensureHostRule } from "./aws/awsHelpers";
import { githubAuthenticatedCloneUrl } from "./githubGitAuth";
import { fetchRepoMetadata, parseGithubOwnerRepo } from "./githubRepoArchive";
import {
	canManageRuntimeDeploymentStatus,
	isInProgressDeploymentStatus,
	normalizeDeploymentStatus,
	transitionDeploymentStatus,
} from "./deploymentStatus";
import * as deployLogsStore from "./deployLogsStore";
import {
	attachDeployConfigToReleaseArtifact,
	buildEcrImageReleaseArtifact,
	buildStaticSiteReleaseArtifact,
	deployConfigFromReleaseArtifact,
	ecrImageRefFromArtifact,
	hasUsableReleaseArtifact,
	isLegacyEc2ConfigReleaseArtifact,
	isEcrImageReleaseArtifact,
	isStaticSiteReleaseArtifact,
	serviceImageRefsFromArtifact,
} from "./deploymentReleaseArtifacts";
import { classifyDeploymentFailure, type DeploymentFailureRecord } from "./deploymentFailureClassification";

type DeploymentLifecycleOptions = {
	errorMessage?: string | null;
	postPersistConfig?: DeployConfig | null;
	finalStatus?: DeployConfig["status"] | null;
	rolledBack?: boolean;
	releaseArtifact?: DeploymentReleaseArtifact | Record<string, unknown> | null;
	failure?: DeploymentFailureRecord | null;
};

type DeployLoggerOptions = {
	onStepsChange?: (steps: DeployStep[]) => void;
	broadcast?: (id: string, msg: string) => void;
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
		postPersistConfig?: DeployConfig | null;
	};

type VerificationTarget = {
	label: string;
	url: string;
};

function cloneDeployConfigSnapshot(config: DeployConfig): DeployConfig {
	return {
		...config,
		cloudResources: config.cloudResources
			? (JSON.parse(JSON.stringify(config.cloudResources)) as CloudResources)
			: null,
		scanResults:
			config.scanResults && typeof config.scanResults === "object"
				? JSON.parse(JSON.stringify(config.scanResults))
				: config.scanResults,
	};
}

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

function buildMultiServiceConfigFromDeployConfig(deployConfig: DeployConfig): MultiServiceConfig {
	const scanResults = deployConfig.scanResults;
	if (!isSdArtifactsAnalyzeScan(scanResults)) {
		return {
			isMultiService: false,
			services: [],
			hasDockerCompose: false,
			isMonorepo: false,
		};
	}
	const units = scanResults.deploy_units;
	return {
		isMultiService: units.length > 1,
		services: units.map((unit) => ({
			name: unit.name,
			workdir: unit.root || ".",
			dockerfile: unit.type === "existing_docker" ? "Dockerfile" : `railpack:${unit.name}`,
			port: unit.port,
			build_context: unit.root || ".",
		})),
		hasDockerCompose: false,
		isMonorepo: units.length > 1,
	};
}

function isAwsEc2InstanceId(id: string | undefined | null): boolean {
	const t = id?.trim() ?? "";
	return /^i-[a-f0-9]{8,17}$/i.test(t);
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

function shouldForceVerificationFailure(deployConfig: DeployConfig): boolean {
	if (process.env.NODE_ENV === "production") return false;
	const enabled = (process.env.SMARTDEPLOY_FORCE_VERIFICATION_FAILURE || "").trim() === "1";
	if (!enabled) return false;
	const target = (process.env.SMARTDEPLOY_FORCE_VERIFICATION_FAILURE_TARGET || "").trim().toLowerCase();
	if (!target) return true;
	const candidates = [
		`${deployConfig.repoName}/${deployConfig.serviceName}`,
		deployConfig.repoName,
		deployConfig.serviceName,
	]
		.map((value) => (value || "").trim().toLowerCase())
		.filter(Boolean);
	return candidates.includes(target);
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

function buildVerificationTargets(baseUrl?: string | null, customUrl?: string | null): VerificationTarget[] {
	const seen = new Set<string>();
	const targets: VerificationTarget[] = [];

	const addTarget = (label: string, url?: string | null) => {
		const trimmed = url?.trim();
		if (!trimmed) return;
		if (seen.has(trimmed)) return;
		seen.add(trimmed);
		targets.push({ label, url: trimmed });
	};

	addTarget("base URL", baseUrl);
	addTarget("custom URL", customUrl);

	return targets;
}

async function verifyDeploymentReadiness(params: {
	deployConfig: DeployConfig;
	deployUrl: string;
	customUrl?: string | null;
	userID?: string;
	token?: string;
	send: (msg: string, stepId: string) => void;
	deploySteps: DeployStep[];
	rollbackHistoryEntry?: DeploymentHistoryEntry | null;
	serviceDetails?: ServiceDeployDetails | null;
}): Promise<VerificationResult> {
	const { deployConfig, deployUrl, customUrl, userID, token, send, deploySteps, rollbackHistoryEntry, serviceDetails } = params;
	const verifyingStatus = transitionDeploymentStatus(deployConfig.status, "verification_requested");
	deployConfig.status = verifyingStatus;
	setStepState(deploySteps, "verify", "in_progress");
	await updatePersistedDeploymentStatus(deployConfig, userID, verifyingStatus, {
		...(serviceDetails?.cloudResources ? { cloudResources: serviceDetails.cloudResources } : {}),
	});

	const targets = buildVerificationTargets(deployUrl, customUrl);
	if (targets.length === 0) {
		setStepState(deploySteps, "verify", "error");
		send("ERROR: Deployment verification could not start because no reachable URL was available.", "verify");
		return {
			success: false,
			errorMessage: "Deployment verification could not start because no reachable URL was available.",
		};
	}

	if (shouldForceVerificationFailure(deployConfig)) {
		setStepState(deploySteps, "verify", "error");
		send("Verification test hook enabled. Forcing verification failure for this deployment.", "verify");
		send("ERROR: Deployment verification failed after all retry attempts.", "verify");
		await emitEcsVerificationDiagnostics({
			deployConfig,
			send,
			serviceDetails: serviceDetails ?? null,
		});
		const rollbackResult = await attemptAutomaticRollback({
			deployConfig,
			rollbackHistoryEntry: rollbackHistoryEntry ?? null,
			serviceDetails: serviceDetails ?? null,
			userID,
			token,
			send,
			deploySteps,
		});

		if (rollbackResult.success) {
			return {
				success: false,
				errorMessage: rollbackResult.message,
				postPersistConfig: rollbackResult.restoredConfig,
			};
		}

		return {
			success: false,
			errorMessage: rollbackResult.message,
		};
	}

	const maxRounds = 10;
	const requestTimeoutMs = 8_000;
	const roundDelayMs = 20_000;
	const verificationDeadlineMs = 300_000;
	for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
		const target = targets[targetIndex]!;
		const candidates = buildVerificationCandidates(target.url);
		if (candidates.length === 0) {
			continue;
		}

		send(
			`Starting verification for ${target.label} (${targetIndex + 1}/${targets.length}): ${target.url}`,
			"verify"
		);

		const verificationDeadlineAt = Date.now() + verificationDeadlineMs;
		let targetVerified = false;
		for (let round = 1; round <= maxRounds; round += 1) {
			const remainingBudgetMs = verificationDeadlineAt - Date.now();
			if (remainingBudgetMs <= 0) {
				send(`Verification deadline reached before ${target.label} became healthy.`, "verify");
				break;
			}

			send(`Verification round ${round}/${maxRounds} for ${target.label}.`, "verify");
			const roundController = new AbortController();
			let roundResolved = false;
			const perCandidateTimeoutMs = Math.max(1_000, Math.min(requestTimeoutMs, remainingBudgetMs));
			const probes = candidates.map(async (candidate) => {
				send(`Verification attempt ${round}/${maxRounds} for ${target.label}: ${candidate}`, "verify");
				try {
					const response = await fetchWithTimeout(candidate, perCandidateTimeoutMs, roundController.signal);
					if (response.status < 500) {
						return {
							candidate,
							statusCode: response.status,
						};
					}
					throw new Error(`HTTP ${response.status}`);
				} catch (error) {
					if (roundResolved && roundController.signal.aborted) {
						throw error;
					}
					throw error;
				}
			});

			try {
				const verified = await Promise.any(probes);
				roundResolved = true;
				roundController.abort();
				send(
					`SUCCESS: Verification passed for ${target.label} with HTTP ${verified.statusCode} at ${verified.candidate}`,
					"verify"
				);
				targetVerified = true;
				if (targetIndex === targets.length - 1) {
					setStepState(deploySteps, "verify", "success");
					return {
						success: true,
						verifiedUrl: verified.candidate,
						statusCode: verified.statusCode,
					};
				}
				break;
			} catch {
				roundController.abort();
			}

			if (round < maxRounds) {
				const delayMs = Math.min(roundDelayMs, Math.max(0, verificationDeadlineAt - Date.now()));
				if (delayMs > 0) {
					await new Promise((resolve) => setTimeout(resolve, delayMs));
				}
			}
		}

		if (!targetVerified) {
			setStepState(deploySteps, "verify", "error");
			send(`ERROR: Deployment verification failed for ${target.label}.`, "verify");
			send("ERROR: Deployment verification failed after all retry attempts.", "verify");
			await emitEcsVerificationDiagnostics({
				deployConfig,
				send,
				serviceDetails: serviceDetails ?? null,
			});
			const rollbackResult = await attemptAutomaticRollback({
				deployConfig,
				rollbackHistoryEntry: rollbackHistoryEntry ?? null,
				serviceDetails: serviceDetails ?? null,
				userID,
				token,
				send,
				deploySteps,
			});

			if (rollbackResult.success) {
				return {
					success: false,
					errorMessage: `Deployment verification failed for ${target.label}. ${rollbackResult.message}`,
					postPersistConfig: rollbackResult.restoredConfig,
				};
			}

			return {
				success: false,
				errorMessage: `Deployment verification failed for ${target.label}. ${rollbackResult.message}`,
			};
		}
	}

	setStepState(deploySteps, "verify", "error");
	send("ERROR: Deployment verification failed after all retry attempts.", "verify");
	await emitEcsVerificationDiagnostics({
		deployConfig,
		send,
		serviceDetails: serviceDetails ?? null,
	});
	const rollbackResult = await attemptAutomaticRollback({
		deployConfig,
		rollbackHistoryEntry: rollbackHistoryEntry ?? null,
		serviceDetails: serviceDetails ?? null,
		userID,
		token,
		send,
		deploySteps,
	});

	if (rollbackResult.success) {
		return {
			success: false,
			errorMessage: rollbackResult.message,
			postPersistConfig: rollbackResult.restoredConfig,
		};
	}

	return {
		success: false,
		errorMessage: rollbackResult.message,
	};
}

async function attemptAutomaticRollback(params: {
	deployConfig: DeployConfig;
	rollbackHistoryEntry: DeploymentHistoryEntry | null;
	serviceDetails: ServiceDeployDetails | null;
	userID?: string;
	token?: string;
	send: (msg: string, stepId: string) => void;
	deploySteps: DeployStep[];
}): Promise<{ success: boolean; message: string; restoredConfig?: DeployConfig | null }> {
	return restoreDeploymentFromHistory({
		...params,
		mode: "automatic",
	});
}

async function restoreDeploymentFromHistory(params: {
	deployConfig: DeployConfig;
	rollbackHistoryEntry: DeploymentHistoryEntry | null;
	serviceDetails: ServiceDeployDetails | null;
	userID?: string;
	token?: string;
	send: (msg: string, stepId: string) => void;
	deploySteps: DeployStep[];
	mode: "automatic" | "manual";
}): Promise<{ success: boolean; message: string; restoredConfig?: DeployConfig | null; targetLabel?: string }> {
	const { deployConfig, rollbackHistoryEntry, serviceDetails, userID, token, send, deploySteps } = params;
	const isAutomatic = params.mode === "automatic";
	const rollbackNoun = isAutomatic ? "automatic rollback" : "rollback";

	if (!rollbackHistoryEntry) {
		send(
			isAutomatic
				? "ERROR: Verification failed and no successful deployment history entry is available for rollback."
				: "ERROR: No successful deployment history entry is available for rollback.",
			"rollback"
		);
		setStepState(deploySteps, "rollback", "error");
		return {
			success: false,
			message: isAutomatic
				? "Deployment verification failed and no previous successful deployment history entry was available for rollback."
				: "No previous successful deployment history entry was available for rollback.",
		};
	}

	const releaseArtifact = rollbackHistoryEntry.releaseArtifact;
	if (!hasUsableReleaseArtifact(releaseArtifact)) {
		send(
			isAutomatic
				? "ERROR: Verification failed and the last successful deployment has no rollback artifact."
				: "ERROR: The selected deployment history entry has no rollback artifact.",
			"rollback"
		);
		setStepState(deploySteps, "rollback", "error");
		return {
			success: false,
			message: isAutomatic
				? "Deployment verification failed and automatic rollback could not run because the last successful deployment is missing release artifact metadata."
				: "Rollback could not run because the selected deployment is missing release artifact metadata.",
		};
	}

	const rollbackCandidate = deployConfigFromReleaseArtifact(releaseArtifact, deployConfig);
	if (!rollbackCandidate) {
		send(
			isAutomatic
				? "ERROR: Verification failed and the rollback artifact could not be converted into a deployment config."
				: "ERROR: The rollback artifact could not be converted into a deployment config.",
			"rollback"
		);
		setStepState(deploySteps, "rollback", "error");
		return {
			success: false,
			message: isAutomatic
				? "Deployment verification failed and automatic rollback could not reconstruct the previous deployment config."
				: "Rollback could not reconstruct the selected deployment config.",
		};
	}

	const previousCommitSha =
		releaseArtifact.commitSha?.trim() ||
		rollbackHistoryEntry.commitSha?.trim() ||
		rollbackCandidate.commitSha?.trim() ||
		"previous release";
	const previousLabel = previousCommitSha === "previous release"
		? previousCommitSha
		: previousCommitSha.slice(0, 7);
	const rollbackStatus = transitionDeploymentStatus(deployConfig.status, "rollback_requested");
	deployConfig.status = rollbackStatus;
	setStepState(deploySteps, "rollback", "in_progress");
	await updatePersistedDeploymentStatus(deployConfig, userID, rollbackStatus, {
		...(serviceDetails?.cloudResources ? { cloudResources: serviceDetails.cloudResources } : {}),
	});
	send(`Starting ${rollbackNoun} to ${previousLabel}...`, "rollback");

	try {
		const region = rollbackCandidate.region || config.AWS_REGION;
		const repoName = rollbackCandidate.repoUrl.split("/").pop()?.replace(".git", "") || rollbackCandidate.repoName || "app";
		const rollbackMultiServiceConfig = buildMultiServiceConfigFromDeployConfig(rollbackCandidate);
		let rollbackResult;

		if (isStaticSiteReleaseArtifact(releaseArtifact)) {
			if (!token) {
				setStepState(deploySteps, "rollback", "error");
				send("ERROR: Static-site rollback requires a GitHub token for CodeBuild clone.", "rollback");
				return {
					success: false,
					message: isAutomatic
						? "Deployment verification failed and automatic static-site rollback could not run because a GitHub token was unavailable."
						: "Rollback could not run because a GitHub token was unavailable for static-site rebuild.",
				};
			}
			const rbConfig = deployConfigFromReleaseArtifact(releaseArtifact, cloneDeployConfigSnapshot(rollbackCandidate));
			if (!rbConfig) {
				setStepState(deploySteps, "rollback", "error");
				return {
					success: false,
					message: isAutomatic
						? "Deployment verification failed and automatic rollback could not read the static-site release config."
						: "Rollback could not read the static-site release config.",
				};
			}
			const parsedRb = parseGithubOwnerRepo(rbConfig.repoUrl);
			const repoFullNameRb = parsedRb ? `${parsedRb.owner}/${parsedRb.repo}` : repoName;
			const branchRb = rbConfig.branch?.trim() || rollbackCandidate.branch?.trim() || "";
			if (!branchRb.trim()) {
				setStepState(deploySteps, "rollback", "error");
				return {
					success: false,
					message: isAutomatic
						? "Deployment verification failed and automatic static-site rollback could not determine a git branch."
						: "Rollback could not determine a git branch for static-site rebuild.",
				};
			}
			const commitRb = releaseArtifact.commitSha?.trim() || rbConfig.commitSha?.trim();
			const envB64 = rbConfig.envVars ? Buffer.from(rbConfig.envVars, "utf8").toString("base64") : undefined;
			const buildRes = await runStaticSiteCodeBuildPipeline({
				region: releaseArtifact.region || region,
				deployConfig: rbConfig,
				repoFullName: repoFullNameRb,
				branch: branchRb,
				commitSha: commitRb,
				token,
				envVarsBase64: envB64,
				send,
			});
			rollbackResult = {
				success: buildRes.success,
				baseUrl: releaseArtifact.publicBaseUrl,
				serviceUrls: new Map(),
				instanceId: `s3:${releaseArtifact.bucket}/${releaseArtifact.keyPrefix}`,
				publicIp: "",
				vpcId: "",
				subnetId: "",
				securityGroupId: "",
				amiId: "s3-static",
			};
		} else if (isEcrImageReleaseArtifact(releaseArtifact)) {
			const rb = rollbackCandidate.scanResults;
			const scanForRb =
				rb && typeof rb === "object" && isSdArtifactsAnalyzeScan(rb)
					? (rb as SDArtifactsResponse)
					: undefined;
			const unitRb =
				scanForRb?.deploy_units?.length
					? pickDeployUnitForBuild(scanForRb, rollbackCandidate.serviceName)
					: null;
			if (!ecsRailpackFromEcrConfigured()) {
				setStepState(deploySteps, "rollback", "error");
				return {
					success: false,
					message: isAutomatic
						? "Deployment verification failed and automatic ECS rollback could not run because ECS is not configured."
						: "ECS rollback requires ECS_CLUSTER_NAME, ECS_SUBNET_IDS, ECS_SECURITY_GROUP_IDS, and ECS_EXECUTION_ROLE_ARN.",
				};
			}
			if (!unitRb) {
				setStepState(deploySteps, "rollback", "error");
				return {
					success: false,
					message: "Rollback could not resolve a deploy unit from scan results.",
				};
			}
			rollbackResult = await deployRailpackServerToEcs({
				deployConfig: cloneDeployConfigSnapshot(rollbackCandidate),
				region,
				repoName,
				imageUri: ecrImageRefFromArtifact(releaseArtifact),
				containerPort: unitRb.port || 3000,
				unitName: unitRb.name || "app",
				ws: null,
				send,
			});
		} else if (isLegacyEc2ConfigReleaseArtifact(releaseArtifact)) {
			setStepState(deploySteps, "rollback", "error");
			return {
				success: false,
				message: isAutomatic
					? "Deployment verification failed and automatic rollback could not restore a legacy EC2 deployment. Redeploy from a recent ECS or static-site release."
					: "Legacy EC2 config rollback is no longer supported. Redeploy from a recent ECS or static-site release.",
			};
		} else {
			setStepState(deploySteps, "rollback", "error");
			return {
				success: false,
				message: isAutomatic
					? "Deployment verification failed and automatic rollback could not identify the release artifact type."
					: "Rollback could not identify the release artifact type.",
			};
		}

		if (!rollbackResult.success) {
			setStepState(deploySteps, "rollback", "error");
			send(`ERROR: ${isAutomatic ? "Automatic rollback" : "Rollback"} could not restore ${previousLabel}.`, "rollback");
			return {
				success: false,
				message: isAutomatic
					? `Deployment verification failed, and automatic rollback to ${previousLabel} could not restore a healthy instance.`
					: `Rollback to ${previousLabel} could not restore a healthy instance.`,
			};
		}

		const failedInstanceId = "";
		if (
			isAwsEc2InstanceId(failedInstanceId) &&
			isAwsEc2InstanceId(rollbackResult.instanceId) &&
			failedInstanceId !== rollbackResult.instanceId
		) {
			const certificateArn = config.EC2_ACM_CERTIFICATE_ARN?.trim() || "";
			const services = resolveServices(repoName, rollbackCandidate, rollbackMultiServiceConfig);
			await configureAlb({
				deployConfig: rollbackCandidate,
				instanceId: rollbackResult.instanceId,
				existingInstanceId: failedInstanceId,
				services,
				repoName,
				net: {
					vpcId: rollbackResult.vpcId,
					subnetIds: [rollbackResult.subnetId].filter(Boolean),
					securityGroupId: rollbackResult.securityGroupId,
				},
				region,
				certificateArn,
				ws: null,
				send,
			});

			const ec2 = new EC2Client(getAwsClientConfig(region));
			try {
				await ec2.send(new TerminateInstancesCommand({ InstanceIds: [failedInstanceId!] }));
				send(`Terminated failed rollback candidate instance ${failedInstanceId}.`, "rollback");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				send(`Rollback restored traffic, but failed to terminate candidate instance ${failedInstanceId}: ${message}`, "rollback");
			}
		} else if (isAwsEc2InstanceId(failedInstanceId) && rollbackResult.instanceId.startsWith("ecs:")) {
			const ec2 = new EC2Client(getAwsClientConfig(region));
			try {
				await ec2.send(new TerminateInstancesCommand({ InstanceIds: [failedInstanceId!] }));
				send(`Terminated failed instance ${failedInstanceId} after ECS rollback.`, "rollback");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				send(`ECS rollback succeeded, but terminating instance ${failedInstanceId} failed: ${message}`, "rollback");
			}
		}

		setStepState(deploySteps, "rollback", "success");
		const rollbackTarget: DeploymentTarget = isStaticSiteReleaseArtifact(releaseArtifact)
			? "static_s3"
			: "ecs";
		const restoredConfig = cloneDeployConfigSnapshot(rollbackCandidate);
		restoredConfig.status = transitionDeploymentStatus(rollbackStatus, "rollback_succeeded");
		restoredConfig.hostedSubdomain = rollbackCandidate.hostedSubdomain;
		restoredConfig.screenshotUrl = rollbackCandidate.screenshotUrl;
		restoredConfig.deploymentTarget = rollbackTarget;
		restoredConfig.cloudResources = cloudResourcesFromDeployResult(
			rollbackTarget,
			region,
			rollbackResult,
			isStaticSiteReleaseArtifact(releaseArtifact)
				? {
					bucket: releaseArtifact.bucket,
					keyPrefix: releaseArtifact.keyPrefix,
					cloudFrontDistributionId: releaseArtifact.cloudFrontDistributionId,
				}
				: {
					cluster: config.ECS_CLUSTER_NAME?.trim(),
					service: rollbackResult.instanceId?.startsWith("ecs:")
						? rollbackResult.instanceId.slice(4).split("/").pop()
						: undefined,
				}
		);

		send(`SUCCESS: ${isAutomatic ? "Automatic rollback" : "Rollback"} restored ${previousLabel}.`, "rollback");
		return {
			success: true,
			message: isAutomatic
				? `Deployment verification failed. Rolled back automatically to ${previousLabel}.`
				: `Successfully rolled back to ${previousLabel}.`,
			restoredConfig,
			targetLabel: previousLabel,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		send(`ERROR: ${isAutomatic ? "Automatic rollback" : "Rollback"} failed: ${message}`, "rollback");
		setStepState(deploySteps, "rollback", "error");
		return {
			success: false,
			message: isAutomatic
				? `Deployment verification failed, and automatic rollback also failed: ${message}`
				: `Rollback failed: ${message}`,
		};
	}
}

/**
 * Main deployment handler — CodeBuild + ECR, then runtime placement (EC2 or ECS).
 */
export async function handleDeploy(
	deployConfig: DeployConfig,
	token: string,
	ws: any,
	userID?: string,
	options?: DeployLoggerOptions
): Promise<string> {
	const deployStartTime = Date.now();
	const shouldLoadRollbackHistory = canManageRuntimeDeploymentStatus(deployConfig.status);
	const isRailpackAnalyze = isSdArtifactsAnalyzeScan(deployConfig.scanResults);
	if (!isRailpackAnalyze) {
		throw new Error("Deployment requires a completed sd-artifacts analyze scan.");
	}
	if (isRailpackAnalyze && !(deployConfig.scanResults as SDArtifactsResponse).deploy_units?.length) {
		throw new Error("Analyze response has no deploy_units.");
	}

	// Initialize deployment steps for tracking all logs
	const deploySteps: DeployStep[] = [];
	let activeDeployRun: ActiveDeployRun | null = null;
	const send = createDeployStepsLogger(ws, deploySteps, {
		...options,
		onStepsChange: (steps) => {
			if (activeDeployRun) {
				createDeployRunStepFlushHandler(activeDeployRun, () => deploySteps)(steps);
			}
			options?.onStepsChange?.(steps);
		},
	});
	if (ws) {
		(ws as any).__deploySend = send;
	}

	try {
		let rollbackHistoryEntry: DeploymentHistoryEntry | null = null;
		if (userID && shouldLoadRollbackHistory) {
			const rollbackHistory = await dbHelper.getLastSuccessfulDeploymentHistory(
				deployConfig.repoName,
				deployConfig.serviceName,
				userID
			);
			if (rollbackHistory.error) {
				send(`Warning: could not load rollback history: ${String(rollbackHistory.error)}`, "rollback");
			} else {
				rollbackHistoryEntry = rollbackHistory.history ?? null;
			}
		}

		if (userID) {
			const normalizedStatus = normalizeDeploymentStatus(deployConfig.status);
			const startingStatus = isInProgressDeploymentStatus(normalizedStatus)
				? normalizedStatus
				: transitionDeploymentStatus(normalizedStatus, "deploy_requested");
			deployConfig.status = startingStatus;
			await dbHelper.updateDeployments(
				deployConfigForStatusPersist({
					...deployConfig,
					status: startingStatus,
				}),
				userID
			);

			activeDeployRun = await startDeploymentRun({
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
		}
		return await handleAWSCodeBuildDeploy(deployConfig, token, ws, userID, deployStartTime, send, deploySteps, rollbackHistoryEntry);
	} catch (error: any) {
		send(`ERROR: Deployment failed: ${error.message}`, 'error');
		const doneStep = deploySteps.find((step) => step.id === "done");
		if (doneStep) doneStep.status = "error";
		const durationMs = Date.now() - deployStartTime;
		await sendDeployComplete(ws, undefined, false, deployConfig, deploySteps, userID, deployConfig.deploymentTarget, null, null, durationMs, {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

export async function handleManualRollback(args: {
	repoName: string;
	serviceName: string;
	historyEntryId: string;
	token: string;
	ws: any;
	userID?: string;
	options?: DeployLoggerOptions;
}): Promise<string> {
	const deployStartTime = Date.now();
	const repoName = args.repoName.trim();
	const serviceName = args.serviceName.trim();
	const historyEntryId = args.historyEntryId.trim();
	const token = args.token;
	const ws = args.ws;
	const userID = args.userID;
	const deploySteps: DeployStep[] = [];
	let activeDeployRun: ActiveDeployRun | null = null;
	const send = createDeployStepsLogger(ws, deploySteps, {
		...args.options,
		onStepsChange: (steps) => {
			if (activeDeployRun) {
				createDeployRunStepFlushHandler(activeDeployRun, () => deploySteps)(steps);
			}
			args.options?.onStepsChange?.(steps);
		},
	});
	if (ws) {
		(ws as any).__deploySend = send;
	}

	try {
		if (!userID) {
			throw new Error("User not found");
		}
		if (!repoName || !serviceName || !historyEntryId) {
			throw new Error("repoName, serviceName, and historyEntryId are required");
		}

		sendDeploySteps(ws, MANUAL_ROLLBACK_STEPS);

		const deploymentResponse = await dbHelper.getDeployment(repoName, serviceName);
		const deployConfig = deploymentResponse.deployment;
		if (deploymentResponse.error || !deployConfig) {
			throw new Error("Deployment not found");
		}
		if (deployConfig.ownerID !== userID) {
			throw new Error("Forbidden: deployment does not belong to user");
		}

		activeDeployRun = await startDeploymentRun({
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

		const targetHistoryResponse = await dbHelper.getDeploymentHistoryEntryById(historyEntryId, userID);
		if (targetHistoryResponse.error) {
			throw new Error(String(targetHistoryResponse.error));
		}
		const targetHistoryEntry = targetHistoryResponse.history;
		if (!targetHistoryEntry) {
			throw new Error("Selected deployment history entry was not found");
		}
		if (targetHistoryEntry.repo_name !== repoName || targetHistoryEntry.service_name !== serviceName) {
			throw new Error("Selected deployment history entry does not belong to this service");
		}
		if (!targetHistoryEntry.success) {
			throw new Error("Rollback is only available for successful deployment history entries");
		}

		const latestSuccessfulResponse = await dbHelper.getLastSuccessfulDeploymentHistory(repoName, serviceName, userID);
		if (latestSuccessfulResponse.error) {
			send(`Warning: could not load current successful deployment history: ${String(latestSuccessfulResponse.error)}`, "rollback");
		}
		const fallbackHistoryEntry =
			latestSuccessfulResponse.history && latestSuccessfulResponse.history.id !== targetHistoryEntry.id
				? latestSuccessfulResponse.history
				: null;

		const serviceDetails: ServiceDeployDetails | null = deployConfig.cloudResources
			? { cloudResources: deployConfig.cloudResources }
			: null;
		const rollbackAttempt = await restoreDeploymentFromHistory({
			deployConfig,
			rollbackHistoryEntry: targetHistoryEntry,
			serviceDetails,
			userID,
			token,
			send,
			deploySteps,
			mode: "manual",
		});

		if (!rollbackAttempt.success || !rollbackAttempt.restoredConfig) {
			const durationMs = Date.now() - deployStartTime;
			const failedRollbackConfig: DeployConfig = {
				...deployConfig,
				commitSha: targetHistoryEntry.commitSha ?? deployConfig.commitSha,
				branch: targetHistoryEntry.branch ?? deployConfig.branch,
			};
			await sendDeployComplete(
				ws,
				undefined,
				false,
				failedRollbackConfig,
				deploySteps,
				userID,
				deployConfig.deploymentTarget,
				null,
				serviceDetails,
				durationMs,
				{
					errorMessage: rollbackAttempt.message,
					releaseArtifact: targetHistoryEntry.releaseArtifact ?? null,
				}
			);
			return "error";
		}

		const verificationConfig: DeployConfig = {
			...rollbackAttempt.restoredConfig,
			status: deployConfig.status,
		};
		const verification = await verifyDeploymentReadiness({
			deployConfig: verificationConfig,
			deployUrl:
				rollbackAttempt.restoredConfig.cloudResources?.target === "ecs"
					? rollbackAttempt.restoredConfig.cloudResources.baseUrl
					: rollbackAttempt.restoredConfig.cloudResources?.target === "static_s3"
						? rollbackAttempt.restoredConfig.cloudResources.publicBaseUrl
						: getDeploymentHostedUrl(rollbackAttempt.restoredConfig) || "",
			customUrl: getDeploymentHostedUrl(rollbackAttempt.restoredConfig),
			userID,
			token,
			send,
			deploySteps,
			rollbackHistoryEntry: fallbackHistoryEntry,
			serviceDetails,
		});

		if (!verification.success || !rollbackAttempt.restoredConfig) {
			const durationMs = Date.now() - deployStartTime;
			const failedVerificationConfig: DeployConfig = {
				...verificationConfig,
				status: verification.success ? verificationConfig.status : (verification.postPersistConfig?.status ?? verificationConfig.status),
			};
			await sendDeployComplete(
				ws,
				verification.success
					? (getDeploymentHostedUrl(rollbackAttempt.restoredConfig) ?? undefined)
					: (verification.postPersistConfig
						? getDeploymentHostedUrl(verification.postPersistConfig) ?? undefined
						: getDeploymentHostedUrl(rollbackAttempt.restoredConfig) ?? undefined),
				false,
				failedVerificationConfig,
				deploySteps,
				userID,
				deployConfig.deploymentTarget,
				null,
				verification.success
					? serviceDetails
					: (verification.postPersistConfig?.cloudResources
						? { cloudResources: verification.postPersistConfig.cloudResources }
						: serviceDetails),
				durationMs,
				{
					errorMessage: verification.success ? "Rollback verification failed." : verification.errorMessage,
					postPersistConfig: verification.success ? null : verification.postPersistConfig,
					finalStatus: verification.success ? "failed" : (verification.postPersistConfig?.status ?? "failed"),
					rolledBack: verification.success ? false : normalizeDeploymentStatus(verification.postPersistConfig?.status) === "running",
					releaseArtifact: targetHistoryEntry.releaseArtifact ?? null,
				}
			);
			return "error";
		}

		const completionConfig: DeployConfig = verificationConfig;
		const restoredDetails: ServiceDeployDetails | null = rollbackAttempt.restoredConfig.cloudResources
			? { cloudResources: rollbackAttempt.restoredConfig.cloudResources }
			: null;
		const durationMs = Date.now() - deployStartTime;
		await sendDeployComplete(
			ws,
			getDeploymentHostedUrl(rollbackAttempt.restoredConfig) ||
				(rollbackAttempt.restoredConfig.cloudResources?.target === "ecs"
					? rollbackAttempt.restoredConfig.cloudResources.baseUrl
					: rollbackAttempt.restoredConfig.cloudResources?.target === "static_s3"
						? rollbackAttempt.restoredConfig.cloudResources.publicBaseUrl
						: undefined),
			true,
			completionConfig,
			deploySteps,
			userID,
			deployConfig.deploymentTarget,
			null,
			restoredDetails,
			durationMs,
			{
				finalStatus: rollbackAttempt.restoredConfig.status,
				rolledBack: true,
				releaseArtifact: targetHistoryEntry.releaseArtifact ?? null,
			}
		);
		return "done";
	} catch (error) {
		send(`ERROR: Rollback failed: ${error instanceof Error ? error.message : String(error)}`, "rollback");
		const durationMs = Date.now() - deployStartTime;
		const doneStep = deploySteps.find((step) => step.id === "done");
		if (doneStep) doneStep.status = "error";
		if (repoName && serviceName) {
			const fallbackConfig = {
				id: `rollback-${repoName}-${serviceName}`,
				repoName,
				serviceName,
				repoUrl: "",
				branch: "",
				commitSha: null,
				envVars: null,
				hostedSubdomain: null,
				screenshotUrl: null,
				status: "failed",
				firstDeployment: null,
				lastDeployment: null,
				revision: null,
				cloudProvider: "aws",
				deploymentTarget: "ecs",
				region: config.AWS_REGION,
				cloudResources: null,
				scanResults: {},
			} as DeployConfig;
			await sendDeployComplete(ws, undefined, false, fallbackConfig, deploySteps, userID, "ecs", null, null, durationMs, {
				errorMessage: error instanceof Error ? error.message : String(error),
			});
		}
		throw error;
	}
}

export const __testing = {
	buildVerificationCandidates,
	buildVerificationTargets,
	shouldForceVerificationFailure,
	verifyDeploymentReadiness,
	attemptAutomaticRollback,
	restoreDeploymentFromHistory,
	sendDeployComplete,
};

/** Step definitions per AWS target so the client shows accurate labels */
const AWS_DEPLOY_STEPS: Record<string, { id: string; label: string }[]> = {
	"ec2": [
		{ id: "clone", label: "📦 Cloning repository" },
		{ id: "auth", label: "🔐 Authentication" },
		{ id: "database", label: "🗄️ Database (RDS)" },
		{ id: "setup", label: "⚙️ Setup (VPC, key, security)" },
		{ id: "deploy", label: "🚀 Deploy to EC2" },
		{ id: "done", label: "✅ Done" },
	],
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
	"cloud_run": [
		{ id: "clone", label: "📦 Cloning repository" },
		{ id: "detect", label: "🔍 Analyzing app" },
		{ id: "auth", label: "🔐 Authentication" },
		{ id: "database", label: "🗄️ Database (Cloud SQL)" },
		{ id: "docker", label: "🐳 Build image (Cloud Build)" },
		{ id: "deploy", label: "🚀 Deploy to Cloud Run" },
		{ id: "done", label: "✅ Done" },
	],
};

const MANUAL_ROLLBACK_STEPS = [
	{ id: "rollback", label: "Restore release" },
	{ id: "setup", label: "Setup" },
	{ id: "deploy", label: "Deploy" },
	{ id: "verify", label: "Verify" },
	{ id: "done", label: "Done" },
];

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
	if (ws?.readyState === ws?.OPEN) {
		ws.send(JSON.stringify({ type: "deploy_steps", payload: { steps: getTransportDeploySteps(steps, preset) } }));
	}
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
	customUrl?: string | null,
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
		const hostedFromDns = customUrl ? subdomainFromHostedUrl(customUrl) : null;
		const minimalDeployment: DeployConfig = deployConfigForStatusPersist({
			...deployConfig,
			status: success
				? transitionDeploymentStatus(deployConfig.status, "deployment_succeeded")
				: transitionDeploymentStatus(deployConfig.status, "deployment_failed"),
			...(hostedFromDns ? { hostedSubdomain: hostedFromDns } : {}),
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
				const screenshotTargetUrl = (customUrl ?? getDeploymentHostedUrl(minimalDeployment) ?? deployUrl) || "";
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
	if (ws?.readyState === ws?.OPEN) {
		ws.send(
			JSON.stringify({
				type: "deploy_logs",
				payload: {
					id: doneStep?.id ?? "done",
					msg: message,
					time: new Date().toISOString(),
				},
			})
		);
	}
}

/** Per-service details to persist after deploy */
type ServiceDeployDetails = {
	cloudResources?: CloudResources | null;
};

async function sendDeployComplete(
	ws: any,
	deployUrl: string | undefined = "",
	success: boolean,
	deployConfig: DeployConfig,
	deploySteps: DeployStep[],
	userID: string | undefined,
	deploymentTarget?: string,
	customDns?: AddRoute53DnsResult | null,
	serviceDetails?: ServiceDeployDetails | null,
	durationMs?: number,
	lifecycle?: DeploymentLifecycleOptions
) {
	const doneStep = deploySteps.find((step) => step.id === "done");
	if (doneStep && doneStep.status === "in_progress") {
		doneStep.status = success ? "success" : "error";
	}

	// Persist before notifying the client so refetches and retries see instanceId (e.g. failed EC2 deploy).
	console.log("Saving deployment result to database...");
	const failure =
		!success
			? (lifecycle?.failure ??
				classifyDeploymentFailure({
					deployConfig,
					steps: deploySteps,
					errorMessage: lifecycle?.errorMessage,
					rolledBack: lifecycle?.rolledBack,
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
			customDns?.success ? customDns.customUrl : null,
			durationMs,
			lifecycle?.releaseArtifact ?? null,
			failure,
			activeDeployRun
		);
		if (lifecycle?.postPersistConfig && userID) {
			const restoreResult = await dbHelper.updateDeployments(lifecycle.postPersistConfig, userID);
			if (restoreResult.error) {
				throw new Error(
					typeof restoreResult.error === "string"
						? restoreResult.error
						: "Failed to restore deployment state after rollback."
				);
			}
			const restoredDeployment = await dbHelper.getDeployment(
				lifecycle.postPersistConfig.repoName,
				lifecycle.postPersistConfig.serviceName
			);
			if (
				!restoredDeployment.deployment ||
				normalizeDeploymentStatus(restoredDeployment.deployment.status) !==
					normalizeDeploymentStatus(lifecycle.postPersistConfig.status)
			) {
				const retryRestore = await dbHelper.updateDeployments(
					{
						...(restoredDeployment.deployment ?? lifecycle.postPersistConfig),
						...lifecycle.postPersistConfig,
					},
					userID
				);
				if (retryRestore.error) {
					throw new Error(
						typeof retryRestore.error === "string"
							? retryRestore.error
							: "Failed to verify restored deployment state after rollback."
					);
				}
			}
		}
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
				has_custom_domain: Boolean(customDns?.success && customDns.customUrl),
			},
		});
	}

	const payload: {
		deployUrl: string | null;
		success: boolean;
		deploymentTarget: string | null;
		finalStatus?: DeployConfig["status"] | null;
		rolledBack?: boolean;
		customDnsAdded?: boolean;
		customDnsError?: string | null;
		customUrl?: string | null;
		error?: string | null;
		cloudResources?: CloudResources | null;
	} = {
		deployUrl: deployUrl ?? null,
		success,
		deploymentTarget: deploymentTarget ?? null,
	};
	if (serviceDetails?.cloudResources) payload.cloudResources = serviceDetails.cloudResources;
	if (customDns) {
		payload.customDnsAdded = customDns.success;
		if (customDns.success) {
			payload.customUrl = customDns.customUrl ?? null;
		} else {
			payload.customDnsError = customDns.error ?? null;
		}
	}
	if (!success && lifecycle?.errorMessage) {
		payload.error = lifecycle.errorMessage;
	}
	if (lifecycle?.finalStatus) {
		payload.finalStatus = lifecycle.finalStatus;
	}
	if (lifecycle?.rolledBack) {
		payload.rolledBack = true;
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
	} else if (ws?.readyState === ws?.OPEN) {
		ws.send(JSON.stringify({ type: "deploy_complete", payload }));
	}
}

/**
 * Handles AWS deployment using CodeBuild + ECR pipeline.
 * No local clone required: CodeBuild pulls source directly from GitHub.
 */
async function handleAWSCodeBuildDeploy(
	deployConfig: DeployConfig,
	token: string,
	ws: any,
	userID: string | undefined,
	deployStartTime: number,
	send: (msg: string, stepId: string) => void,
	deploySteps: DeployStep[],
	rollbackHistoryEntry: DeploymentHistoryEntry | null,
): Promise<string> {
	const region = deployConfig.region || config.AWS_REGION;
	const repoUrl = deployConfig.repoUrl;
	const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "app";
	const parsed = parseGithubOwnerRepo(repoUrl);
	const repoFullName = parsed ? `${parsed.owner}/${parsed.repo}` : repoName;
	const scanResults = deployConfig.scanResults;
	const scanResultsTyped = isSdArtifactsAnalyzeScan(scanResults) ? scanResults : null;
	const scanResultsForCodebuild: SDArtifactsResponse | undefined = isSdArtifactsAnalyzeScan(scanResults)
		? scanResults
		: undefined;
	const railpackUnit =
		scanResultsForCodebuild?.deploy_units?.length
			? pickDeployUnitForBuild(scanResultsForCodebuild, deployConfig.serviceName)
			: null;
	const railpackPlan = railpackUnit?.artifacts?.railpack_plan;
	const useRailpackBuild = !!(railpackUnit && hasUsableRailpackPlan(railpackPlan));
	const shouldStaticS3Build = shouldDeployStaticSiteToS3(scanResultsForCodebuild, deployConfig.serviceName);
	const useStaticS3 = Boolean(shouldStaticS3Build && staticSiteDeployConfigured());
	const isExistingDocker = scanResultsForCodebuild
		? isExistingDockerUnit(scanResultsForCodebuild, deployConfig.serviceName)
		: false;
	const canBuildContainerImage = useRailpackBuild || isExistingDocker;
	let target: DeploymentTarget = useStaticS3 ? "static_s3" : "ecs";
	deployConfig.deploymentTarget = target;

	const deployStepsKey = useStaticS3 ? "static-s3-codebuild" : "ecs-codebuild";
	sendDeploySteps(ws, AWS_DEPLOY_STEPS[deployStepsKey], deployStepsKey);

	// ── Auth: verify AWS credentials via SDK ──
	send("Authenticating with AWS...", "auth");
	if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
		process.env.AWS_ACCESS_KEY_ID = config.AWS_ACCESS_KEY_ID;
		process.env.AWS_SECRET_ACCESS_KEY = config.AWS_SECRET_ACCESS_KEY;
	}
	process.env.AWS_DEFAULT_REGION = region;

	const stsClient = new STSClient(getAwsClientConfig(region));
	const identity = await stsClient.send(new GetCallerIdentityCommand({}));
	void identity;

	if (shouldStaticS3Build && !staticSiteDeployConfigured()) {
		throw new Error(
			"Static site deploy requires STATIC_SITE_BUCKET and STATIC_SITE_PUBLIC_BASE_URL on the Smart Deploy server."
		);
	}
	if (!useStaticS3 && !ecsRailpackFromEcrConfigured()) {
		throw new Error(
			"Container deploy requires ECS configuration. Set ECS_CLUSTER_NAME, ECS_SUBNET_IDS (comma-separated), ECS_SECURITY_GROUP_IDS (comma-separated), and ECS_EXECUTION_ROLE_ARN."
		);
	}

	// Resolve branch
	let branch = deployConfig.branch?.trim() ?? "";
	if (!branch && parsed) {
		try {
			const { default_branch } = await fetchRepoMetadata(parsed.owner, parsed.repo, token);
			branch = default_branch;
			deployConfig.branch = default_branch;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			send(`Could not resolve default branch: ${msg}`, "auth");
			throw new Error("Missing deployment branch and could not resolve repository default");
		}
	}
	if (!branch) {
		send("Set a deployment branch in workspace settings before deploying.", "auth");
		throw new Error("Missing deployment branch");
	}
	const commitSha = deployConfig.commitSha?.trim();
	const imageTag = commitSha ? commitSha.substring(0, 6) : `deploy-${Date.now().toString(36)}`;

	// ── Build: CodeBuild (static → S3, or Docker → ECR) then ECS / EC2 ──
	const accountId = await getAwsAccountId(region);
	const envBase64 = deployConfig.envVars
		? Buffer.from(deployConfig.envVars, "utf8").toString("base64")
		: undefined;

	const dockerHubUser = config.DOCKERHUB_USERNAME?.trim();
	const dockerHubToken = config.DOCKERHUB_TOKEN?.trim();
	const dockerHub =
		dockerHubUser && dockerHubToken ? { username: dockerHubUser, token: dockerHubToken } : undefined;
	if (!dockerHub && dockerHubUser && !dockerHubToken) {
		send("⚠️ DOCKERHUB_USERNAME is set but DOCKERHUB_TOKEN is missing. Docker Hub login will be skipped.", "build");
	}

	let deployResult: EC2Result;
	let releaseArtifact: DeploymentReleaseArtifact;

	if (useStaticS3) {
		if (shouldStaticS3Build && !staticSiteDeployConfigured()) {
			throw new Error(
				"static_build (no start command) requires STATIC_SITE_BUCKET and STATIC_SITE_PUBLIC_BASE_URL on the Smart Deploy server."
			);
		}
		target = "static_s3";
		deployConfig.deploymentTarget = "static_s3";
		send("Publishing static site via CodeBuild → S3...", "build");
		const staticBuild = await runStaticSiteCodeBuildPipeline({
			region,
			deployConfig,
			repoFullName,
			branch,
			commitSha,
			token,
			envVarsBase64: envBase64,
			dockerHub,
			send,
		});
		if (!staticBuild.success) {
			send("❌ Static site build or S3 sync failed. Check CodeBuild logs above.", "build");
			throw new Error("CodeBuild failed: static site pipeline did not succeed");
		}
		const bucket = config.STATIC_SITE_BUCKET!.trim();
		const prefix = buildStaticSiteS3Prefix(repoName, deployConfig.serviceName).replace(/^\/+/, "");
		const publicBase = config.STATIC_SITE_PUBLIC_BASE_URL!.trim().replace(/\/+$/, "");
		const unitForUrl = pickDeployUnitForBuild(scanResultsForCodebuild!, deployConfig.serviceName);
		const serviceUrls = new Map<string, string>();
		if (unitForUrl?.name) serviceUrls.set(unitForUrl.name, publicBase);
		else serviceUrls.set("site", publicBase);
		deployResult = {
			success: true,
			baseUrl: publicBase,
			serviceUrls,
			instanceId: `s3:${bucket}/${prefix}`,
			publicIp: "",
			vpcId: "",
			subnetId: "",
			securityGroupId: "",
			amiId: "s3-static",
			sharedAlbDns: config.STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID?.trim() || "",
		};
		releaseArtifact = buildStaticSiteReleaseArtifact({
			deployConfig,
			region,
			bucket,
			keyPrefix: prefix,
			publicBaseUrl: publicBase,
			cloudFrontDistributionId: config.STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID?.trim() || null,
		});
	} else {
		const ecrRegistry = getEcrRegistry(accountId, region);
		const ecrRepoName = buildScopedEcrRepoName(repoName, scanResultsTyped?.package_path);
		const prebuiltImage =
			useRailpackBuild && scanResultsForCodebuild
				? resolveSdArtifactsPrebuiltImage({
					scan: scanResultsForCodebuild,
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
			releaseEcrRegistry = parseRegistryFromImageUri(prebuiltImage.imageUri || "") || ecrRegistry;
			releaseEcrRepoName = prebuiltImage.ecrRepoName;
			releaseImageTag = prebuiltImage.imageTag;
			resolvedImageUri = prebuiltImage.imageUri
				? imageRefFromUriAndDigest(prebuiltImage.imageUri, prebuiltImage.imageDigest)
				: getEcrImageUri(accountId, region, prebuiltImage.ecrRepoName, prebuiltImage.imageTag);
			resolvedImageDigest = prebuiltImage.imageDigest;
			send(
				`Using prebuilt image from analyze/stream for ${prebuiltImage.unit.name}; skipping CodeBuild rebuild (${resolvedImageUri}).`,
				"build"
			);
		} else {
			send("Preparing ECR repositories...", "build");
			await ensureEcrRepository(ecrRepoName, region, send);
			await ensureEc2EcrPullPolicy("smartdeploy-ec2-ssm-role", region);

		const hasCommit = Boolean(commitSha);
		let imageTagExists = hasCommit;
		if (hasCommit) {
			imageTagExists = await ecrImageTagExists(region, ecrRepoName, imageTag);
		}

		if (!hasCommit || !imageTagExists) {
			const roleArn = await ensureCodeBuildRole(region, send);
			const projectName = await ensureCodeBuildProject(region, roleArn, send);

			const imageUriForBuild = getEcrImageUri(accountId, region, ecrRepoName, imageTag);
			if (isExistingDocker) {
				send("CodeBuild will build from the repository Dockerfile.", "build");
			} else if (useRailpackBuild) {
				send("CodeBuild will use Railpack (docker buildx + pinned railpack-frontend).", "build");
			} else if (!canBuildContainerImage) {
				throw new Error("No Railpack plan or existing Dockerfile found for container build.");
			}

			const buildspec = generateBuildspec({
				ecrRegistry,
				ecrRepoName,
				imageTag,
				region,
				scanResults: scanResultsForCodebuild,
				deployUnit: railpackUnit,
				railpack:
					useRailpackBuild && railpackUnit && hasUsableRailpackPlan(railpackPlan)
						? {
							plan: railpackPlan,
							contextRelative: railpackUnit.root || ".",
							railpackVersion: scanResultsForCodebuild?.railpack_version ?? null,
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
				envVarsBase64: envBase64,
				dockerHub,
				send,
			});

			const buildResult = await waitForBuildAndStreamLogsPhased({ buildId, region, send });
			if (!buildResult.success) {
				send("❌ Docker image build failed. Check build logs above.", "build");
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

		target = "ecs";
		deployConfig.deploymentTarget = "ecs";
		send("Deploying to ECS Fargate...", "deploy");
		deployResult = await deployRailpackServerToEcs({
			deployConfig,
			region,
			repoName,
			imageUri: resolvedImageUri,
			containerPort: railpackUnit?.port || 3000,
			unitName: railpackUnit?.name || "app",
			ws,
			send,
		});

		const ecsInstanceRef = deployResult.instanceId?.startsWith("ecs:")
			? deployResult.instanceId.slice(4)
			: "";
		const rolloutParts = ecsInstanceRef.split("/");
		const rolloutCluster = rolloutParts[0]?.trim() || config.ECS_CLUSTER_NAME?.trim() || "";
		const rolloutServiceName = rolloutParts[1]?.trim() || "";
		const rolloutTaskDefinitionArn = deployResult.taskDefinitionArn?.trim() || "";
		if (rolloutCluster && rolloutServiceName && rolloutTaskDefinitionArn) {
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
			send(
				"OK: ECS rollout watcher skipped because task metadata was unavailable; continuing to verification.",
				"rollout"
			);
		}

		releaseArtifact = buildEcrImageReleaseArtifact({
			deployConfig,
			region,
			ecrRegistry: releaseEcrRegistry,
			ecrRepoName: releaseEcrRepoName,
			imageTag: releaseImageTag,
			imageUri: resolvedImageUri,
			imageDigest: resolvedImageDigest,
			serviceImages: [],
		});
	}

	const serviceDetails: ServiceDeployDetails = {};
	serviceDetails.cloudResources = cloudResourcesFromDeployResult(
		target,
		region,
		deployResult,
		target === "static_s3"
			? {
				bucket: config.STATIC_SITE_BUCKET?.trim(),
				keyPrefix: buildStaticSiteS3Prefix(repoName, deployConfig.serviceName).replace(/^\/+/, ""),
				cloudFrontDistributionId: config.STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID?.trim() || null,
			}
			: {
				cluster: config.ECS_CLUSTER_NAME?.trim(),
				service: deployResult.instanceId?.startsWith("ecs:")
					? deployResult.instanceId.slice(4).split("/").pop()
					: deployConfig.serviceName,
			}
	);
	const mergedRelease = attachDeployConfigToReleaseArtifact(releaseArtifact, {
		...deployConfig,
		...(serviceDetails.cloudResources ? { cloudResources: serviceDetails.cloudResources } : {}),
	} as DeployConfig);
	if (mergedRelease) {
		releaseArtifact = mergedRelease as DeploymentReleaseArtifact;
	}

	let deployUrl: string | undefined;
	let result: string;

	if (!deployResult.success || deployResult.baseUrl === "") {
		send("❌ Deployment failed: Server is not responding. Check your application and try again.", "deploy");
		result = "error";
	} else {
		let deploySummary = `\nDeployment completed!\n`;
		deploySummary += `Instance ID: ${deployResult.instanceId}\n`;
		deploySummary += `Public IP: ${deployResult.publicIp}\n`;
		deploySummary += `\nService URLs:\n`;
		for (const [name, url] of deployResult.serviceUrls.entries()) {
			deploySummary += `  - ${name}: ${url}\n`;
		}
		deployUrl = deployResult.baseUrl || deployResult.sharedAlbDns;
		result = "done";
	}

	let dnsResult: AddRoute53DnsResult | null = null;
	const sharedAlbDns = deployResult.sharedAlbDns?.trim() || "";
	const baseVerifyUrl = deployUrl;
	if (deployResult.success && deployConfig.serviceName?.trim() && (sharedAlbDns || deployUrl)) {
		send("Configuring Route 53 DNS...", "done");
		const previousHostedUrl = getDeploymentHostedUrl(deployConfig);
		dnsResult = await addRoute53DnsRecord(deployUrl || `https://${sharedAlbDns}`, deployConfig.serviceName, {
			deploymentTarget: target,
			previousCustomUrl: previousHostedUrl,
			sharedAlbDns: sharedAlbDns || null,
			awsRegion: region,
		});
	}

	if (dnsResult?.success) {
		send(`✅ Route 53 DNS ready: ${dnsResult.customUrl}`, "done");
		const customHost = getDeployUrlHostname(dnsResult.customUrl);
		if (
			customHost &&
			deployResult.albListenerArn &&
			deployResult.targetGroupArn
		) {
			send(`Configuring ALB host rule for ${customHost}...`, "done");
			await ensureHostRule(
				deployResult.albListenerArn,
				customHost,
				deployResult.targetGroupArn,
				region,
				ws
			);
		}
		if (dnsResult.customUrl) {
			deployUrl = dnsResult.customUrl;
		}
	} else if (dnsResult && deployResult.success) {
		send(`⚠️ Route 53 DNS failed: ${dnsResult?.error ?? "Unknown error"}`, "done");
	}

	let finalSuccess = deployResult.success;
	let lifecycle: DeploymentLifecycleOptions | undefined;
	const prematureDoneStep = deploySteps.find((step) => step.id === "done");
	if (prematureDoneStep) {
		prematureDoneStep.status = "pending";
	}
	if (deployResult.success && deployUrl) {
		const verification = await verifyDeploymentReadiness({
			deployConfig,
			deployUrl: baseVerifyUrl || deployUrl,
			customUrl: dnsResult?.success ? dnsResult.customUrl : null,
			userID,
			token,
			send,
			deploySteps,
			rollbackHistoryEntry,
			serviceDetails,
		});
		finalSuccess = verification.success;
		if (!verification.success) {
			lifecycle = {
				errorMessage: verification.errorMessage,
				postPersistConfig: verification.postPersistConfig,
				finalStatus: verification.postPersistConfig?.status ?? "failed",
				rolledBack: normalizeDeploymentStatus(verification.postPersistConfig?.status) === "running",
				releaseArtifact,
			};
			result = "error";
		}
	}
	if (finalSuccess) {
		let deploySummary = "Deployment completed.\n";
		deploySummary += `Verified URL: ${deployUrl}\n`;
		deploySummary += `Instance ID: ${deployResult.instanceId}\n`;
		deploySummary += `Public IP: ${deployResult.publicIp}\n`;
		deploySummary += "\nService URLs:\n";
		for (const [name, url] of deployResult.serviceUrls.entries()) {
			deploySummary += `  - ${name}: ${url}\n`;
		}
		send(`SUCCESS: ${deploySummary.trimEnd()}`, "done");
	}

	const doneStep = deploySteps.find(s => s.id === "done");
	if (doneStep) doneStep.status = finalSuccess ? "success" : "error";

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

	return finalSuccess ? result : "error";
}
