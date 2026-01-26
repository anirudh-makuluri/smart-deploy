import fs from "fs";
import os from "os";
import path from "path";
import config from "../config";
import { runCommandLiveWithWebSocket } from "../server-helper";
import { DeployConfig } from "../app/types";
import { detectMultiService, ServiceDefinition } from "./multiServiceDetector";
import { detectDatabase } from "./databaseDetector";
import { createCloudSQLInstance, connectCloudRunToCloudSQL, generateCloudSQLConnectionString } from "./handleDatabaseDeploy";

/**
 * Generates Dockerfile content for a service
 */
function generateDockerfileForService(
	service: ServiceDefinition,
	deployConfig: DeployConfig,
	serviceIndex: number
): string {
	const language = service.language || "node";
	const workdir = service.workdir || "/app";
	const port = service.port || 8080;

	let dockerfileContent = "";

	switch (language) {
		case "node":
			dockerfileContent = `
FROM node:18-alpine
WORKDIR ${workdir}
COPY . .
RUN npm install
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : "RUN npm run build || true"}
EXPOSE ${port}
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["npm", "start"])}
			`.trim();
			break;

		case "python":
			dockerfileContent = `
FROM python:3.11-slim
WORKDIR ${workdir}
COPY . .
RUN pip install -r requirements.txt
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : ""}
EXPOSE ${port}
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["python", "main.py"])}
			`.trim();
			break;

		case "go":
			dockerfileContent = `
FROM golang:1.20-alpine
WORKDIR ${workdir}
COPY . .
RUN go mod tidy
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : "RUN go build -o app"}
EXPOSE ${port}
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["./app"])}
			`.trim();
			break;

		case "java":
			dockerfileContent = `
FROM openjdk:17-alpine
WORKDIR ${workdir}
COPY . .
RUN ${deployConfig.install_cmd || "./mvnw install || mvn install"}
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : "RUN ./mvnw package || mvn package"}
EXPOSE ${port}
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["java", "-jar", "target/app.jar"])}
			`.trim();
			break;

		case "rust":
			dockerfileContent = `
FROM rust:1.70-alpine
WORKDIR ${workdir}
COPY . .
RUN cargo fetch
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : "RUN cargo build --release"}
EXPOSE ${port}
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["./target/release/app"])}
			`.trim();
			break;

		case "dotnet":
			dockerfileContent = `
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR ${workdir}
COPY . .
RUN dotnet restore
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : "RUN dotnet build -c Release"}
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE ${port}
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["dotnet", "*.dll"])}
			`.trim();
			break;

		default:
			throw new Error(`Unsupported language: ${language}`);
	}

	return dockerfileContent;
}

/**
 * Deploys a single service to Cloud Run
 */
async function deployService(
	service: ServiceDefinition,
	repoName: string,
	projectId: string,
	serviceIndex: number,
	allServiceUrls: Map<string, string>,
	dbConnectionName?: string,
	dbConnectionString?: string,
	ws?: any
): Promise<string> {
	const send = (msg: string, id: string) => {
		if (ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: {
					id,
					msg
				}
			};
			ws.send(JSON.stringify(object));
		}
	};

	const serviceName = `${repoName}-${service.name}`;
	const imageName = `${repoName}-${service.name}-image`;
	const gcpImage = `gcr.io/${projectId}/${imageName}:latest`;

	send(`🐳 Building Docker image for service "${service.name}"...`, `docker-${serviceIndex}`);
	
	// Build context is the service's workdir
	const buildContext = service.build_context || service.workdir;
	
	await runCommandLiveWithWebSocket("gcloud", [
		"builds", "submit",
		"--tag", gcpImage,
		buildContext
	], ws, `docker-${serviceIndex}`);

	send(`🚀 Deploying service "${service.name}" to Cloud Run...`, `deploy-${serviceIndex}`);

	// Prepare environment variables
	const envVars: string[] = [];
	
	// Add service's own env vars
	if (service.env_vars) {
		for (const [key, value] of Object.entries(service.env_vars)) {
			envVars.push(`${key}=${value}`);
		}
	}

	// Add service URLs for inter-service communication
	for (const [svcName, url] of allServiceUrls.entries()) {
		if (svcName !== service.name) {
			const envKey = `${svcName.toUpperCase().replace(/-/g, "_")}_URL`;
			envVars.push(`${envKey}=${url}`);
		}
	}

	// Add database connection string if available
	if (dbConnectionString) {
		envVars.push(`ConnectionStrings__DefaultConnection=${dbConnectionString}`);
		envVars.push(`DATABASE_URL=${dbConnectionString}`);
		envVars.push(`DB_CONNECTION_STRING=${dbConnectionString}`);
	}

	const envArgs = envVars.length > 0 ? ["--set-env-vars", envVars.join(",")] : [];

	await runCommandLiveWithWebSocket("gcloud", [
		"run", "deploy", serviceName,
		"--image", gcpImage,
		"--platform", "managed",
		"--region", "us-central1",
		"--allow-unauthenticated",
		"--port", String(service.port || 8080),
		...envArgs
	], ws, `deploy-${serviceIndex}`);

	await runCommandLiveWithWebSocket("gcloud", [
		"beta", "run", "services", "add-iam-policy-binding",
		serviceName,
		"--region=us-central1",
		"--platform=managed",
		"--member=allUsers",
		"--role=roles/run.invoker",
	], ws, `deploy-${serviceIndex}`);

	// Connect to Cloud SQL if database connection is available
	if (dbConnectionName) {
		await connectCloudRunToCloudSQL(serviceName, dbConnectionName, ws);
	}

	// Get the service URL
	try {
		const urlOutput = await runCommandLiveWithWebSocket("gcloud", [
			"run", "services", "describe", serviceName,
			"--region=us-central1",
			"--platform=managed",
			"--format=value(status.url)"
		], ws, `deploy-${serviceIndex}`);

		const serviceUrl = urlOutput.trim();
		if (serviceUrl) {
			send(`✅ Service "${service.name}" deployed at: ${serviceUrl}`, `deploy-${serviceIndex}`);
			return serviceUrl;
		}
	} catch (error) {
		console.error(`Failed to get URL for ${serviceName}:`, error);
	}

	// Fallback: construct URL from service name
	const serviceUrl = `https://${serviceName}-${projectId}.a.run.app`;
	send(`✅ Service "${service.name}" deployed (URL: ${serviceUrl})`, `deploy-${serviceIndex}`);
	return serviceUrl;
}

/**
 * Main function to handle multi-service deployment
 */
export async function handleMultiServiceDeploy(
	deployConfig: DeployConfig,
	token: string,
	ws: any,
	cloneDir: string
): Promise<{ serviceUrls: Map<string, string>, deployedServices: string[] }> {
	const send = (msg: string, id: string) => {
		if (ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: {
					id,
					msg
				}
			};
			ws.send(JSON.stringify(object));
		}
	};

	const projectId = config.GCP_PROJECT_ID;
	const repoUrl = deployConfig.url;
	const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "default-app";

	const appDir = deployConfig.workdir ? path.join(cloneDir, deployConfig.workdir) : cloneDir;

	// Detect multi-service configuration
	send("🔍 Detecting application structure...", 'detect');
	const multiServiceConfig = detectMultiService(appDir);

	if (!multiServiceConfig.isMultiService || multiServiceConfig.services.length === 0) {
		throw new Error("Multi-service deployment called but no services detected");
	}

	send(`📦 Detected ${multiServiceConfig.services.length} service(s)`, 'detect');
	if (multiServiceConfig.hasDockerCompose) {
		send("📄 Using docker-compose.yml configuration", 'detect');
	} else {
		send("🤖 Using algorithmic service detection", 'detect');
	}

	// Detect database requirements
	send("🗄️ Detecting database requirements...", 'database');
	let dbConfig = null;
	let dbConnectionName: string | undefined;
	let dbConnectionString: string | undefined;
	
	// Check each service for database dependencies
	for (const service of multiServiceConfig.services) {
		const serviceDir = path.isAbsolute(service.workdir) 
			? service.workdir 
			: path.join(appDir, service.workdir);
		
		const detectedDb = detectDatabase(appDir, serviceDir);
		if (detectedDb) {
			dbConfig = detectedDb;
			send(`📊 Detected ${detectedDb.type.toUpperCase()} database requirement in ${service.name}`, 'database');
			break;
		}
	}

	// If database detected, create Cloud SQL instance
	if (dbConfig) {
		const instanceName = `${repoName}-db-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
		try {
			const { connectionName, ipAddress } = await createCloudSQLInstance(
				dbConfig,
				projectId,
				instanceName,
				ws
			);
			dbConnectionName = connectionName;
			dbConnectionString = generateCloudSQLConnectionString(
				dbConfig,
				connectionName,
				ipAddress,
				dbConfig.database
			);
			send(`✅ Cloud SQL instance ready: ${instanceName}`, 'database');
		} catch (error: any) {
			send(`⚠️ Database setup failed: ${error.message}. Services will deploy without database connection.`, 'database');
		}
	} else {
		send("ℹ️ No database requirements detected", 'database');
	}

	// Generate Dockerfiles for services that don't have them
	const serviceUrls = new Map<string, string>();
	const deployedServices: string[] = [];

	for (let i = 0; i < multiServiceConfig.services.length; i++) {
		const service = multiServiceConfig.services[i];
		send(`\n📦 Processing service: ${service.name}`, `service-${i}`);

		// Ensure workdir is absolute
		const serviceWorkdir = path.isAbsolute(service.workdir) 
			? service.workdir 
			: path.join(appDir, service.workdir);

		// Check if service has a Dockerfile
		const dockerfilePath = service.dockerfile 
			? path.join(serviceWorkdir, service.dockerfile)
			: path.join(serviceWorkdir, "Dockerfile");

		if (!fs.existsSync(dockerfilePath)) {
			send(`✍️ Generating Dockerfile for ${service.name}...`, `service-${i}`);
			const dockerfileContent = generateDockerfileForService(service, deployConfig, i);
			fs.writeFileSync(dockerfilePath, dockerfileContent);
		} else {
			send(`✅ Found existing Dockerfile for ${service.name}`, `service-${i}`);
		}

		// Update service workdir to absolute path
		service.workdir = serviceWorkdir;
		if (!service.build_context) {
			service.build_context = serviceWorkdir;
		}

		// Deploy the service
		const serviceUrl = await deployService(
			service,
			repoName,
			projectId,
			i,
			serviceUrls,
			dbConnectionName,
			dbConnectionString,
			ws
		);

		serviceUrls.set(service.name, serviceUrl);
		deployedServices.push(service.name);
	}

	send(`\n✅ All ${deployedServices.length} services deployed successfully!`, 'done');
	
	return { serviceUrls, deployedServices };
}
