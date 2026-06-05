import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import config from "../config";
import {
	DeploymentTarget,
	DeployConfig,
	EC2Details,
	DeployStep,
	SDArtifactsResponse,
	DeploymentHistoryEntry,
	DeploymentReleaseArtifact,
	EcrServiceImageRef,
} from "../app/types";
import { MultiServiceConfig } from "./multiServiceDetector";
import { dbHelper } from "../db-helper";
import { configSnapshotFromDeployConfig } from "./utils";
import { createWebSocketLogger, createDeployStepsLogger } from "./websocketLogger";
import { captureDeploymentScreenshotAndUpload } from "./deploymentScreenshot";
import { isSdArtifactsAnalyzeScan } from "./scanResultNormalization";
import { hasUsableRailpackPlan, pickDeployUnitForBuild } from "./sdArtifactsBuildContext";

// AWS imports
import { configureAlb, handleEC2, handleEC2FromEcr, resolveServices } from "./aws/handleEC2";

// CodeBuild + ECR imports
import {
	getAwsAccountId,
	getEcrRegistry,
	getEcrImageUri,
	ensureEcrRepository,
	ensureEc2EcrPullPolicy,
	getEcrAuthToken,
	ecrImageTagExists,
	describeEcrImageByTag,
} from "./aws/ecrHelpers";
import { ensureCodeBuildRole, ensureCodeBuildProject, generateBuildspec, startBuild, waitForBuildAndStreamLogs } from "./aws/codebuildHelpers";
import { deployRailpackServerToEcs, ecsRailpackFromEcrConfigured } from "./aws/ecsRailpackDeploy";
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

import { addVercelDnsRecord, AddVercelDnsResult } from "./vercelDns";
import { githubAuthenticatedCloneUrl } from "./githubGitAuth";
import { fetchRepoMetadata, parseGithubOwnerRepo } from "./githubRepoArchive";
import { canManageRuntimeDeploymentStatus, normalizeDeploymentStatus, transitionDeploymentStatus } from "./deploymentStatus";
import * as deployLogsStore from "./deployLogsStore";
import {
	attachDeployConfigToReleaseArtifact,
	buildEc2ConfigReleaseArtifact,
	buildEcrImageReleaseArtifact,
	buildStaticSiteReleaseArtifact,
	deployConfigFromReleaseArtifact,
	ecrImageRefFromArtifact,
	hasUsableReleaseArtifact,
	isEc2ConfigReleaseArtifact,
	isEcrImageReleaseArtifact,
	isStaticSiteReleaseArtifact,
	serviceImageRefsFromArtifact,
} from "./deploymentReleaseArtifacts";
import { classifyDeploymentFailure, type DeploymentFailureRecord } from "./deploymentFailureClassification";

function hasDirectStaticConfig(deployConfig: DeployConfig): boolean {
	const scanResults = deployConfig.scanResults;
	if (!scanResults || typeof scanResults !== "object" || Array.isArray(scanResults)) return false;
	const record = scanResults as Record<string, unknown>;
	const outputDir = typeof record.output_dir === "string" ? record.output_dir.trim() : "";
	if (!outputDir) return false;
	if (deployConfig.kind === "direct-static") return true;
	return typeof record.serviceType === "string" || Array.isArray(record.install) || Array.isArray(record.build);
}

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

function cloneDeployConfigSnapshot(config: DeployConfig): DeployConfig {
	return {
		...config,
		ec2: config.ec2 ? { ...config.ec2 } : null,
		cloudRun: config.cloudRun ? { ...config.cloudRun } : null,
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

async function buildEcrServiceImageRefs(params: {
	region: string;
	ecrRegistry: string;
	ecrRepoName: string;
	imageTag: string;
	services: Array<{ name: string }>;
	send: (msg: string, stepId: string) => void;
}): Promise<EcrServiceImageRef[]> {
	const refs: EcrServiceImageRef[] = [];
	for (const service of params.services) {
		const serviceName = service.name?.trim();
		if (!serviceName) continue;
		const repoName = `${params.ecrRepoName}-${serviceName}`;
		const image = await describeImageRefWithFallback({
			region: params.region,
			ecrRegistry: params.ecrRegistry,
			ecrRepoName: repoName,
			imageTag: params.imageTag,
			serviceName,
			send: params.send,
		});
		refs.push({
			serviceName,
			ecrRepoName: repoName,
			imageUri: image.imageUri,
			imageDigest: image.imageDigest ?? null,
		});
	}
	return refs;
}

function buildMultiServiceConfigFromDeployConfig(deployConfig: DeployConfig): MultiServiceConfig {
	const scanResults = deployConfig.scanResults;
	const scanResultsTyped =
		scanResults && typeof scanResults === "object" && "services" in scanResults
			? (scanResults as SDArtifactsResponse)
			: null;

	return {
		isMultiService: (scanResultsTyped?.services?.length || 0) > 1,
		services: (scanResultsTyped?.services || []).map((service) => ({
			name: service.name,
			workdir: service.build_context || ".",
			dockerfile: service.dockerfile_path,
			port: service.port,
			build_context: service.build_context || ".",
		})),
		hasDockerCompose: Boolean(scanResultsTyped?.docker_compose),
		isMonorepo: (scanResultsTyped?.services?.length || 0) > 1,
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

async function updatePersistedDeploymentStatus(
	deployConfig: DeployConfig,
	userID: string | undefined,
	status: DeployConfig["status"],
	overrides: Partial<DeployConfig> = {}
) {
	if (!userID) return;
	await dbHelper.updateDeployments(
		{
			...deployConfig,
			...overrides,
			status,
		},
		userID
	);
}

function buildVerificationCandidates(baseUrl: string): string[] {
	const trimmed = baseUrl.trim();
	if (!trimmed) return [];
	const urls = new Set<string>();
	const paths = ["/", "/health", "/healthz", "/api/health"];
	const baseCandidates = trimmed.startsWith("http")
		? [trimmed]
		: trimmed.includes(".elb.amazonaws.com")
			? [`http://${trimmed}`, `https://${trimmed}`]
			: [`https://${trimmed}`, `http://${trimmed}`];
	for (const candidateBase of baseCandidates) {
		for (const pathName of paths) {
			try {
				const url = new URL(candidateBase);
				url.pathname = pathName;
				url.search = "";
				url.hash = "";
				urls.add(url.toString());
			} catch {
				// Ignore malformed candidates and keep trying the next path.
			}
		}
	}
	return Array.from(urls);
}

async function fetchWithTimeout(url: string, timeoutMs: number, externalSignal?: AbortSignal) {
	const controller = new AbortController();
	const handleExternalAbort = () => controller.abort();
	if (externalSignal) {
		if (externalSignal.aborted) {
			controller.abort();
		} else {
			externalSignal.addEventListener("abort", handleExternalAbort, { once: true });
		}
	}
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, {
			method: "GET",
			redirect: "follow",
			cache: "no-store",
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
		externalSignal?.removeEventListener("abort", handleExternalAbort);
	}
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

async function verifyDeploymentReadiness(params: {
	deployConfig: DeployConfig;
	deployUrl: string;
	userID?: string;
	token?: string;
	send: (msg: string, stepId: string) => void;
	deploySteps: DeployStep[];
	rollbackHistoryEntry?: DeploymentHistoryEntry | null;
	serviceDetails?: ServiceDeployDetails | null;
}): Promise<VerificationResult> {
	const { deployConfig, deployUrl, userID, token, send, deploySteps, rollbackHistoryEntry, serviceDetails } = params;
	const verifyingStatus = transitionDeploymentStatus(deployConfig.status, "verification_requested");
	deployConfig.status = verifyingStatus;
	setStepState(deploySteps, "verify", "in_progress");
	await updatePersistedDeploymentStatus(deployConfig, userID, verifyingStatus, {
		...(serviceDetails?.ec2 ? { ec2: serviceDetails.ec2 } : {}),
		...(deployUrl ? { liveUrl: deployUrl } : {}),
	});

	const candidates = buildVerificationCandidates(deployUrl);
	if (candidates.length === 0) {
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

	const maxRounds = 6;
	const requestTimeoutMs = 8_000;
	const roundDelayMs = 2_000;
	const verificationDeadlineMs = 90_000;
	const verificationDeadlineAt = Date.now() + verificationDeadlineMs;
	for (let round = 1; round <= maxRounds; round += 1) {
		const remainingBudgetMs = verificationDeadlineAt - Date.now();
		if (remainingBudgetMs <= 0) {
			send("Verification deadline reached before a healthy response was observed.", "verify");
			break;
		}

		send(`Verification round ${round}/${maxRounds}: probing ${candidates.length} URL(s).`, "verify");
		const roundController = new AbortController();
		let roundResolved = false;
		const perCandidateTimeoutMs = Math.max(1_000, Math.min(requestTimeoutMs, remainingBudgetMs));
		const probes = candidates.map(async (candidate) => {
			send(`Verification attempt ${round}/${maxRounds}: ${candidate}`, "verify");
			try {
				const response = await fetchWithTimeout(candidate, perCandidateTimeoutMs, roundController.signal);
				if (response.status < 500) {
					return {
						candidate,
						statusCode: response.status,
					};
				}
				send(`Verification received HTTP ${response.status} at ${candidate}`, "verify");
				throw new Error(`HTTP ${response.status}`);
			} catch (error) {
				if (roundResolved && roundController.signal.aborted) {
					throw error;
				}
				const message = error instanceof Error ? error.message : String(error);
				send(`Verification request failed at ${candidate}: ${message}`, "verify");
				throw error;
			}
		});

		try {
			const verified = await Promise.any(probes);
			roundResolved = true;
			roundController.abort();
			send(`SUCCESS: Verification passed with HTTP ${verified.statusCode} at ${verified.candidate}`, "verify");
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
	}

	setStepState(deploySteps, "verify", "error");
	send("ERROR: Deployment verification failed after all retry attempts.", "verify");
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
		...(serviceDetails?.ec2 ? { ec2: serviceDetails.ec2 } : {}),
	});
	send(`Starting ${rollbackNoun} to ${previousLabel}...`, "rollback");

	try {
		const region = rollbackCandidate.awsRegion || config.AWS_REGION;
		const repoName = rollbackCandidate.url.split("/").pop()?.replace(".git", "") || rollbackCandidate.repoName || "app";
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
			const parsedRb = parseGithubOwnerRepo(rbConfig.url);
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
			const ecrAuth = await getEcrAuthToken(releaseArtifact.region || region);
			const ecrPasswordB64 = Buffer.from(ecrAuth.password, "utf8").toString("base64");
			const rb = rollbackCandidate.scanResults;
			const scanForRb =
				rb && typeof rb === "object" && (("stack_summary" in rb) || isSdArtifactsAnalyzeScan(rb))
					? (rb as SDArtifactsResponse)
					: undefined;
			const unitRb =
				scanForRb?.deploy_units?.length
					? pickDeployUnitForBuild(scanForRb, rollbackCandidate.serviceName)
					: null;
			const planRb = unitRb?.artifacts?.railpack_plan;
			const useEcsRollback =
				Boolean(unitRb) &&
				hasUsableRailpackPlan(planRb) &&
				(unitRb!.type === "server" ||
					unitRb!.type === "existing_docker" ||
					unitRb!.type === "multi") &&
				isSdArtifactsAnalyzeScan(rb) &&
				ecsRailpackFromEcrConfigured();

			if (useEcsRollback && unitRb && hasUsableRailpackPlan(planRb)) {
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
			} else {
				rollbackResult = await handleEC2FromEcr({
					deployConfig: cloneDeployConfigSnapshot(rollbackCandidate),
					imageUri: ecrImageRefFromArtifact(releaseArtifact),
					imageTag: releaseArtifact.imageTag,
					ecrRegistry: releaseArtifact.ecrRegistry,
					ecrRepoName: releaseArtifact.ecrRepoName,
					ecrPasswordB64,
					serviceImageRefs: serviceImageRefsFromArtifact(releaseArtifact),
					multiServiceConfig: rollbackMultiServiceConfig,
					ws: null,
					send,
				});
			}
		} else if (isEc2ConfigReleaseArtifact(releaseArtifact)) {
			if (!token) {
				setStepState(deploySteps, "rollback", "error");
				send("ERROR: Config rollback requires a GitHub token but none is available.", "rollback");
				return {
					success: false,
					message: isAutomatic
						? "Deployment verification failed and automatic config rollback could not run because a GitHub token was unavailable."
						: "Rollback could not run because a GitHub token was unavailable for config-based redeploy.",
				};
			}
			rollbackResult = await handleEC2(
				cloneDeployConfigSnapshot(rollbackCandidate),
				".",
				rollbackMultiServiceConfig,
				token,
				undefined,
				null,
				send
			);
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

		const failedInstanceId = serviceDetails?.ec2?.instanceId?.trim();
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
		const restoredConfig = cloneDeployConfigSnapshot(rollbackCandidate);
		restoredConfig.status = transitionDeploymentStatus(rollbackStatus, "rollback_succeeded");
		restoredConfig.liveUrl = rollbackCandidate.liveUrl;
		restoredConfig.screenshotUrl = rollbackCandidate.screenshotUrl;
		restoredConfig.ec2 = {
			success: true,
			baseUrl: rollbackResult.baseUrl,
			instanceId: rollbackResult.instanceId,
			publicIp: rollbackResult.publicIp,
			vpcId: rollbackResult.vpcId,
			subnetId: rollbackResult.subnetId,
			securityGroupId: rollbackResult.securityGroupId,
			amiId: rollbackResult.amiId,
			sharedAlbDns: rollbackResult.sharedAlbDns || rollbackCandidate.ec2?.sharedAlbDns || "",
			instanceType: rollbackCandidate.ec2?.instanceType || serviceDetails?.ec2?.instanceType || "t3.micro",
		};

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
	const isDirectStatic = hasDirectStaticConfig(deployConfig);
	const isRailpackAnalyze = isSdArtifactsAnalyzeScan(deployConfig.scanResults);
	const isStaticAnalyzeSite = shouldDeployStaticSiteToS3(deployConfig.scanResults, deployConfig.serviceName);
	const scanResultsCasted = deployConfig.scanResults && typeof deployConfig.scanResults === "object" && "dockerfiles" in deployConfig.scanResults
		? (deployConfig.scanResults as Record<string, unknown>).dockerfiles as Record<string, string>
		: {};
	const dockerfileCount = Object.keys(scanResultsCasted || {}).length;
	if (!isDirectStatic && !isRailpackAnalyze && !isStaticAnalyzeSite && dockerfileCount < 1) {
		throw new Error("Deployment requires at least one Dockerfile in scan results.");
	}
	const nginxConf = deployConfig.scanResults && typeof deployConfig.scanResults === "object" && "nginx_conf" in deployConfig.scanResults
		? ((deployConfig.scanResults as Record<string, unknown>).nginx_conf as string)
		: "";
	if (!isDirectStatic && !isRailpackAnalyze && !isStaticAnalyzeSite && !nginxConf?.trim()) {
		throw new Error("Deployment requires nginx.conf in scan results.");
	}

	// Initialize deployment steps for tracking all logs
	const deploySteps: DeployStep[] = [];
	const send = createDeployStepsLogger(ws, deploySteps, options);
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
			const startingStatus = transitionDeploymentStatus(deployConfig.status, "deploy_requested");
			deployConfig.status = startingStatus;
			await dbHelper.updateDeployments(
				{
					...deployConfig,
					status: startingStatus,
				},
				userID
			);
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
	const send = createDeployStepsLogger(ws, deploySteps, args.options);
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

		const serviceDetails: ServiceDeployDetails | null = deployConfig.ec2
			? { ec2: deployConfig.ec2 }
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
			deployUrl: rollbackAttempt.restoredConfig.liveUrl || rollbackAttempt.restoredConfig.ec2?.baseUrl || "",
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
					? (rollbackAttempt.restoredConfig.liveUrl ?? undefined)
					: (verification.postPersistConfig?.liveUrl ?? rollbackAttempt.restoredConfig.liveUrl ?? undefined),
				false,
				failedVerificationConfig,
				deploySteps,
				userID,
				deployConfig.deploymentTarget,
				null,
				verification.success
					? serviceDetails
					: (verification.postPersistConfig?.ec2 ? { ec2: verification.postPersistConfig.ec2 } : serviceDetails),
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
		const restoredDetails: ServiceDeployDetails | null = rollbackAttempt.restoredConfig.ec2
			? { ec2: rollbackAttempt.restoredConfig.ec2 }
			: null;
		const durationMs = Date.now() - deployStartTime;
		await sendDeployComplete(
			ws,
			rollbackAttempt.restoredConfig.liveUrl || rollbackAttempt.restoredConfig.ec2?.baseUrl,
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
				url: "",
				branch: "",
				commitSha: null,
				envVars: null,
				liveUrl: null,
				screenshotUrl: null,
				status: "failed",
				firstDeployment: null,
				lastDeployment: null,
				revision: null,
				cloudProvider: "aws",
				deploymentTarget: "ec2",
				awsRegion: config.AWS_REGION,
				ec2: null,
				cloudRun: null,
				scanResults: {},
			} as DeployConfig;
			await sendDeployComplete(ws, undefined, false, fallbackConfig, deploySteps, userID, "ec2", null, null, durationMs, {
				errorMessage: error instanceof Error ? error.message : String(error),
			});
		}
		throw error;
	}
}

export const __testing = {
	buildVerificationCandidates,
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
	"ec2-codebuild": [
		{ id: "auth", label: "🔐 Authentication" },
		{ id: "build", label: "🐳 Build image (CodeBuild)" },
		{ id: "setup", label: "⚙️ Setup (VPC, key, security)" },
		{ id: "deploy", label: "🚀 Deploy to EC2" },
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

function sendDeploySteps(ws: any, steps: { id: string; label: string }[]) {
	if (ws?.readyState === ws?.OPEN) {
		ws.send(JSON.stringify({ type: "deploy_steps", payload: { steps } }));
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
	failure?: DeploymentFailureRecord | null
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
		// Prepare minimal deployment config for DB
		const minimalDeployment: DeployConfig = {
			...deployConfig,
			status: success
				? transitionDeploymentStatus(deployConfig.status, "deployment_succeeded")
				: transitionDeploymentStatus(deployConfig.status, "deployment_failed"),
			...(deployUrl && { liveUrl: deployUrl }),
			...(customUrl && { liveUrl: customUrl }),
			...(serviceDetails?.ec2 && { ec2: serviceDetails.ec2 }),
		};

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
				const screenshotTargetUrl = (customUrl ?? deployUrl) || "";
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

		// Record deployment history using repo_name + service_name
		const historyEntry = {
			timestamp: new Date().toISOString(),
			success,
			steps,
			configSnapshot: configSnapshotFromDeployConfig(minimalDeployment),
			releaseArtifact: attachDeployConfigToReleaseArtifact(releaseArtifact, minimalDeployment) ?? releaseArtifact ?? {},
			...(deployConfig.commitSha && { commitSha: deployConfig.commitSha }),
			...(deployConfig.branch && { branch: deployConfig.branch }),
			...(durationMs && { durationMs }),
			...(failure?.code ? { failureCode: failure.code } : {}),
			...(failure?.classification ? { failureClassification: failure.classification } : {}),
		};

		const historyResponse = await dbHelper.addDeploymentHistory(
			deployConfig.repoName,
			deployConfig.serviceName,
			userID,
			historyEntry
		);

		if (historyResponse.error) {
			console.error("Failed to record deployment history:", historyResponse.error);
			captureServerEvent({
				distinctId: userID,
				event: "deploy_persistence_failed",
				properties: {
					phase: "add_deployment_history",
					repo_name: deployConfig.repoName ?? null,
					service_name: deployConfig.serviceName ?? null,
					success,
					error: String(historyResponse.error),
				},
			});
		} else {
			console.log("Deployment history recorded:", historyResponse.id);
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
	ec2?: EC2Details;
};

async function sendDeployComplete(
	ws: any,
	deployUrl: string | undefined = "",
	success: boolean,
	deployConfig: DeployConfig,
	deploySteps: DeployStep[],
	userID: string | undefined,
	deploymentTarget?: string,
	vercelDns?: AddVercelDnsResult | null,
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
	try {
		await saveDeploymentToDB(
			deployConfig,
			deployUrl,
			success,
			deploySteps,
			userID,
			serviceDetails,
			vercelDns?.success ? vercelDns.customUrl : null,
			durationMs,
			lifecycle?.releaseArtifact ?? null,
			failure
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
				has_custom_domain: Boolean(vercelDns?.success && vercelDns.customUrl),
			},
		});
	}

	const payload: {
		deployUrl: string | null;
		success: boolean;
		deploymentTarget: string | null;
		finalStatus?: DeployConfig["status"] | null;
		rolledBack?: boolean;
		vercelDnsAdded?: boolean;
		vercelDnsError?: string | null;
		customUrl?: string | null;
		error?: string | null;
		ec2?: EC2Details;
	} = {
		deployUrl: lifecycle?.postPersistConfig?.liveUrl ?? deployUrl ?? null,
		success,
		deploymentTarget: deploymentTarget ?? null,
	};
	if (serviceDetails?.ec2) payload.ec2 = serviceDetails.ec2;
	if (vercelDns) {
		payload.vercelDnsAdded = vercelDns.success;
		if (vercelDns.success) {
			payload.customUrl = vercelDns.customUrl ?? null;
		} else {
			payload.vercelDnsError = vercelDns.error ?? null;
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
	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoUrl = deployConfig.url;
	const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "app";
	const parsed = parseGithubOwnerRepo(repoUrl);
	const repoFullName = parsed ? `${parsed.owner}/${parsed.repo}` : repoName;
	const scanResults = deployConfig.scanResults;
	const scanResultsTyped = (scanResults && typeof scanResults === "object" && "services" in scanResults)
		? (scanResults as SDArtifactsResponse)
		: null;
	const scanResultsForCodebuild: SDArtifactsResponse | undefined =
		scanResults && typeof scanResults === "object" &&
		(("stack_summary" in scanResults) || isSdArtifactsAnalyzeScan(scanResults))
			? (scanResults as SDArtifactsResponse)
			: undefined;
	const railpackUnit =
		scanResultsForCodebuild?.deploy_units?.length
			? pickDeployUnitForBuild(scanResultsForCodebuild, deployConfig.serviceName)
			: null;
	const railpackPlan = railpackUnit?.artifacts?.railpack_plan;
	const useRailpackBuild = !!(railpackUnit && hasUsableRailpackPlan(railpackPlan));
	const shouldStaticS3Build = shouldDeployStaticSiteToS3(scanResultsForCodebuild, deployConfig.serviceName);
	const useStaticS3 = Boolean(shouldStaticS3Build && staticSiteDeployConfigured());
	const directStaticConfig = hasDirectStaticConfig(deployConfig)
		? (scanResults as Record<string, unknown>)
		: null;
	const rootCommands = (() => {
		const raw = scanResults && typeof scanResults === "object" && "commands" in scanResults
			? (scanResults as Record<string, unknown>).commands
			: undefined;
		if (Array.isArray(raw)) return raw.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
		if (raw && typeof raw === "object") {
			const dot = (raw as Record<string, unknown>)["."];
			if (Array.isArray(dot)) {
				return dot.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
			}
		}
		return [] as string[];
	})();

	let target: DeploymentTarget = "ec2";
	deployConfig.deploymentTarget = target;

	const deployStepsKey =
		rootCommands.length > 0 || directStaticConfig ? "ec2" : useStaticS3 ? "static-s3-codebuild" : "ec2-codebuild";
	sendDeploySteps(ws, AWS_DEPLOY_STEPS[deployStepsKey]);

	// ── Auth: verify AWS credentials via SDK ──
	send("Authenticating with AWS...", "auth");
	if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
		process.env.AWS_ACCESS_KEY_ID = config.AWS_ACCESS_KEY_ID;
		process.env.AWS_SECRET_ACCESS_KEY = config.AWS_SECRET_ACCESS_KEY;
	}
	process.env.AWS_DEFAULT_REGION = region;

	const stsClient = new STSClient(getAwsClientConfig(region));
	const identity = await stsClient.send(new GetCallerIdentityCommand({}));
	// if (identity.Arn) send(`Authenticated as: ${identity.Arn}`, "auth");
	// send("✅ AWS credentials verified", "auth");

	if (directStaticConfig || rootCommands.length > 0) {
		if (directStaticConfig) {
			send("Using direct-static deployment path (skipping CodeBuild/ECR)...", "deploy");
		} else {
			send("Using scan_results.commands deployment path (skipping CodeBuild/ECR)...", "deploy");
		}
		const multiServiceConfig = buildMultiServiceConfigFromDeployConfig(deployConfig);

		const ec2Result = await handleEC2(
			deployConfig,
			".",
			multiServiceConfig,
			token,
			undefined,
			ws,
			send
		);

		const serviceDetails: ServiceDeployDetails = {};
		const ec2Details2 = deployConfig.ec2 || {};
		const ec2Typed2 = (ec2Details2 && typeof ec2Details2 === "object" && "instanceType" in ec2Details2)
			? (ec2Details2 as EC2Details)
			: null;
		serviceDetails.ec2 = {
			success: ec2Result.success,
			baseUrl: ec2Result.baseUrl,
			instanceId: ec2Result.instanceId,
			publicIp: ec2Result.publicIp,
			vpcId: ec2Result.vpcId,
			subnetId: ec2Result.subnetId,
			securityGroupId: ec2Result.securityGroupId,
			amiId: ec2Result.amiId,
			sharedAlbDns: ec2Result.sharedAlbDns || "",
			instanceType: ec2Typed2?.instanceType || "t3.micro",
		};
		const releaseArtifact = buildEc2ConfigReleaseArtifact({
			...deployConfig,
			...(serviceDetails.ec2 ? { ec2: serviceDetails.ec2 } : {}),
		});

		let deployUrl: string | undefined;
		let result: string;
		if (!ec2Result.success || ec2Result.baseUrl === "") {
			send("❌ Deployment failed: Server is not responding. Check deployment logs.", "deploy");
			result = "error";
		} else {
			let ec2Summary = `\nDeployment completed!\n`;
			ec2Summary += `Instance ID: ${ec2Result.instanceId}\n`;
			ec2Summary += `Public IP: ${ec2Result.publicIp}\n`;
			ec2Summary += `\nService URLs:\n`;
			for (const [name, url] of ec2Result.serviceUrls.entries()) {
				ec2Summary += `  - ${name}: ${url}\n`;
			}
			deployUrl = ec2Result.baseUrl || ec2Result.sharedAlbDns;
			result = "done";
		}

		let vercelResult: AddVercelDnsResult | null = null;
		if (deployUrl && deployConfig.liveUrl !== deployUrl && deployConfig.serviceName?.trim() && ec2Result.success) {
			send("Adding Vercel DNS record...", "verify");
			vercelResult = await addVercelDnsRecord(deployUrl, deployConfig.serviceName, {
				deploymentTarget: target,
				previousCustomUrl: deployConfig.liveUrl ?? null,
			});
		}
		if (vercelResult?.success) {
			send(`✅ Vercel DNS added: ${vercelResult.customUrl}`, "done");
		} else if (deployUrl && vercelResult && ec2Result.success) {
			send(`⚠️ Vercel DNS failed: ${vercelResult?.error ?? "Unknown error"}`, "done");
		}

		let finalSuccess = ec2Result.success;
		let lifecycle: DeploymentLifecycleOptions | undefined;
		const prematureDoneStep = deploySteps.find((step) => step.id === "done");
		if (prematureDoneStep) {
			prematureDoneStep.status = "pending";
		}
		if (ec2Result.success && deployUrl) {
			const verification = await verifyDeploymentReadiness({
				deployConfig,
				deployUrl,
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
			let ec2Summary = "Deployment completed.\n";
			ec2Summary += `Verified URL: ${deployUrl}\n`;
			ec2Summary += `Instance ID: ${ec2Result.instanceId}\n`;
			ec2Summary += `Public IP: ${ec2Result.publicIp}\n`;
			ec2Summary += "\nService URLs:\n";
			for (const [name, url] of ec2Result.serviceUrls.entries()) {
				ec2Summary += `  - ${name}: ${url}\n`;
			}
			send(`SUCCESS: ${ec2Summary.trimEnd()}`, "done");
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
			vercelResult,
			serviceDetails,
			durationMs,
			lifecycle ?? { releaseArtifact }
		);
		return finalSuccess ? result : "error";
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

	let ec2Result: Awaited<ReturnType<typeof handleEC2FromEcr>>;
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
		ec2Result = {
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
		const ecrRepoName = `smartdeploy/${repoName}`;
		const ecrAuth = await getEcrAuthToken(region);
		const ecrPasswordB64 = Buffer.from(ecrAuth.password, "utf8").toString("base64");

		const services = scanResultsTyped?.services || [];
		const hasCompose = scanResults && typeof scanResults === "object" && "docker_compose" in scanResults && services.length > 1;
		const repoNames = new Set<string>();
		repoNames.add(ecrRepoName);
		if (hasCompose) {
			for (const svc of services) {
				const name = (svc.name || "").trim();
				if (name) repoNames.add(`${ecrRepoName}-${name}`);
			}
		}
		send("Preparing ECR repositories...", "build");
		for (const repo of repoNames) {
			await ensureEcrRepository(repo, region, send);
		}
		await ensureEc2EcrPullPolicy("smartdeploy-ec2-ssm-role", region);

		const hasCommit = Boolean(commitSha);
		let allTagsExist = hasCommit;
		if (hasCommit) {
			for (const repo of repoNames) {
				const exists = await ecrImageTagExists(region, repo, imageTag);
				if (!exists) {
					allTagsExist = false;
					break;
				}
			}
		}

		if (!hasCommit || !allTagsExist) {
			const roleArn = await ensureCodeBuildRole(region, send);
			const projectName = await ensureCodeBuildProject(region, roleArn, send);

			const imageUriForBuild = getEcrImageUri(accountId, region, ecrRepoName, imageTag);
			if (useRailpackBuild) {
				send("CodeBuild will use Railpack (docker buildx + pinned railpack-frontend).", "build");
			}

			const buildspec = generateBuildspec({
				ecrRegistry,
				ecrRepoName,
				imageTag,
				region,
				scanResults: scanResultsForCodebuild,
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

			const buildResult = await waitForBuildAndStreamLogs({ buildId, region, send });
			if (!buildResult.success) {
				send("❌ Docker image build failed. Check build logs above.", "build");
				throw new Error("CodeBuild failed: Docker image build did not succeed");
			}
		} else {
			send(`CodeBuild skipped: image ${imageTag} already exists in ECR.`, "build");
		}

		const imageUri = getEcrImageUri(accountId, region, ecrRepoName, imageTag);
		const primaryImage = await describeImageRefWithFallback({
			region,
			ecrRegistry,
			ecrRepoName,
			imageTag,
			send,
		});
		const serviceImages = hasCompose
			? await buildEcrServiceImageRefs({
				region,
				ecrRegistry,
				ecrRepoName,
				imageTag,
				services,
				send,
			})
			: [];
		send(`Image ready: ${primaryImage.imageUri || imageUri}`, "build");

		const multiServiceConfig = buildMultiServiceConfigFromDeployConfig(deployConfig);
		const serverishRailpack =
			useRailpackBuild &&
			railpackUnit &&
			(railpackUnit.type === "server" ||
				railpackUnit.type === "existing_docker" ||
				railpackUnit.type === "multi");
		const railpackAnalyzeServer =
			Boolean(serverishRailpack) && isSdArtifactsAnalyzeScan(deployConfig.scanResults);

		if (railpackAnalyzeServer && ecsRailpackFromEcrConfigured()) {
			target = "ecs";
			deployConfig.deploymentTarget = "ecs";
			send("Deploying to ECS Fargate (Railpack)...", "deploy");
			ec2Result = await deployRailpackServerToEcs({
				deployConfig,
				region,
				repoName,
				imageUri: primaryImage.imageUri || imageUri,
				containerPort: railpackUnit!.port || 3000,
				unitName: railpackUnit!.name || "app",
				ws,
				send,
			});
		} else if (railpackAnalyzeServer && !ecsRailpackFromEcrConfigured()) {
			throw new Error(
				"Railpack server deployment requires ECS configuration. Set ECS_CLUSTER_NAME, ECS_SUBNET_IDS (comma-separated), ECS_SECURITY_GROUP_IDS (comma-separated), and ECS_EXECUTION_ROLE_ARN on the Smart Deploy server."
			);
		} else {
			target = "ec2";
			deployConfig.deploymentTarget = "ec2";
			send("Setting up networking...", "setup");
			ec2Result = await handleEC2FromEcr({
				deployConfig,
				imageUri: primaryImage.imageUri || imageUri,
				imageTag,
				ecrRegistry,
				ecrRepoName,
				ecrPasswordB64,
				serviceImageRefs: serviceImages.map((serviceImage) => ({
					serviceName: serviceImage.serviceName,
					imageUri: serviceImage.imageUri,
				})),
				multiServiceConfig,
				ws,
				send,
			});
		}

		releaseArtifact = buildEcrImageReleaseArtifact({
			deployConfig,
			region,
			ecrRegistry,
			ecrRepoName,
			imageTag,
			imageUri: primaryImage.imageUri || imageUri,
			imageDigest: primaryImage.imageDigest ?? null,
			serviceImages,
		});
	}

	const serviceDetails: ServiceDeployDetails = {};
	const ec2Details2 = deployConfig.ec2 || {};
	const ec2Typed2 = (ec2Details2 && typeof ec2Details2 === "object" && "instanceType" in ec2Details2) 
		? (ec2Details2 as EC2Details)
		: null;
	const instanceTypeSaved =
		ec2Result.instanceId.startsWith("ecs:")
			? "Fargate"
			: ec2Result.instanceId.startsWith("s3:")
				? "S3 / CDN"
				: (ec2Typed2?.instanceType || "t3.micro");
	serviceDetails.ec2 = {
		success: ec2Result.success,
		baseUrl: ec2Result.baseUrl,
		instanceId: ec2Result.instanceId,
		publicIp: ec2Result.publicIp,
		vpcId: ec2Result.vpcId,
		subnetId: ec2Result.subnetId,
		securityGroupId: ec2Result.securityGroupId,
		amiId: ec2Result.amiId,
		sharedAlbDns: ec2Result.sharedAlbDns || "",
		instanceType: instanceTypeSaved,
	};
	const mergedRelease = attachDeployConfigToReleaseArtifact(releaseArtifact, {
		...deployConfig,
		...(serviceDetails.ec2 ? { ec2: serviceDetails.ec2 } : {}),
	} as DeployConfig);
	if (mergedRelease) {
		releaseArtifact = mergedRelease as DeploymentReleaseArtifact;
	}

	let deployUrl: string | undefined;
	let result: string;

	if (!ec2Result.success || ec2Result.baseUrl === "") {
		send("❌ Deployment failed: Server is not responding. Check your application and try again.", "deploy");
		result = "error";
	} else {
		let ec2Summary = `\nDeployment completed!\n`;
		ec2Summary += `Instance ID: ${ec2Result.instanceId}\n`;
		ec2Summary += `Public IP: ${ec2Result.publicIp}\n`;
		ec2Summary += `\nService URLs:\n`;
		for (const [name, url] of ec2Result.serviceUrls.entries()) {
			ec2Summary += `  - ${name}: ${url}\n`;
		}
		deployUrl = ec2Result.baseUrl || ec2Result.sharedAlbDns;
		result = "done";
	}

	let vercelResult: AddVercelDnsResult | null = null;
		if (deployUrl && deployConfig.liveUrl !== deployUrl && deployConfig.serviceName?.trim() && ec2Result.success) {
			send("Adding Vercel DNS record...", "done");
			vercelResult = await addVercelDnsRecord(deployUrl, deployConfig.serviceName, {
				deploymentTarget: target,
				previousCustomUrl: deployConfig.liveUrl ?? null,
		});
	}

	if (vercelResult?.success) {
		send(`✅ Vercel DNS added: ${vercelResult.customUrl}`, "done");
	} else if (deployUrl && vercelResult && ec2Result.success) {
		send(`⚠️ Vercel DNS failed: ${vercelResult?.error ?? "Unknown error"}`, "done");
	}

	let finalSuccess = ec2Result.success;
	let lifecycle: DeploymentLifecycleOptions | undefined;
	const prematureDoneStep = deploySteps.find((step) => step.id === "done");
	if (prematureDoneStep) {
		prematureDoneStep.status = "pending";
	}
	if (ec2Result.success && deployUrl) {
		const verification = await verifyDeploymentReadiness({
			deployConfig,
			deployUrl,
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
		let ec2Summary = "Deployment completed.\n";
		ec2Summary += `Verified URL: ${deployUrl}\n`;
		ec2Summary += `Instance ID: ${ec2Result.instanceId}\n`;
		ec2Summary += `Public IP: ${ec2Result.publicIp}\n`;
		ec2Summary += "\nService URLs:\n";
		for (const [name, url] of ec2Result.serviceUrls.entries()) {
			ec2Summary += `  - ${name}: ${url}\n`;
		}
		send(`SUCCESS: ${ec2Summary.trimEnd()}`, "done");
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
		vercelResult,
		serviceDetails,
		durationMs,
		lifecycle ?? { releaseArtifact }
	);

	return finalSuccess ? result : "error";
}
