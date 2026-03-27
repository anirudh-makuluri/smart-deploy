import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import config from "../config";
import { runCommandLiveWithWebSocket } from "../server-helper";
import { DeploymentTarget, DeployConfig, CloudProvider, EC2DeployDetails, DeployStep } from "../app/types";
import { detectMultiService, MultiServiceConfig } from "./multiServiceDetector";
import { detectDatabase, DatabaseConfig } from "./databaseDetector";
import { handleMultiServiceDeploy } from "./handleMultiServiceDeploy";
import { dbHelper } from "../db-helper";
import { configSnapshotFromDeployConfig } from "./utils";
import { createWebSocketLogger, createDeployStepsLogger } from "./websocketLogger";
import { captureDeploymentScreenshotAndUpload } from "./deploymentScreenshot";

// AWS imports
import { setupAWSCredentials } from "./aws";
import { handleEC2 } from "./aws/handleEC2";
import { handleEC2FromEcr } from "./aws/handleEC2";
import { createRDSInstance } from "./aws/handleRDS";

// CodeBuild + ECR imports
import { getAwsAccountId, getEcrRegistry, getEcrImageUri, ensureEcrRepository, ensureEc2EcrPullPolicy, getEcrAuthToken } from "./aws/ecrHelpers";
import { ensureCodeBuildRole, ensureCodeBuildProject, generateBuildspec, startBuild, waitForBuildAndStreamLogs } from "./aws/codebuildHelpers";
import { SSM_PROFILE_NAME } from "./aws/ec2SsmHelpers";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { getAwsClientConfig } from "./aws/sdkClients";

// GCP imports (for Cloud SQL)
import { createCloudSQLInstance, generateCloudSQLConnectionString } from "./handleDatabaseDeploy";
import { addVercelDnsRecord, AddVercelDnsResult } from "./vercelDns";
import { githubAuthenticatedCloneUrl } from "./githubGitAuth";
import { fetchRepoMetadata, parseGithubOwnerRepo } from "./githubRepoArchive";

/**
 * Main deployment handler - routes to AWS (default) or GCP
 */
export async function handleDeploy(
	deployConfig: DeployConfig,
	token: string,
	ws: any,
	userID?: string,
	options?: {
		onStepsChange?: (steps: DeployStep[]) => void;
		broadcast?: (id: string, msg: string) => void;
	}
): Promise<string> {
	const deployStartTime = Date.now();
	const dockerfileCount = Object.keys(deployConfig.scan_results?.dockerfiles || {}).length;
	if (dockerfileCount < 1) {
		throw new Error("Deployment requires at least one Dockerfile in scan results.");
	}
	if (!deployConfig.scan_results?.nginx_conf?.trim()) {
		throw new Error("Deployment requires nginx.conf in scan results.");
	}

	// Initialize deployment steps for tracking all logs
	const deploySteps: DeployStep[] = [];
	const send = createDeployStepsLogger(ws, deploySteps, options);
	const previousDeploySend = ws ? (ws as any).__deploySend : undefined;
	if (ws) {
		(ws as any).__deploySend = send;
	}

	// Determine cloud provider (default to AWS)
	const cloudProvider: CloudProvider = deployConfig.cloudProvider || 'aws';

	const repoUrl = deployConfig.url;
	const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "default-app";

	// ── CodeBuild pipeline (no clone required) ──
	if (cloudProvider === 'aws' && config.USE_CODEBUILD) {
		try {
			return await handleAWSCodeBuildDeploy(deployConfig, token, ws, userID, deployStartTime, send, deploySteps);
		} catch (error: any) {
			send(`Deployment failed: ${error.message}`, 'error');
			const doneStep = deploySteps.find((step) => step.id === "done");
			if (doneStep) doneStep.status = "error";
			const durationMs = Date.now() - deployStartTime;
			await sendDeployComplete(ws, undefined, false, deployConfig, deploySteps, userID, deployConfig.deploymentTarget, null, null, durationMs);
			throw error;
		}
	}

	// ── Legacy path (clone + build on instance) ──
	send(`Cloud Provider: ${cloudProvider.toUpperCase()}`, 'clone');

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-"));
	const cloneDir = path.join(tmpDir, repoName);

	try {
		const authenticatedRepoUrl = githubAuthenticatedCloneUrl(repoUrl, token);
		let branch = deployConfig.branch?.trim() ?? "";
		if (!branch) {
			const parsed = parseGithubOwnerRepo(repoUrl);
			if (parsed) {
				try {
					const { default_branch } = await fetchRepoMetadata(parsed.owner, parsed.repo, token);
					branch = default_branch;
					deployConfig.branch = default_branch;
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					send(`Could not resolve default branch from GitHub: ${msg}`, "clone");
					throw new Error("Missing deployment branch and could not resolve repository default");
				}
			}
		}
		if (!branch) {
			send("Set a deployment branch in workspace settings before deploying.", "clone");
			throw new Error("Missing deployment branch");
		}
		const commitSha = deployConfig.commitSha?.trim();
		deployConfig.deploymentTarget = "ec2";

		if (commitSha) {
			send(`Cloning repo from branch "${branch}" and checking out commit ${commitSha.substring(0, 7)}...`, 'clone');
		} else {
			send(`Cloning repo from branch "${branch}"...`, 'clone');
		}

		await runCommandLiveWithWebSocket("git", ["clone", "-b", branch, authenticatedRepoUrl, cloneDir], ws, 'clone', { send });

		if (commitSha) {
			send(`Checking out commit ${commitSha.substring(0, 7)}...`, 'clone');
			await runCommandLiveWithWebSocket("git", ["checkout", commitSha], ws, 'clone', { cwd: cloneDir, send });
			send(`✅ Checked out commit ${commitSha.substring(0, 7)}`, 'clone');
		}

		const scanResults = deployConfig.scan_results;
		const appDir = scanResults?.services && scanResults.services.length > 0
			? path.join(cloneDir, scanResults.services[0].build_context || ".")
			: cloneDir;

		send("✅ Clone repository completed", 'clone');
		const nextDir = path.join(appDir, ".next");
		if (fs.existsSync(nextDir)) {
			send("Cleaning existing Next.js build cache...", 'detect');
			try {
				fs.rmSync(nextDir, { recursive: true, force: true });
			} catch { /* ignore */ }
		}

		const multiServiceConfig: MultiServiceConfig = {
			isMultiService: (scanResults?.services?.length || 0) > 1,
			services: (scanResults?.services || []).map(s => ({
				name: s.name,
				workdir: path.join(cloneDir, s.build_context || "."),
				dockerfile: s.dockerfile_path,
				port: s.port,
				build_context: path.join(cloneDir, s.build_context || ".")
			})),
			hasDockerCompose: !!scanResults?.docker_compose,
			isMonorepo: (scanResults?.services?.length || 0) > 1,
		};

		const dbConfig = null;

		if (cloudProvider === 'aws') {
			return await handleAWSDeploy(deployConfig, appDir, tmpDir, multiServiceConfig, dbConfig, token, ws, userID, deployStartTime, send, deploySteps);
		} else {
			return await handleGCPDeploy(deployConfig, appDir, cloneDir, tmpDir, multiServiceConfig, dbConfig, token, ws, userID, deployStartTime, send, deploySteps);
		}
	} catch (error: any) {
		send(`Deployment failed: ${error.message}`, 'error');
		const doneStep = deploySteps.find((step) => step.id === "done");
		if (doneStep) doneStep.status = "error";
		const durationMs = Date.now() - deployStartTime;
		await sendDeployComplete(
			ws,
			undefined,
			false,
			deployConfig,
			deploySteps,
			userID,
			deployConfig.deploymentTarget,
			null,
			null,
			durationMs
		);
		fs.rmSync(tmpDir, { recursive: true, force: true });
		throw error;
	} finally {
		if (ws) {
			if (previousDeploySend) {
				(ws as any).__deploySend = previousDeploySend;
			} else {
				delete (ws as any).__deploySend;
			}
		}
	}
}

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
	"cloud-run": [
		{ id: "clone", label: "📦 Cloning repository" },
		{ id: "detect", label: "🔍 Analyzing app" },
		{ id: "auth", label: "🔐 Authentication" },
		{ id: "database", label: "🗄️ Database (Cloud SQL)" },
		{ id: "docker", label: "🐳 Build image (Cloud Build)" },
		{ id: "deploy", label: "🚀 Deploy to Cloud Run" },
		{ id: "done", label: "✅ Done" },
	],
};

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
	durationMs?: number
): Promise<void> {
	if (!userID) {
		console.warn("No userID provided - skipping database save");
		return;
	}

	try {
		// Prepare minimal deployment config for DB
		const minimalDeployment: DeployConfig = {
			...deployConfig,
			status: success ? "running" : "failed",
			...(deployUrl && { deployUrl }),
			...(customUrl && { custom_url: customUrl }),
			...(serviceDetails?.ec2 && { ec2: serviceDetails.ec2 }),
		};

		// Update deployment document (creates if doesn't exist)
		const updateResponse = await dbHelper.updateDeployments(minimalDeployment, userID);
		if (updateResponse.error) {
			console.error("Failed to update deployment:", updateResponse.error);
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
									repoName: deployConfig.repo_name,
									serviceName: deployConfig.service_name,
								});

								await dbHelper.patchDeploymentData(deployConfig.repo_name, deployConfig.service_name, userID!, {
									screenshot_url: screenshotPublicUrl,
								});
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
			configSnapshot: configSnapshotFromDeployConfig(deployConfig),
			...(deployConfig.commitSha && { commitSha: deployConfig.commitSha }),
			...(deployConfig.branch && { branch: deployConfig.branch }),
			...(durationMs && { durationMs }),
		};

		const historyResponse = await dbHelper.addDeploymentHistory(
			deployConfig.repo_name,
			deployConfig.service_name,
			userID,
			historyEntry
		);

		if (historyResponse.error) {
			console.error("Failed to record deployment history:", historyResponse.error);
		} else {
			console.log("Deployment history recorded:", historyResponse.id);
		}
	} catch (error) {
		console.error("Error saving deployment to DB:", error);
	}
}

/** Per-service details to persist after deploy */
type ServiceDeployDetails = {
	ec2?: EC2DeployDetails;
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
	durationMs?: number
) {
	// Persist before notifying the client so refetches and retries see instanceId (e.g. failed EC2 deploy).
	console.log("Saving deployment result to database...");
	try {
		await saveDeploymentToDB(
			deployConfig,
			deployUrl,
			success,
			deploySteps,
			userID,
			serviceDetails,
			vercelDns?.success ? vercelDns.customUrl : null,
			durationMs
		);
	} catch (err) {
		console.error("Failed to save deployment to DB:", err);
	}

	if (ws?.readyState === ws?.OPEN) {
		const payload: {
			deployUrl: string | null;
			success: boolean;
			deploymentTarget: string | null;
			vercelDnsAdded?: boolean;
			vercelDnsError?: string | null;
			customUrl?: string | null;
			ec2?: EC2DeployDetails;
		} = {
			deployUrl: deployUrl ?? null,
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
		ws.send(JSON.stringify({ type: "deploy_complete", payload }));
	}
}

/**
 * Handles AWS deployment with automatic service selection
 */
async function handleAWSDeploy(
	deployConfig: DeployConfig,
	appDir: string,
	tmpDir: string,
	multiServiceConfig: MultiServiceConfig,
	dbConfig: DatabaseConfig | null,
	token: string,
	ws: any,
	userID: string | undefined,
	deployStartTime: number,
	send: (msg: string, stepId: string) => void,
	deploySteps: DeployStep[]
): Promise<string> {

	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";

	// Setup AWS credentials
	send("Authenticating with AWS...", 'auth');
	await setupAWSCredentials(ws);
	send("✅ AWS credentials authenticated", 'auth');

	// EC2-only AWS deploy path
	const target: DeploymentTarget = 'ec2';
	deployConfig.deploymentTarget = target;
	sendDeploySteps(ws, AWS_DEPLOY_STEPS.ec2);

	// Handle database provisioning if needed
	let dbConnectionString: string | undefined;
	if (dbConfig) {
		send("Provisioning AWS RDS database...", 'database');
		try {
			const { connectionString } = await createRDSInstance(
				dbConfig,
				repoName,
				region,
				ws
			);
			dbConnectionString = connectionString;
			send(`Database provisioned successfully`, 'database');
		} catch (error: any) {
			send(`Database provisioning failed: ${error.message}. Continuing without database.`, 'database');
		}
	} else {
		send("✅ No database provisioning required", 'database');
	}

	let result: string;
	let deployUrl: string | undefined;
	const serviceDetails: ServiceDeployDetails = {};
	let success = false;

	const ec2Result = await handleEC2(
		deployConfig,
		appDir,
		multiServiceConfig,
		token,
		dbConnectionString,
		ws,
		send
	);
	success = ec2Result.success;

	// Extract only the serializable fields for storage (exclude Maps like serviceUrls)
	serviceDetails.ec2 = {
		success: ec2Result.success,
		baseUrl: ec2Result.baseUrl,
		instanceId: ec2Result.instanceId,
		publicIp: ec2Result.publicIp,
		vpcId: ec2Result.vpcId,
		subnetId: ec2Result.subnetId,
		securityGroupId: ec2Result.securityGroupId,
		amiId: ec2Result.amiId,
	};

	if (ec2Result.baseUrl == "") {
		send(`❌ Deployment failed: Server is not responding on any known ports. Please check your application and try again.`, 'deploy');
		result = "error";
	} else {
		// Build summary
		let ec2Summary = `\nDeployment completed!\n`;
		ec2Summary += `Instance ID: ${ec2Result.instanceId}\n`;
		ec2Summary += `Public IP: ${ec2Result.publicIp}\n`;
		ec2Summary += `\nService URLs:\n`;
		for (const [name, url] of ec2Result.serviceUrls.entries()) {
			ec2Summary += `  - ${name}: ${url}\n`;
		}
		send(ec2Summary, 'done');
		deployUrl = ec2Result.sharedAlbDns || ec2Result.baseUrl;
		result = "done";
	}


	let vercelResult: AddVercelDnsResult | null = null;
	if (deployUrl && deployConfig.custom_url != deployUrl && deployConfig.service_name?.trim() && success) {
		send("Adding Vercel DNS record...", 'done');
		vercelResult = await addVercelDnsRecord(deployUrl, deployConfig.service_name, {
			deploymentTarget: target,
			previousCustomUrl: deployConfig.custom_url ?? null,
		});
	}

	if (vercelResult && vercelResult.success) {
		send(`✅ Vercel DNS added successfully: ${vercelResult.customUrl}`, 'done');
	} else if (deployUrl && vercelResult && success) {
		send(`⚠️ Warning: Vercel DNS addition failed: ${vercelResult?.error ?? "Unknown error"}. Proceeding with instance IP.`, 'done');
	}

	// Mark final step by outcome
	const doneStep = deploySteps.find(s => s.id === 'done');
	if (doneStep) doneStep.status = success ? 'success' : 'error';

	// Calculate deployment duration
	const durationMs = Date.now() - deployStartTime;


	// Notify client of success and URL (include service details so client can persist for redeploy/update/delete)
	await sendDeployComplete(ws, deployUrl, success, deployConfig, deploySteps, userID, target, vercelResult, serviceDetails, durationMs);

	// Cleanup
	fs.rmSync(tmpDir, { recursive: true, force: true });
	return result;
}

/**
 * Handles AWS deployment using CodeBuild + ECR pipeline.
 * No local clone required — CodeBuild pulls source directly from GitHub.
 */
async function handleAWSCodeBuildDeploy(
	deployConfig: DeployConfig,
	token: string,
	ws: any,
	userID: string | undefined,
	deployStartTime: number,
	send: (msg: string, stepId: string) => void,
	deploySteps: DeployStep[],
): Promise<string> {
	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoUrl = deployConfig.url;
	const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "app";
	const parsed = parseGithubOwnerRepo(repoUrl);
	const repoFullName = parsed ? `${parsed.owner}/${parsed.repo}` : repoName;

	const target: DeploymentTarget = "ec2";
	deployConfig.deploymentTarget = target;
	sendDeploySteps(ws, AWS_DEPLOY_STEPS["ec2-codebuild"]);

	// ── Auth: verify AWS credentials via SDK ──
	send("Authenticating with AWS...", "auth");
	if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
		process.env.AWS_ACCESS_KEY_ID = config.AWS_ACCESS_KEY_ID;
		process.env.AWS_SECRET_ACCESS_KEY = config.AWS_SECRET_ACCESS_KEY;
	}
	process.env.AWS_DEFAULT_REGION = region;

	const stsClient = new STSClient(getAwsClientConfig(region));
	const identity = await stsClient.send(new GetCallerIdentityCommand({}));
	if (identity.Arn) send(`Authenticated as: ${identity.Arn}`, "auth");
	send("✅ AWS credentials verified", "auth");

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

	// ── Build: CodeBuild + ECR ──
	const accountId = await getAwsAccountId(region);
	const ecrRegistry = getEcrRegistry(accountId, region);
	const ecrRepoName = `smartdeploy/${repoName}`;
	const ecrAuth = await getEcrAuthToken(region);
	const ecrPassword = ecrAuth.password;
	const ecrPasswordB64 = Buffer.from(ecrPassword, "utf8").toString("base64");

	send("Setting up ECR and CodeBuild...", "build");
	await ensureEcrRepository(ecrRepoName, region, send);
	// Grant EC2 instances ECR pull access
	await ensureEc2EcrPullPolicy("smartdeploy-ec2-ssm-role", region);

	const roleArn = await ensureCodeBuildRole(region, send);
	const projectName = await ensureCodeBuildProject(region, roleArn, send);

	const scanResults = deployConfig.scan_results;
	const envBase64 = deployConfig.env_vars
		? Buffer.from(deployConfig.env_vars, "utf8").toString("base64")
		: undefined;

	const buildspec = generateBuildspec({
		ecrRegistry,
		ecrRepoName,
		imageTag,
		scanResults,
	});

	const dockerHubUser = config.DOCKERHUB_USERNAME?.trim();
	const dockerHubToken = config.DOCKERHUB_TOKEN?.trim();
	const dockerHub =
		dockerHubUser && dockerHubToken ? { username: dockerHubUser, token: dockerHubToken } : undefined;
	if (!dockerHub && dockerHubUser && !dockerHubToken) {
		send("⚠️ DOCKERHUB_USERNAME is set but DOCKERHUB_TOKEN is missing — Docker Hub login will be skipped.", "build");
	}

	const buildId = await startBuild({
		region,
		projectName,
		repoFullName,
		branch,
		commitSha,
		githubToken: token,
		buildspec,
		envVarsBase64: envBase64,
		ecrPassword,
		dockerHub,
		send,
	});

	const buildResult = await waitForBuildAndStreamLogs({ buildId, region, send });
	if (!buildResult.success) {
		send("❌ Docker image build failed. Check build logs above.", "build");
		throw new Error("CodeBuild failed — Docker image build did not succeed");
	}

	const imageUri = getEcrImageUri(accountId, region, ecrRepoName, imageTag);
	send(`Image ready: ${imageUri}`, "build");

	// ── Setup + Deploy: EC2 from ECR ──
	send("Setting up networking...", "setup");
	const multiServiceConfig: MultiServiceConfig = {
		isMultiService: (scanResults?.services?.length || 0) > 1,
		services: (scanResults?.services || []).map(s => ({
			name: s.name,
			workdir: s.build_context || ".",
			dockerfile: s.dockerfile_path,
			port: s.port,
			build_context: s.build_context || ".",
		})),
		hasDockerCompose: !!scanResults?.docker_compose,
		isMonorepo: (scanResults?.services?.length || 0) > 1,
	};

	const ec2Result = await handleEC2FromEcr({
		deployConfig,
		imageUri,
		imageTag,
		ecrRegistry,
		ecrRepoName,
		ecrPasswordB64,
		multiServiceConfig,
		ws,
		send,
	});

	const serviceDetails: ServiceDeployDetails = {};
	serviceDetails.ec2 = {
		success: ec2Result.success,
		baseUrl: ec2Result.baseUrl,
		instanceId: ec2Result.instanceId,
		publicIp: ec2Result.publicIp,
		vpcId: ec2Result.vpcId,
		subnetId: ec2Result.subnetId,
		securityGroupId: ec2Result.securityGroupId,
		amiId: ec2Result.amiId,
	};

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
		send(ec2Summary, "done");
		deployUrl = ec2Result.sharedAlbDns || ec2Result.baseUrl;
		result = "done";
	}

	let vercelResult: AddVercelDnsResult | null = null;
	if (deployUrl && deployConfig.custom_url !== deployUrl && deployConfig.service_name?.trim() && ec2Result.success) {
		send("Adding Vercel DNS record...", "done");
		vercelResult = await addVercelDnsRecord(deployUrl, deployConfig.service_name, {
			deploymentTarget: target,
			previousCustomUrl: deployConfig.custom_url ?? null,
		});
	}

	if (vercelResult?.success) {
		send(`✅ Vercel DNS added: ${vercelResult.customUrl}`, "done");
	} else if (deployUrl && vercelResult && ec2Result.success) {
		send(`⚠️ Vercel DNS failed: ${vercelResult?.error ?? "Unknown error"}`, "done");
	}

	const doneStep = deploySteps.find(s => s.id === "done");
	if (doneStep) doneStep.status = ec2Result.success ? "success" : "error";

	const durationMs = Date.now() - deployStartTime;
	await sendDeployComplete(ws, deployUrl, ec2Result.success, deployConfig, deploySteps, userID, target, vercelResult, serviceDetails, durationMs);

	return result;
}

/**
 * Handles GCP deployment (existing Cloud Run logic)
 */
async function handleGCPDeploy(
	deployConfig: DeployConfig,
	appDir: string,
	cloneDir: string,
	tmpDir: string,
	multiServiceConfig: MultiServiceConfig,
	dbConfig: DatabaseConfig | null,
	token: string,
	ws: any,
	userID: string | undefined,
	deployStartTime: number,
	send: (msg: string, stepId: string) => void,
	deploySteps: DeployStep[]
): Promise<string> {

	const projectId = config.GCP_PROJECT_ID;
	const keyObject = JSON.parse(config.GCP_SERVICE_ACCOUNT_KEY);
	const keyPath = "/tmp/smartdeploy-key.json";
	fs.writeFileSync(keyPath, JSON.stringify(keyObject, null, 2));

	const gcpSteps = [
		{ id: "auth", label: "🔐 Authentication" },
		{ id: "clone", label: "📦 Cloning repository" },
		{ id: "detect", label: "🔍 Analyzing app" },
		{ id: "database", label: "🗄️ Database (Cloud SQL)" },
		{ id: "docker", label: "🐳 Build image (Cloud Build)" },
		{ id: "deploy", label: "🚀 Deploy to Cloud Run" },
		{ id: "done", label: "✅ Done" },
	];
	sendDeploySteps(ws, gcpSteps);

	send("Authenticating with Google Cloud...", 'auth');
	await runCommandLiveWithWebSocket("gcloud", ["auth", "activate-service-account", `--key-file=${keyPath}`], ws, 'auth', { send });
	await runCommandLiveWithWebSocket("gcloud", ["config", "set", "project", projectId, "--quiet"], ws, 'auth', { send });
	await runCommandLiveWithWebSocket("gcloud", ["auth", "configure-docker"], ws, 'auth', { send });

	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "default-app";
	const serviceName = `${repoName}`;

	// Handle multi-service deployment
	if (multiServiceConfig.isMultiService && multiServiceConfig.services.length > 1) {
		send(`Detected multi-service application with ${multiServiceConfig.services.length} services`, 'detect');
		send("Starting multi-service deployment...", 'detect');

		const { serviceUrls } = await handleMultiServiceDeploy(
			deployConfig,
			token,
			ws,
			cloneDir
		);

		let summary = `\nMulti-service deployment completed!\n\nDeployed services:\n`;
		for (const [name, url] of serviceUrls.entries()) {
			summary += `  - ${name}: ${url}\n`;
		}
		send(summary, 'done');
		const firstGcpUrl = serviceUrls.entries().next().value;
		const gcpDeployUrl = firstGcpUrl ? firstGcpUrl[1] : undefined;
		let vercelResult: AddVercelDnsResult | null = null;
		if (gcpDeployUrl && deployConfig.service_name?.trim()) {
			vercelResult = await addVercelDnsRecord(gcpDeployUrl, deployConfig.service_name, {
				deploymentTarget: "cloud-run",
				previousCustomUrl: deployConfig.custom_url ?? null,
			});
		}
		const doneStep = deploySteps.find(s => s.id === 'done');
		if (doneStep) doneStep.status = 'success';
		const durationMs = Date.now() - deployStartTime;
		const success = gcpDeployUrl ? true : false;
		await sendDeployComplete(ws, gcpDeployUrl, success, deployConfig, deploySteps, userID, "cloud-run", vercelResult, null, durationMs);
		fs.rmSync(tmpDir, { recursive: true, force: true });
		return "done";
	}

	// Handle database provisioning for GCP
	let dbConnectionString: string | undefined;
	if (dbConfig) {
		send("Provisioning Cloud SQL database...", 'database');
		try {
			const instanceName = `${repoName}-db-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
			const { connectionName, ipAddress } = await createCloudSQLInstance(
				dbConfig,
				projectId,
				instanceName,
				ws
			);
			dbConnectionString = generateCloudSQLConnectionString(dbConfig, connectionName, ipAddress, dbConfig.database);
			send(`Database provisioned successfully`, 'database');
		} catch (error: any) {
			send(`Database provisioning failed: ${error.message}. Continuing without database.`, 'database');
		}
	}

	// Single-service GCP deployment
	const dockerfilePath = path.join(appDir, "Dockerfile");

	if (!fs.existsSync(dockerfilePath)) {
		const scanResults = deployConfig.scan_results;
		const dockerfileContent = scanResults?.dockerfiles?.["Dockerfile"] || (scanResults?.services?.[0]?.dockerfile_path ? scanResults?.dockerfiles?.[scanResults.services[0].dockerfile_path] : null);

		if (dockerfileContent) {
			send(`Using AI-generated Dockerfile`, 'clone');
			fs.writeFileSync(dockerfilePath, dockerfileContent);
		} else {
			throw new Error("No Dockerfile found in deployment config and no AI-generated Dockerfile available.");
		}
	}

	const imageName = `${repoName}-image`;
	const gcpImage = `gcr.io/${projectId}/${imageName}:latest`;

	send("Building Docker image with Cloud Build...", 'docker');
	await runCommandLiveWithWebSocket("gcloud", [
		"builds", "submit",
		"--tag", gcpImage,
		appDir
	], ws, 'docker', { send });

	send("Deploying to Cloud Run...", 'deploy');

	// Build environment variables
	const envVarsList: string[] = [];
	if (deployConfig.env_vars) {
		envVarsList.push(deployConfig.env_vars.replace(/\r?\n/g, ","));
	}
	if (dbConnectionString) {
		envVarsList.push(`DATABASE_URL=${dbConnectionString}`);
		envVarsList.push(`ConnectionStrings__DefaultConnection=${dbConnectionString}`);
	}

	const envArgs = envVarsList.length > 0 ? ["--set-env-vars", envVarsList.join(",")] : [];

	await runCommandLiveWithWebSocket("gcloud", [
		"run", "deploy", serviceName,
		"--image", gcpImage,
		"--platform", "managed",
		"--region", "us-central1",
		"--allow-unauthenticated",
		...envArgs
	], ws, 'deploy', { send });

	await runCommandLiveWithWebSocket("gcloud", [
		"beta", "run", "services", "add-iam-policy-binding",
		serviceName,
		"--region=us-central1",
		"--platform=managed",
		"--member=allUsers",
		"--role=roles/run.invoker",
	], ws, 'deploy', { send });

	send(`Deployment success`, 'done');

	// Cloud Run URL format; we don't have the exact URL from gcloud output, so leave deployUrl for client to show "done"
	const gcpDeployUrl = `https://console.cloud.google.com/run?project=${projectId}`;
	let vercelResult: AddVercelDnsResult | null = null;
	if (gcpDeployUrl && deployConfig.service_name?.trim()) {
		vercelResult = await addVercelDnsRecord(gcpDeployUrl, deployConfig.service_name, {
			deploymentTarget: "cloud-run",
			previousCustomUrl: deployConfig.custom_url ?? null,
		});
	}
	const doneStep = deploySteps.find(s => s.id === 'done');
	if (doneStep) doneStep.status = 'success';
	const durationMs = Date.now() - deployStartTime;
	const success = gcpDeployUrl ? true : false;

	await sendDeployComplete(ws, gcpDeployUrl, success, deployConfig, deploySteps, userID, "cloud-run", vercelResult, null, durationMs);

	// Cleanup temp folder
	fs.rmSync(tmpDir, { recursive: true, force: true });

	return "done";
}
