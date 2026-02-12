import fs from "fs";
import os from "os"
import path from "path";
import config from "../config";
import { runCommandLiveWithWebSocket } from "../server-helper";
import { AWSDeploymentTarget, DeployConfig, CloudProvider, EC2DeployDetails, ECSDeployDetails, AmplifyDeployDetails, ElasticBeanstalkDeployDetails, DeployStep } from "../app/types";
import { detectMultiService, MultiServiceConfig } from "./multiServiceDetector";
import { detectDatabase, DatabaseConfig } from "./databaseDetector";
import { handleMultiServiceDeploy } from "./handleMultiServiceDeploy";
import { dbHelper } from "../db-helper";
import { configSnapshotFromDeployConfig } from "./utils";
import { createWebSocketLogger, createDeployStepsLogger } from "./websocketLogger";

// AWS imports
import { setupAWSCredentials, detectLanguage as detectAppLanguage } from "./aws";
import { handleAmplify } from "./aws/handleAmplify";
import { handleElasticBeanstalk } from "./aws/handleElasticBeanstalk";
import { handleECS } from "./aws/handleECS";
import { handleEC2 } from "./aws/handleEC2";
import { createRDSInstance } from "./aws/handleRDS";

// GCP imports (for Cloud SQL)
import { createCloudSQLInstance, generateCloudSQLConnectionString } from "./handleDatabaseDeploy";
import { addVercelDnsRecord, AddVercelDnsResult } from "./vercelDns";

/**
 * Main deployment handler - routes to AWS (default) or GCP
 */
export async function handleDeploy(deployConfig: DeployConfig, token: string, ws: any, userID?: string): Promise<string> {
	const send = createWebSocketLogger(ws);

	console.log("in handle deploy");

	const target = deployConfig.deploymentTarget;
	if (!target) {
		throw new Error('Deployment target not set. Please run Smart Project Scan first.');
	}
	if (!AWS_DEPLOY_STEPS[target]) {
		throw new Error(`Unknown deployment target: ${target}`);
	}
	sendDeploySteps(ws, AWS_DEPLOY_STEPS[target]);
	const commitSha = deployConfig.commitSha?.trim();
	if (commitSha) {
		send(`Deploying commit ${commitSha.substring(0, 7)} to: ${target.toUpperCase()}`, 'clone');
	} else {
		send(`Deploying to: ${target.toUpperCase()}`, 'clone');
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
		
		if (commitSha) {
			send(`Cloning repo from branch "${branch}" and checking out commit ${commitSha.substring(0, 7)}...`, 'clone');
		} else {
			send(`Cloning repo from branch "${branch}"...`, 'clone');
		}
		
		await runCommandLiveWithWebSocket("git", ["clone", "-b", branch, authenticatedRepoUrl, cloneDir], ws, 'clone');

		// Checkout specific commit if provided
		if (commitSha) {
			send(`Checking out commit ${commitSha.substring(0, 7)}...`, 'clone');
			await runCommandLiveWithWebSocket("git", ["checkout", commitSha], ws, 'clone', { cwd: cloneDir });
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
		const multiServiceConfig = detectMultiService(cloneDir);

		const dbConfig = detectDatabase(appDir);

		if (dbConfig) {
			send(`✅ Detected ${dbConfig.type.toUpperCase()} database requirement`, 'detect');
		}

		// Route to appropriate cloud provider
		if (cloudProvider === 'aws') {
			return await handleAWSDeploy(deployConfig, appDir, cloneDir, tmpDir, multiServiceConfig, dbConfig, token, ws, userID);
		} else {
			return await handleGCPDeploy(deployConfig, appDir, cloneDir, tmpDir, multiServiceConfig, dbConfig, token, ws, userID);
		}
	} catch (error: any) {
		send(`Deployment failed: ${error.message}`, 'error');
		if (ws.readyState === ws.OPEN) {
			ws.send(JSON.stringify({ type: "deploy_complete", payload: { deployUrl: null, success: false } }));
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
		throw error;
	}
}

/** Step definitions per AWS target so the client shows accurate labels */
const AWS_DEPLOY_STEPS: Record<AWSDeploymentTarget, { id: string; label: string }[]> = {
	"amplify": [
		{ id: "clone", label: "📦 Cloning repository" },
		{ id: "detect", label: "🔍 Analyzing app" },
		{ id: "auth", label: "🔐 Authentication" },		
		{ id: "build", label: "🔨 Build" },
		{ id: "amplify", label: "🚀 Deploy to Amplify" },
		{ id: "done", label: "✅ Done" },
	],
	"elastic-beanstalk": [
		{ id: "clone", label: "📦 Cloning repository" },
		{ id: "auth", label: "🔐 Authentication" },
		{ id: "detect", label: "🔍 Analyzing app" },
		{ id: "setup", label: "⚙️ Setup (S3, app)" },
		{ id: "bundle", label: "📦 Create bundle" },
		{ id: "upload", label: "📤 Upload to S3" },
		{ id: "deploy", label: "🚀 Deploy to Elastic Beanstalk" },
		{ id: "done", label: "✅ Done" },
	],
	"ecs": [
		{ id: "clone", label: "📦 Cloning repository" },
		{ id: "detect", label: "🔍 Analyzing app" },
		{ id: "auth", label: "🔐 Authentication" },
		{ id: "database", label: "🗄️ Database (RDS)" },
		{ id: "setup", label: "⚙️ Setup (VPC, ECR, S3, CodeBuild)" },
		{ id: "docker", label: "🐳 Build image (CodeBuild)" },
		{ id: "deploy", label: "🚀 Deploy to ECS + ALB" },
		{ id: "done", label: "✅ Done" },
	],
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
	customUrl?: string | null
): Promise<void> {
	if (!userID) {
		console.warn("No userID provided - skipping database save");
		return;
	}

	try {
		// Prepare minimal deployment config for DB
		const minimalDeployment: DeployConfig = {
			...deployConfig,
			status: success ? "running" : "didnt_deploy",
			...(deployUrl && { deployUrl }),
			...(customUrl && { custom_url: customUrl }),
			...(serviceDetails?.ec2 && { ec2: serviceDetails.ec2 }),
			...(serviceDetails?.ecs && { ecs: serviceDetails.ecs }),
			...(serviceDetails?.amplify && { amplify: serviceDetails.amplify }),
			...(serviceDetails?.elasticBeanstalk && { elasticBeanstalk: serviceDetails.elasticBeanstalk }),
		};

		// Update deployment document (creates if doesn't exist)
		const updateResponse = await dbHelper.updateDeployments(minimalDeployment, userID);
		if (updateResponse.error) {
			console.error("Failed to update deployment:", updateResponse.error);
		} else {
			console.log("Deployment saved to DB:", updateResponse.success);
		}

		// Record deployment history
		const historyEntry = {
			timestamp: new Date().toISOString(),
			success,
			steps,
			configSnapshot: configSnapshotFromDeployConfig(deployConfig),
			deployUrl,
		};

		const historyResponse = await dbHelper.addDeploymentHistory(
			deployConfig.id,
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
	ecs?: ECSDeployDetails;
	amplify?: AmplifyDeployDetails;
	elasticBeanstalk?: ElasticBeanstalkDeployDetails;
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
	serviceDetails?: ServiceDeployDetails | null
) {
	// Save to database before sending WebSocket message
	saveDeploymentToDB(
		deployConfig,
		deployUrl,
		success,
		deploySteps,
		userID,
		serviceDetails,
		vercelDns?.success ? vercelDns.customUrl : null
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
			ecs?: ECSDeployDetails;
			amplify?: AmplifyDeployDetails;
			elasticBeanstalk?: ElasticBeanstalkDeployDetails;
		} = {
			deployUrl: deployUrl ?? null,
			success,
			deploymentTarget: deploymentTarget ?? null,
		};
		if (serviceDetails?.ec2) payload.ec2 = serviceDetails.ec2;
		if (serviceDetails?.ecs) payload.ecs = serviceDetails.ecs;
		if (serviceDetails?.amplify) payload.amplify = serviceDetails.amplify;
		if (serviceDetails?.elasticBeanstalk) payload.elasticBeanstalk = serviceDetails.elasticBeanstalk;
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
	cloneDir: string,
	tmpDir: string,
	multiServiceConfig: MultiServiceConfig,
	dbConfig: DatabaseConfig | null,
	token: string,
	ws: any,
	userID: string | undefined
): Promise<string> {
	const deploySteps: DeployStep[] = [];
	const send = createDeployStepsLogger(ws, deploySteps);

	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";

	// Setup AWS credentials
	send("Authenticating with AWS...", 'auth');
	await setupAWSCredentials(ws);
	send("✅ AWS credentials authenticated", 'auth');

	// Use saved target from Smart Project Scan
	const awsTargets: AWSDeploymentTarget[] = ['amplify', 'elastic-beanstalk', 'ecs', 'ec2'];
	const savedTarget = deployConfig.deploymentTarget;
	
	if (!savedTarget || !awsTargets.includes(savedTarget)) {
		throw new Error('Deployment target not set. Please run Smart Project Scan first.');
	}

	const target = savedTarget;

	sendDeploySteps(ws, AWS_DEPLOY_STEPS[target]);

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

	// Route to appropriate AWS service
	switch (target) {
		case 'amplify':
			const amplifyResult = await handleAmplify(deployConfig, appDir, ws);
			deployUrl = amplifyResult.url;
			serviceDetails.amplify = amplifyResult.details;
			result = "done";
			break;

		case 'elastic-beanstalk':
			const ebResult = await handleElasticBeanstalk(deployConfig, appDir, ws);
			deployUrl = ebResult.url;
			serviceDetails.elasticBeanstalk = ebResult.details;
			result = "done";
			break;

		case 'ecs':
			const ecsResult = await handleECS(
				deployConfig,
				appDir,
				multiServiceConfig,
				dbConnectionString,
				ws
			);
			// Build summary
			let summary = `\nDeployment completed!\n\nDeployed services:\n`;
			for (const [name, url] of ecsResult.serviceUrls.entries()) {
				summary += `  - ${name}: ${url}\n`;
			}
			send(summary, 'done');
			// Primary URL for client (first service)
			const firstUrl = ecsResult.serviceUrls.entries().next().value;
			deployUrl = firstUrl ? firstUrl[1] : undefined;
			serviceDetails.ecs = ecsResult.details;
			result = "done";
			break;

		case 'ec2':
			const ec2Result = await handleEC2(
				deployConfig,
				appDir,
				multiServiceConfig,
				token,
				dbConnectionString,
				ws
			);

			serviceDetails.ec2 = {
				baseUrl: ec2Result.baseUrl,
				instanceId: ec2Result.instanceId,
				publicIp: ec2Result.publicIp,
				vpcId: ec2Result.vpcId,
				subnetId: ec2Result.subnetId,
				securityGroupId: ec2Result.securityGroupId,
				amiId: ec2Result.amiId,
			};

			if(ec2Result.baseUrl == "") {
				send(`❌ Deployment failed: Server is not responding on any known ports. Please check your application and try again.`, 'deploy');
				result = "error";
				break;
			}

			// Build summary
			let ec2Summary = `\nDeployment completed!\n`;
			ec2Summary += `Instance ID: ${ec2Result.instanceId}\n`;
			ec2Summary += `Public IP: ${ec2Result.publicIp}\n`;
			ec2Summary += `\nService URLs:\n`;
			for (const [name, url] of ec2Result.serviceUrls.entries()) {
				ec2Summary += `  - ${name}: ${url}\n`;
			}
			send(ec2Summary, 'done');
			deployUrl = ec2Result.baseUrl;
			result = "done";
			break;

		default:
			throw new Error(`Unknown deployment target: ${target}`);
	}

	send("Adding Vercel DNS record...", 'done');
	// Add Vercel DNS record when deploy succeeded and domain is configured
	let vercelResult: AddVercelDnsResult | null = null;
	if (deployUrl && deployConfig.service_name?.trim()) {
		vercelResult = await addVercelDnsRecord(deployUrl, deployConfig.service_name, {
			deploymentTarget: target,
			previousCustomUrl: deployConfig.custom_url ?? null,
		});
	}
	
	if(vercelResult && vercelResult.success) {
		send(`✅ Vercel DNS added successfully: ${vercelResult.customUrl}`, 'done');
	} else {
		send(`❌ Vercel DNS addition failed: ${vercelResult?.error ?? "Unknown error"}`, 'done');
	}

	// Mark final step as success
	const doneStep = deploySteps.find(s => s.id === 'done');
	if (doneStep) doneStep.status = 'success';

	// Notify client of success and URL (include service details so client can persist for redeploy/update/delete)
	sendDeployComplete(ws, deployUrl, true, deployConfig, deploySteps, userID, target, vercelResult, serviceDetails);

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
	userID: string | undefined
): Promise<string> {
	const deploySteps: DeployStep[] = [];
	const send = createDeployStepsLogger(ws, deploySteps);

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
	await runCommandLiveWithWebSocket("gcloud", ["auth", "activate-service-account", `--key-file=${keyPath}`], ws, 'auth');
	await runCommandLiveWithWebSocket("gcloud", ["config", "set", "project", projectId, "--quiet"], ws, 'auth');
	await runCommandLiveWithWebSocket("gcloud", ["auth", "configure-docker"], ws, 'auth');

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
		sendDeployComplete(ws, gcpDeployUrl, true, deployConfig, deploySteps, userID, "cloud-run", vercelResult, null);
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

	if (deployConfig.use_custom_dockerfile && deployConfig.dockerfileContent) {
		send("Writing custom Dockerfile...", 'clone');
		fs.writeFileSync(dockerfilePath, deployConfig.dockerfileContent);
	}

	if (!deployConfig.use_custom_dockerfile && !fs.existsSync(dockerfilePath)) {
		const language = detectAppLanguage(appDir, multiServiceConfig) ?? "node";
		send(`Detected Language: ${language}`, 'clone');

		let dockerfileContent = "";

		const coreInfo = deployConfig.core_deployment_info;

		switch (language) {
			case "node":
				dockerfileContent = `
FROM node:18
WORKDIR ${coreInfo?.workdir || "."}
COPY . .
RUN ${coreInfo?.install_cmd || "npm install"}
${coreInfo?.build_cmd ? `RUN ${coreInfo.build_cmd}` : ""}
EXPOSE 8080
CMD ${JSON.stringify(coreInfo?.run_cmd?.split(" ") || ["npm", "start"])}
		`.trim();
				break;

			case "python":
				dockerfileContent = `
FROM python:3.11
WORKDIR ${coreInfo?.workdir || "/app"}
COPY . .
RUN ${coreInfo?.install_cmd || "pip install -r requirements.txt"}
${coreInfo?.build_cmd ? `RUN ${coreInfo.build_cmd}` : ""}
EXPOSE 8080
CMD ${JSON.stringify(coreInfo?.run_cmd?.split(" ") || ["python", "main.py"])}
		`.trim();
				break;

			case "go":
				dockerfileContent = `
FROM golang:1.20
WORKDIR ${coreInfo?.workdir || "/app"}
COPY . .
RUN ${coreInfo?.install_cmd || "go mod tidy"}
${coreInfo?.build_cmd ? `RUN ${coreInfo.build_cmd}` : "RUN go build -o app"}
EXPOSE 8080
CMD ${JSON.stringify(coreInfo?.run_cmd?.split(" ") || ["./app"])}
		`.trim();
				break;

			case "java":
				dockerfileContent = `
FROM openjdk:17
WORKDIR ${coreInfo?.workdir || "/app"}
COPY . .
RUN ${coreInfo?.install_cmd || "./mvnw install"}
${coreInfo?.build_cmd ? `RUN ${coreInfo.build_cmd}` : "RUN ./mvnw package"}
EXPOSE 8080
CMD ${JSON.stringify(coreInfo?.run_cmd?.split(" ") || ["java", "-jar", "target/app.jar"])}
		`.trim();
				break;

			case "rust":
				dockerfileContent = `
FROM rust:1.70
WORKDIR ${coreInfo?.workdir || "/app"}
COPY . .
RUN ${coreInfo?.install_cmd || "cargo fetch"}
${coreInfo?.build_cmd ? `RUN ${coreInfo.build_cmd}` : "RUN cargo build --release"}
EXPOSE 8080
CMD ${JSON.stringify(coreInfo?.run_cmd?.split(" ") || ["./target/release/app"])}
		`.trim();
				break;

			case "dotnet":
				dockerfileContent = `
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR ${coreInfo?.workdir || "/app"}
COPY . .
RUN dotnet restore
${coreInfo?.build_cmd ? `RUN ${coreInfo.build_cmd}` : "RUN dotnet build -c Release"}
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
CMD ${JSON.stringify(coreInfo?.run_cmd?.split(" ") || ["dotnet", "*.dll"])}
		`.trim();
				break;

			default:
				throw new Error("Unsupported language or missing Dockerfile.");
		}

		fs.writeFileSync(dockerfilePath, dockerfileContent);
	}

	const imageName = `${repoName}-image`;
	const gcpImage = `gcr.io/${projectId}/${imageName}:latest`;

	send("Building Docker image with Cloud Build...", 'docker');
	await runCommandLiveWithWebSocket("gcloud", [
		"builds", "submit",
		"--tag", gcpImage,
		appDir
	], ws, 'docker');

	send("Deploying to Cloud Run...", 'deploy');
	
	// Build environment variables
	const envVarsList: string[] = [];
	if (deployConfig.env_vars) {
		envVarsList.push(deployConfig.env_vars);
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
	], ws, 'deploy');

	await runCommandLiveWithWebSocket("gcloud", [
		"beta", "run", "services", "add-iam-policy-binding",
		serviceName,
		"--region=us-central1",
		"--platform=managed",
		"--member=allUsers",
		"--role=roles/run.invoker",
	], ws, 'deploy');

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
	sendDeployComplete(ws, gcpDeployUrl, true, deployConfig, deploySteps, userID, "cloud-run", vercelResult, null);

	// Cleanup temp folder
	fs.rmSync(tmpDir, { recursive: true, force: true });

	return "done";
}
