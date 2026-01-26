import fs from "fs";
import os from "os"
import path from "path";
import config from "../config";
import { runCommandLiveWithWebSocket } from "../server-helper";
import { DeployConfig, CloudProvider } from "../app/types";
import { detectMultiService, MultiServiceConfig } from "./multiServiceDetector";
import { detectDatabase, DatabaseConfig } from "./databaseDetector";
import { handleMultiServiceDeploy } from "./handleMultiServiceDeploy";

// AWS imports
import { selectAWSDeploymentTarget, setupAWSCredentials, detectLanguage as detectAppLanguage } from "./aws";
import { handleAmplify } from "./aws/handleAmplify";
import { handleElasticBeanstalk } from "./aws/handleElasticBeanstalk";
import { handleECS } from "./aws/handleECS";
import { handleEC2 } from "./aws/handleEC2";
import { createRDSInstance } from "./aws/handleRDS";

// GCP imports (for Cloud SQL)
import { createCloudSQLInstance, generateCloudSQLConnectionString } from "./handleDatabaseDeploy";

/**
 * Main deployment handler - routes to AWS (default) or GCP
 */
export async function handleDeploy(deployConfig: DeployConfig, token: string, ws: any): Promise<string> {
	const send = (msg: string, id: string) => {
		if (ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: {
					id,
					msg
				}
			}
			ws.send(JSON.stringify(object));
		}
	};

	console.log("in handle deploy");

	// Determine cloud provider (default to AWS)
	const cloudProvider: CloudProvider = deployConfig.cloudProvider || 'aws';
	send(`Cloud Provider: ${cloudProvider.toUpperCase()}`, 'auth');

	const repoUrl = deployConfig.url;
	const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "default-app";

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-"));
	const cloneDir = path.join(tmpDir, repoName);

	try {
		// Clone repository first (common step)
		const authenticatedRepoUrl = repoUrl.replace("https://", `https://${token}@`);
		const branch = deployConfig.branch?.trim() || "main";
		send(`Cloning repo from branch "${branch}"...`, 'clone');
		await runCommandLiveWithWebSocket("git", ["clone", "-b", branch, authenticatedRepoUrl, cloneDir], ws, 'clone');

		const appDir = deployConfig.workdir ? path.join(cloneDir, deployConfig.workdir) : cloneDir;

		// Analyze application structure
		send("Analyzing application structure...", 'clone');
		const multiServiceConfig = detectMultiService(appDir);
		const dbConfig = detectDatabase(appDir);

		if (dbConfig) {
			send(`Detected ${dbConfig.type.toUpperCase()} database requirement`, 'detect');
		}

		// Route to appropriate cloud provider
		if (cloudProvider === 'aws') {
			return await handleAWSDeploy(deployConfig, appDir, cloneDir, tmpDir, multiServiceConfig, dbConfig, token, ws);
		} else {
			return await handleGCPDeploy(deployConfig, appDir, cloneDir, tmpDir, multiServiceConfig, dbConfig, token, ws);
		}
	} catch (error: any) {
		send(`Deployment failed: ${error.message}`, 'error');
		fs.rmSync(tmpDir, { recursive: true, force: true });
		throw error;
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
	ws: any
): Promise<string> {
	const send = (msg: string, id: string) => {
		if (ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";

	// Setup AWS credentials
	send("Authenticating with AWS...", 'auth');
	await setupAWSCredentials(ws);

	// Select AWS deployment target
	const analysis = selectAWSDeploymentTarget(
		appDir,
		multiServiceConfig,
		dbConfig,
		deployConfig.features_infrastructure || null
	);

	console.log("Analysis", analysis);
	send(`Selected deployment target: ${analysis.target.toUpperCase()}`, 'docker');
	send(`Reason: ${analysis.reason}`, 'docker');
	
	for (const warning of analysis.warnings) {
		send(`Warning: ${warning}`, 'docker');
	}

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
	}

	let result: string;

	// Route to appropriate AWS service
	switch (analysis.target) {
		case 'amplify':
			result = await handleAmplify(deployConfig, appDir, ws);
			break;

		case 'elastic-beanstalk':
			result = await handleElasticBeanstalk(deployConfig, appDir, ws);
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
			
			// Build summary
			let ec2Summary = `\nDeployment completed!\n`;
			ec2Summary += `Instance ID: ${ec2Result.instanceId}\n`;
			ec2Summary += `Public IP: ${ec2Result.publicIp}\n`;
			ec2Summary += `\nService URLs:\n`;
			for (const [name, url] of ec2Result.serviceUrls.entries()) {
				ec2Summary += `  - ${name}: ${url}\n`;
			}
			send(ec2Summary, 'done');
			result = "done";
			break;

		default:
			throw new Error(`Unknown deployment target: ${analysis.target}`);
	}

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
	ws: any
): Promise<string> {
	const send = (msg: string, id: string) => {
		if (ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

	const projectId = config.GCP_PROJECT_ID;
	const keyObject = JSON.parse(config.GCP_SERVICE_ACCOUNT_KEY);
	const keyPath = "/tmp/smartdeploy-key.json";
	fs.writeFileSync(keyPath, JSON.stringify(keyObject, null, 2));

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

		switch (language) {
			case "node":
				dockerfileContent = `
FROM node:18
WORKDIR ${deployConfig.workdir || "."}
COPY . .
RUN ${deployConfig.install_cmd || "npm install"}
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : ""}
EXPOSE 8080
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["npm", "start"])}
		`.trim();
				break;

			case "python":
				dockerfileContent = `
FROM python:3.11
WORKDIR ${deployConfig.workdir || "/app"}
COPY . .
RUN ${deployConfig.install_cmd || "pip install -r requirements.txt"}
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : ""}
EXPOSE 8080
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["python", "main.py"])}
		`.trim();
				break;

			case "go":
				dockerfileContent = `
FROM golang:1.20
WORKDIR ${deployConfig.workdir || "/app"}
COPY . .
RUN ${deployConfig.install_cmd || "go mod tidy"}
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : "RUN go build -o app"}
EXPOSE 8080
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["./app"])}
		`.trim();
				break;

			case "java":
				dockerfileContent = `
FROM openjdk:17
WORKDIR ${deployConfig.workdir || "/app"}
COPY . .
RUN ${deployConfig.install_cmd || "./mvnw install"}
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : "RUN ./mvnw package"}
EXPOSE 8080
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["java", "-jar", "target/app.jar"])}
		`.trim();
				break;

			case "rust":
				dockerfileContent = `
FROM rust:1.70
WORKDIR ${deployConfig.workdir || "/app"}
COPY . .
RUN ${deployConfig.install_cmd || "cargo fetch"}
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : "RUN cargo build --release"}
EXPOSE 8080
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["./target/release/app"])}
		`.trim();
				break;

			case "dotnet":
				dockerfileContent = `
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR ${deployConfig.workdir || "/app"}
COPY . .
RUN dotnet restore
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : "RUN dotnet build -c Release"}
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["dotnet", "*.dll"])}
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

	// Cleanup temp folder
	fs.rmSync(tmpDir, { recursive: true, force: true });

	return "done";
}
