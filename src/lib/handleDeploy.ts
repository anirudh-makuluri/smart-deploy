import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import config from "../config";
import { runCommandLiveWithWebSocket } from "../server-helper";
import { DeployConfig, EC2DeployDetails, DeployStep } from "../app/types";
import { detectMultiService, MultiServiceConfig } from "./multiServiceDetector";
import { detectDatabase, DatabaseConfig } from "./databaseDetector";
import { dbHelper } from "../db-helper";
import { configSnapshotFromDeployConfig } from "./utils";
import { createDeployStepsLogger } from "./websocketLogger";

// AWS-specific imports
import { setupAWSCredentials } from "./aws";
import { handleEC2 } from "./aws/handleEC2";
import { createRDSInstance } from "./aws/handleRDS";
import { addVercelDnsRecord, AddVercelDnsResult } from "./vercelDns";

export type HandleDeployOptions = {
	onStepsChange?: (steps: DeployStep[]) => void;
	broadcast?: (id: string, msg: string) => void;
};

/** Fetch commit message from GitHub API using commit SHA or branch. Returns first line of message. */
async function getCommitMessageFromGitHub(
	token: string,
	repoUrl: string,
	commitSha?: string,
	branch?: string
): Promise<string | undefined> {
	const match = repoUrl.replace(/\.git$/, "").match(/github\.com[/]([^/]+)[/]([^/]+)/);
	if (!match) return undefined;
	const [, owner, repo] = match;
	const ref = (commitSha || branch || "main").trim();
	if (!ref) return undefined;
	try {
		const res = await fetch(
			`https://api.github.com/repos/${owner}/${repo}/commits/${ref}`,
			{
				headers: {
					Authorization: `token ${token}`,
					Accept: "application/vnd.github+json",
				},
			}
		);
		if (!res.ok) return undefined;
		const data = await res.json();
		const fullMessage = data.commit?.message;
		if (typeof fullMessage !== "string") return undefined;
		// First line only (subject)
		return fullMessage.split("\n")[0].trim() || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Main deployment handler - clones the repo, analyzes services,
 * then runs the AWS EC2 deployment flow.
 */
export async function handleDeploy(
	deployConfig: DeployConfig,
	token: string,
	ws: any,
	userID?: string,
	options?: HandleDeployOptions
): Promise<string> {
	const deployStartTime = Date.now();

	// Initialize deployment steps for tracking all logs
	const deploySteps: DeployStep[] = [];
	const send = createDeployStepsLogger(ws, deploySteps, {
		onStepsChange: options?.onStepsChange,
		broadcast: options?.broadcast,
	});

	// We only support EC2 deployments now. If an older config has a different
	// target saved, keep the config but always run the EC2 flow.
	const originalTarget = deployConfig.deploymentTarget;
	if (originalTarget && originalTarget !== "ec2") {
		send(
			`Deployment target ${originalTarget} is no longer supported. Falling back to EC2.`,
			"clone"
		);
	}
	deployConfig.deploymentTarget = "ec2";

	// Let the client know which high-level steps to expect.
	sendDeploySteps(ws, EC2_DEPLOY_STEPS);
	const commitSha = deployConfig.commitSha?.trim();
	if (commitSha) {
		send(`Deploying commit ${commitSha.substring(0, 7)} to EC2`, "clone");
	} else {
		send("Deploying to EC2", "clone");
	}

	const repoUrl = deployConfig.url;
	const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "default-app";

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-"));
	const cloneDir = path.join(tmpDir, repoName);

	try {
		// Clone repository first (common step)
		const authenticatedRepoUrl = repoUrl.replace("https://", `https://${token}@`);
		const branch = deployConfig.branch?.trim() || "main";
		const commitSha = deployConfig.commitSha?.trim();

		if (commitSha) {
			send(
				`Cloning repo from branch "${branch}" and checking out commit ${commitSha.substring(
					0,
					7
				)}...`,
				"clone"
			);
		} else {
			send(`Cloning repo from branch "${branch}"...`, "clone");
		}

		// Get commit message from GitHub API (from commitSha or branch HEAD) for deployment history
		const commitMessage = await getCommitMessageFromGitHub(
			token,
			repoUrl,
			commitSha || undefined,
			branch || undefined
		);
		if (commitMessage) deployConfig.commitMessage = commitMessage;

		await runCommandLiveWithWebSocket("git", ["clone", "-b", branch, authenticatedRepoUrl, cloneDir], ws, 'clone', { send });

		// Checkout specific commit if provided
		if (commitSha) {
			send(`Checking out commit ${commitSha.substring(0, 7)}...`, 'clone');
			await runCommandLiveWithWebSocket("git", ["checkout", commitSha], ws, 'clone', { cwd: cloneDir, send });
			send(`✅ Checked out commit ${commitSha.substring(0, 7)}`, 'clone');
		}

		const appDir = deployConfig.core_deployment_info?.workdir
			? path.join(cloneDir, deployConfig.core_deployment_info.workdir)
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

		// Analyze application structure from the repo root (so docker-compose at root is detected
		// even when workdir points to a subdirectory)
		send("Analyzing application structure...", 'detect');
		let multiServiceConfig = detectMultiService(cloneDir);

		// Reusing same repo instance: deploy all services to it (do not filter to one service).
		const reusingInstance = !!deployConfig.ec2?.instanceId?.trim();
		if (reusingInstance) {
			send(`Reusing existing instance for this repo; deploying all ${multiServiceConfig.services.length} service(s) to it`, 'detect');
		} else {
			// Single-service deploy from sheet: filter to that service only (creates new instance with that service).
			// Page "Deploy all" does not set monorepo_service_name → all services on one instance.
			const requestedService = deployConfig.monorepo_service_name?.trim();
			if (requestedService) {
				const one = multiServiceConfig.services.find((s) => s.name === requestedService);
				if (!one) {
					const available = multiServiceConfig.services.map((s) => s.name).join(", ") || "none";
					throw new Error(`Service '${requestedService}' not found. Available: ${available}`);
				}
				multiServiceConfig = { ...multiServiceConfig, services: [one], isMultiService: true };
				send(`Deploying single service: ${requestedService}`, 'detect');
			}
		}

		if (multiServiceConfig.isMonorepo) {
			send(`📦 Detected monorepo (${multiServiceConfig.packageManager || 'npm'} workspaces) with ${multiServiceConfig.services.length} deployable service(s)`, 'detect');
			for (const svc of multiServiceConfig.services) {
				send(`  - ${svc.name} (${svc.language || 'node'}, port ${svc.port})${svc.relativePath ? ` at ${svc.relativePath}` : ''}`, 'detect');
			}
		} else if (multiServiceConfig.isMultiService) {
			send(`🔧 Detected multi-service application with ${multiServiceConfig.services.length} services`, 'detect');
		}

		const dbConfig = detectDatabase(appDir);

		if (dbConfig) {
			send(`✅ Detected ${dbConfig.type.toUpperCase()} database requirement`, 'detect');
		}

		// Route to AWS EC2 deployment (the only supported target today)
		return await handleAWSDeploy(
			deployConfig,
			appDir,
			cloneDir,
			tmpDir,
			multiServiceConfig,
			dbConfig,
			token,
			ws,
			userID,
			deployStartTime,
			send,
			deploySteps
		);
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
	}
}

/** Step definitions for the EC2 flow so the client shows accurate labels */
const EC2_DEPLOY_STEPS: { id: string; label: string }[] = [
	{ id: "clone", label: "📦 Cloning repository" },
	{ id: "auth", label: "🔐 Authentication" },
	{ id: "database", label: "🗄️ Database (RDS)" },
	{ id: "setup", label: "⚙️ Setup (VPC, key, security)" },
	{ id: "deploy", label: "🚀 Deploy to EC2" },
	{ id: "done", label: "✅ Done" },
];

function sendDeploySteps(ws: any, steps: { id: string; label: string }[]) {
	if (ws?.readyState === ws?.OPEN) {
		ws.send(JSON.stringify({ type: "deploy_steps", payload: { steps, time: new Date().toISOString() } }));
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
	// Use provided deployment ID or create one on the spot so we always persist the deployment
	let deploymentId = deployConfig.id != null ? String(deployConfig.id).trim() : "";
	if (!deploymentId) {
		deploymentId = crypto.randomUUID?.() ?? `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		console.log("No deployment ID provided - created:", deploymentId);
	}

	try {
		// Prepare minimal deployment config for DB (use resolved id so new deployments get saved)
		const minimalDeployment: DeployConfig = {
			...deployConfig,
			id: deploymentId,
			status: success ? "running" : "didnt_deploy",
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

		// Record deployment history under user so it survives service deletion
		const historyEntry = {
			timestamp: new Date().toISOString(),
			success,
			steps,
			configSnapshot: configSnapshotFromDeployConfig(deployConfig),
			...(deployConfig.commitSha && { commitSha: deployConfig.commitSha }),
			...(deployConfig.commitMessage?.trim() && { commitMessage: deployConfig.commitMessage.trim() }),
			...(deployConfig.branch && { branch: deployConfig.branch }),
			...(durationMs && { durationMs }),
			...(deployConfig.service_name?.trim() && { serviceName: deployConfig.service_name.trim() }),
			...(deployConfig.url?.trim() && { repoUrl: deployConfig.url.trim() }),
		};

		const historyResponse = await dbHelper.addDeploymentHistory(
			deploymentId,
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

/** Per-service details to persist after deploy (currently only EC2) */
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
	console.log("Deployment details:", {deployConfig, deployUrl, success, deploymentTarget, vercelDns, serviceDetails, durationMs});
	
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
			time?: string;
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
		payload.time = new Date().toISOString();
		ws.send(JSON.stringify({ type: "deploy_complete", payload }));
	}
}

/**
 * Handles the AWS EC2 deployment flow once the repo has been cloned and analyzed.
 */
async function handleAWSDeploy(
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

	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";

	// Setup AWS credentials
	send("Authenticating with AWS...", 'auth');
	await setupAWSCredentials(ws);
	send("✅ AWS credentials authenticated", 'auth');

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

	if (ec2Result.baseUrl === "") {
		send(
			"❌ Deployment failed: Server is not responding on any known ports. Please check your application and try again.",
			"deploy"
		);
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
		send(ec2Summary, "done");
		deployUrl = ec2Result.sharedAlbDns || ec2Result.baseUrl;
		result = "done";
	}

	
	let vercelResult: AddVercelDnsResult | null = null;
	if (deployUrl && deployConfig.custom_url != deployUrl && deployConfig.service_name?.trim() && success) {
		send("Adding Vercel DNS record...", "done");
		vercelResult = await addVercelDnsRecord(deployUrl, deployConfig.service_name, {
			deploymentTarget: "ec2",
			previousCustomUrl: deployConfig.custom_url ?? null,
		});
	}

	if (vercelResult && vercelResult.success) {
		send(`✅ Vercel DNS added successfully: ${vercelResult.customUrl}`, "done");
	} else if (deployUrl && vercelResult && success) {
		send(`❌ Vercel DNS addition failed: ${vercelResult?.error ?? "Unknown error"}`, "done");
		success = false; // Mark overall deployment as failure if DNS addition failed (since custom URL is a key feature)
	}

	// Mark final step as success
	const doneStep = deploySteps.find(s => s.id === 'done');
	if (doneStep) doneStep.status = 'success';

	// Calculate deployment duration
	const durationMs = Date.now() - deployStartTime;


	// Notify client of success and URL (include service details so client can persist for redeploy/update/delete)
	sendDeployComplete(
		ws,
		deployUrl,
		success,
		deployConfig,
		deploySteps,
		userID,
		"ec2",
		vercelResult,
		serviceDetails,
		durationMs
	);

	// Cleanup
	fs.rmSync(tmpDir, { recursive: true, force: true });
	return result;
}

