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

// AWS imports
import { setupAWSCredentials } from "./aws";
import { handleEC2 } from "./aws/handleEC2";
import { createRDSInstance } from "./aws/handleRDS";

// GCP imports (for Cloud SQL)
import { createCloudSQLInstance, generateCloudSQLConnectionString } from "./handleDatabaseDeploy";
import { addVercelDnsRecord, AddVercelDnsResult } from "./vercelDns";

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

	// Initialize deployment steps for tracking all logs
	const deploySteps: DeployStep[] = [];
	const send = createDeployStepsLogger(ws, deploySteps, options);
	const previousDeploySend = ws ? (ws as any).__deploySend : undefined;
	if (ws) {
		(ws as any).__deploySend = send;
	}

	// Determine cloud provider (default to AWS)
	const cloudProvider: CloudProvider = deployConfig.cloudProvider || 'aws';
	send(`Cloud Provider: ${cloudProvider.toUpperCase()}`, 'clone');

	const repoUrl = deployConfig.url;
	const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "default-app";

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-"));
	const cloneDir = path.join(tmpDir, repoName);

	try {
		// Clone repository first (common step)
		const authenticatedRepoUrl = repoUrl.replace("https://", `https://${token}@`);
		const branch = deployConfig.branch?.trim() || "main";
		const commitSha = deployConfig.commitSha?.trim();
		deployConfig.deploymentTarget = "ec2";

		if (commitSha) {
			send(`Cloning repo from branch "${branch}" and checking out commit ${commitSha.substring(0, 7)}...`, 'clone');
		} else {
			send(`Cloning repo from branch "${branch}"...`, 'clone');
		}

		await runCommandLiveWithWebSocket("git", ["clone", "-b", branch, authenticatedRepoUrl, cloneDir], ws, 'clone', { send });

		// Checkout specific commit if provided
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
		// Clean Next.js build cache if present (to avoid corrupted .next directory issues)
		const nextDir = path.join(appDir, ".next");
		if (fs.existsSync(nextDir)) {
			send("Cleaning existing Next.js build cache...", 'detect');
			try {
				fs.rmSync(nextDir, { recursive: true, force: true });
			} catch {
				// Ignore errors - if we can't delete it, the build will handle it
			}
		}

		// Construct multiServiceConfig from AI results if available
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
			isMonorepo: (scanResults?.services?.length || 0) > 1, // Simple heuristic for now
		};

		const dbConfig = null; // AI-driven DB provisioning not yet structured in SDArtifactsResponse


		// Route to appropriate cloud provider
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
		sendDeployComplete(
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

function sendDeployComplete(
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
	// Save to database before sending WebSocket message
	console.log("Saving deployment result to database...");
	console.log("Deployment details:", { deployConfig, deployUrl, success, deploymentTarget, vercelDns, serviceDetails, durationMs });

	saveDeploymentToDB(
		deployConfig,
		deployUrl,
		success,
		deploySteps,
		userID,
		serviceDetails,
		vercelDns?.success ? vercelDns.customUrl : null,
		durationMs
	).catch(err => console.error("Failed to save deployment to DB:", err));

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

	// Mark final step as success
	const doneStep = deploySteps.find(s => s.id === 'done');
	if (doneStep) doneStep.status = 'success';

	// Calculate deployment duration
	const durationMs = Date.now() - deployStartTime;


	// Notify client of success and URL (include service details so client can persist for redeploy/update/delete)
	sendDeployComplete(ws, deployUrl, success, deployConfig, deploySteps, userID, target, vercelResult, serviceDetails, durationMs);

	// Cleanup
	fs.rmSync(tmpDir, { recursive: true, force: true });
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
		sendDeployComplete(ws, gcpDeployUrl, success, deployConfig, deploySteps, userID, "cloud-run", vercelResult, null, durationMs);
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

	sendDeployComplete(ws, gcpDeployUrl, success, deployConfig, deploySteps, userID, "cloud-run", vercelResult, null, durationMs);

	// Cleanup temp folder
	fs.rmSync(tmpDir, { recursive: true, force: true });

	return "done";
}
