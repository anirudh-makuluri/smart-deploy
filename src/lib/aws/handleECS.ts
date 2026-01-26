import fs from "fs";
import os from "os";
import path from "path";
import config from "../../config";
import { DeployConfig } from "../../app/types";
import { MultiServiceConfig, ServiceDefinition } from "../multiServiceDetector";
import { 
	setupAWSCredentials, 
	runAWSCommand, 
	getDefaultVpcId,
	getSubnetIds,
	ensureSecurityGroup,
	generateResourceName,
	waitForResource
} from "./awsHelpers";

/**
 * Returns true if the service has Next.js (package.json has "next" in dependencies or devDependencies).
 */
function isNextJsApp(serviceDir: string): boolean {
	const pkgPath = path.join(serviceDir, "package.json");
	if (!fs.existsSync(pkgPath)) return false;
	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		return !!(pkg.dependencies?.next ?? pkg.devDependencies?.next);
	} catch {
		return false;
	}
}

/**
 * Generates a Dockerfile for a service if it doesn't exist
 */
function generateDockerfile(serviceDir: string, language: string, port: number = 8080): void {
	const dockerfilePath = path.join(serviceDir, "Dockerfile");
	if (fs.existsSync(dockerfilePath)) return;

	let content = "";
	switch (language) {
		case "node":
			if (isNextJsApp(serviceDir)) {
				content = `
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build || true
ENV PORT=${port}
EXPOSE ${port}
CMD ["npm", "start"]
`.trim();
			} else {
				content = `
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build || true
EXPOSE ${port}
CMD ["npm", "start"]
`.trim();
			}
			break;
		case "python":
			content = `
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE ${port}
CMD ["python", "app.py"]
`.trim();
			break;
		case "go":
			content = `
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o main .

FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/main .
EXPOSE ${port}
CMD ["./main"]
`.trim();
			break;
		case "dotnet":
			content = `
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY *.csproj ./
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .
EXPOSE ${port}
ENTRYPOINT ["dotnet", "*.dll"]
`.trim();
			break;
		default:
			content = `
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install
EXPOSE ${port}
CMD ["npm", "start"]
`.trim();
	}
	
	fs.writeFileSync(dockerfilePath, content);
}

/**
 * Ensures ECR repository exists
 */
async function ensureECRRepository(
	repoName: string,
	region: string,
	ws: any
): Promise<string> {
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

	try {
		// Check if repository exists
		const output = await runAWSCommand([
			"ecr", "describe-repositories",
			"--repository-names", repoName,
			"--query", "repositories[0].repositoryUri",
			"--output", "text",
			"--region", region
		], ws, 'docker');
		
		const uri = output.trim();
		if (uri && uri !== 'None') {
			send(`ECR repository ${repoName} already exists`, 'docker');
			return uri;
		}
	} catch {
		// Repository doesn't exist, create it
	}

	send(`Creating ECR repository: ${repoName}...`, 'docker');
	const createOutput = await runAWSCommand([
		"ecr", "create-repository",
		"--repository-name", repoName,
		"--query", "repository.repositoryUri",
		"--output", "text",
		"--region", region
	], ws, 'docker');

	return createOutput.trim();
}

/**
 * Builds and pushes Docker image to ECR
 */
async function buildAndPushToECR(
	serviceDir: string,
	ecrUri: string,
	imageTag: string,
	region: string,
	ws: any
): Promise<string> {
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

	const fullImageUri = `${ecrUri}:${imageTag}`;

	// Get ECR login password
	send("Authenticating with ECR...", 'docker');
	const accountId = ecrUri.split('.')[0];
	const ecrEndpoint = `${accountId}.dkr.ecr.${region}.amazonaws.com`;
	
	await runAWSCommand([
		"ecr", "get-login-password",
		"--region", region
	], ws, 'docker');

	// Docker login to ECR
	const loginCmd = `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${ecrEndpoint}`;
	const { runCommandLiveWithWebSocket } = await import("../../server-helper");
	
	if (process.platform === 'win32') {
		await runCommandLiveWithWebSocket("powershell", ["-Command", loginCmd], ws, 'docker');
	} else {
		await runCommandLiveWithWebSocket("sh", ["-c", loginCmd], ws, 'docker');
	}

	// Build Docker image
	send(`Building Docker image: ${fullImageUri}...`, 'docker');
	await runCommandLiveWithWebSocket("docker", [
		"build", "-t", fullImageUri, serviceDir
	], ws, 'docker');

	// Push to ECR
	send(`Pushing image to ECR: ${fullImageUri}...`, 'docker');
	await runCommandLiveWithWebSocket("docker", [
		"push", fullImageUri
	], ws, 'docker');

	return fullImageUri;
}

/**
 * Creates or gets ECS cluster
 */
async function ensureECSCluster(
	clusterName: string,
	region: string,
	ws: any
): Promise<string> {
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

	try {
		const output = await runAWSCommand([
			"ecs", "describe-clusters",
			"--clusters", clusterName,
			"--query", "clusters[0].clusterArn",
			"--output", "text",
			"--region", region
		], ws, 'deploy');
		
		if (output.trim() && output.trim() !== 'None' && !output.includes('MISSING')) {
			send(`ECS cluster ${clusterName} already exists`, 'deploy');
			return output.trim();
		}
	} catch {
		// Cluster doesn't exist
	}

	send(`Creating ECS cluster: ${clusterName}...`, 'deploy');
	const createOutput = await runAWSCommand([
		"ecs", "create-cluster",
		"--cluster-name", clusterName,
		"--capacity-providers", "FARGATE", "FARGATE_SPOT",
		"--default-capacity-provider-strategy", "capacityProvider=FARGATE,weight=1",
		"--query", "cluster.clusterArn",
		"--output", "text",
		"--region", region
	], ws, 'deploy');

	return createOutput.trim();
}

/**
 * Creates ECS task definition
 */
async function createTaskDefinition(
	taskFamily: string,
	containerName: string,
	imageUri: string,
	port: number,
	envVars: Record<string, string>,
	region: string,
	ws: any
): Promise<string> {
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

	send(`Creating task definition: ${taskFamily}...`, 'deploy');

	// Build environment variables array
	const envArray = Object.entries(envVars).map(([name, value]) => ({
		name,
		value
	}));

	const taskDef = {
		family: taskFamily,
		networkMode: "awsvpc",
		requiresCompatibilities: ["FARGATE"],
		cpu: "256",
		memory: "512",
		executionRoleArn: `arn:aws:iam::${await getAccountId(ws)}:role/ecsTaskExecutionRole`,
		containerDefinitions: [{
			name: containerName,
			image: imageUri,
			essential: true,
			portMappings: [{
				containerPort: port,
				protocol: "tcp"
			}],
			environment: envArray,
			logConfiguration: {
				logDriver: "awslogs",
				options: {
					"awslogs-group": `/ecs/${taskFamily}`,
					"awslogs-region": region,
					"awslogs-stream-prefix": "ecs",
					"awslogs-create-group": "true"
				}
			}
		}]
	};

	// Write task definition to temp file
	const tmpFile = path.join(os.tmpdir(), `task-def-${Date.now()}.json`);
	fs.writeFileSync(tmpFile, JSON.stringify(taskDef, null, 2));

	const output = await runAWSCommand([
		"ecs", "register-task-definition",
		"--cli-input-json", `file://${tmpFile}`,
		"--query", "taskDefinition.taskDefinitionArn",
		"--output", "text",
		"--region", region
	], ws, 'deploy');

	fs.unlinkSync(tmpFile);
	return output.trim();
}

/**
 * Gets AWS account ID
 */
async function getAccountId(ws: any): Promise<string> {
	const output = await runAWSCommand([
		"sts", "get-caller-identity",
		"--query", "Account",
		"--output", "text"
	], ws, 'auth');
	return output.trim();
}

/**
 * Creates or updates ECS service
 */
async function createOrUpdateService(
	clusterArn: string,
	serviceName: string,
	taskDefArn: string,
	subnetIds: string[],
	securityGroupId: string,
	desiredCount: number,
	region: string,
	ws: any
): Promise<string> {
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

	// Check if service exists
	let serviceExists = false;
	try {
		const output = await runAWSCommand([
			"ecs", "describe-services",
			"--cluster", clusterArn,
			"--services", serviceName,
			"--query", "services[0].status",
			"--output", "text",
			"--region", region
		], ws, 'deploy');
		
		if (output.trim() && output.trim() !== 'None' && output.trim() !== 'INACTIVE') {
			serviceExists = true;
		}
	} catch {
		// Service doesn't exist
	}

	if (serviceExists) {
		send(`Updating ECS service: ${serviceName}...`, 'deploy');
		await runAWSCommand([
			"ecs", "update-service",
			"--cluster", clusterArn,
			"--service", serviceName,
			"--task-definition", taskDefArn,
			"--desired-count", String(desiredCount),
			"--force-new-deployment",
			"--region", region
		], ws, 'deploy');
	} else {
		send(`Creating ECS service: ${serviceName}...`, 'deploy');
		await runAWSCommand([
			"ecs", "create-service",
			"--cluster", clusterArn,
			"--service-name", serviceName,
			"--task-definition", taskDefArn,
			"--desired-count", String(desiredCount),
			"--launch-type", "FARGATE",
			"--network-configuration", `awsvpcConfiguration={subnets=[${subnetIds.join(',')}],securityGroups=[${securityGroupId}],assignPublicIp=ENABLED}`,
			"--region", region
		], ws, 'deploy');
	}

	return serviceName;
}

/**
 * Handles deployment to AWS ECS Fargate
 */
export async function handleECS(
	deployConfig: DeployConfig,
	appDir: string,
	multiServiceConfig: MultiServiceConfig,
	dbConnectionString: string | undefined,
	ws: any
): Promise<{ serviceUrls: Map<string, string>, deployedServices: string[] }> {
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";
	const clusterName = generateResourceName(repoName, "cluster");
	const imageTag = `v-${Date.now()}`;

	// Setup AWS credentials
	send("Authenticating with AWS...", 'auth');
	await setupAWSCredentials(ws);

	// Get networking info
	send("Setting up networking...", 'setup');
	const vpcId = await getDefaultVpcId(ws);
	const subnetIds = await getSubnetIds(vpcId, ws);
	const securityGroupId = await ensureSecurityGroup(
		`${repoName}-ecs-sg`,
		vpcId,
		`Security group for ${repoName} ECS services`,
		ws
	);

	// Create ECS cluster
	const clusterArn = await ensureECSCluster(clusterName, region, ws);

	const serviceUrls = new Map<string, string>();
	const deployedServices: string[] = [];

	// Determine services to deploy
	const services: { name: string; dir: string; language: string; port: number }[] = [];

	if (multiServiceConfig.isMultiService && multiServiceConfig.services.length > 0) {
		for (const svc of multiServiceConfig.services) {
			services.push({
				name: svc.name,
				dir: path.isAbsolute(svc.workdir) ? svc.workdir : path.join(appDir, svc.workdir),
				language: svc.language || 'node',
				port: svc.port || 8080
			});
		}
	} else {
		// Single service
		services.push({
			name: repoName,
			dir: appDir,
			language: detectLanguage(appDir),
			port: deployConfig.core_deployment_info?.port || 8080
		});
	}

	// Deploy each service
	for (const service of services) {
		send(`\nDeploying service: ${service.name}...`, 'deploy');

		// Generate Dockerfile if needed
		generateDockerfile(service.dir, service.language, service.port);

		// Create ECR repository
		const ecrRepoName = `${repoName}-${service.name}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
		const ecrUri = await ensureECRRepository(ecrRepoName, region, ws);

		// Build and push image
		const imageUri = await buildAndPushToECR(service.dir, ecrUri, imageTag, region, ws);

		// Prepare environment variables
		const envVars: Record<string, string> = {
			PORT: String(service.port),
			NODE_ENV: 'production'
		};

		// Add database connection if available
		if (dbConnectionString) {
			envVars.DATABASE_URL = dbConnectionString;
			envVars.DB_CONNECTION_STRING = dbConnectionString;
			envVars.ConnectionStrings__DefaultConnection = dbConnectionString;
		}

		// Add user-provided env vars
		if (deployConfig.env_vars) {
			const vars = deployConfig.env_vars.split(',');
			for (const v of vars) {
				const [key, value] = v.split('=');
				if (key && value) {
					envVars[key.trim()] = value.trim();
				}
			}
		}

		// Add other service URLs
		for (const [svcName, url] of serviceUrls.entries()) {
			if (svcName !== service.name) {
				const envKey = `${svcName.toUpperCase().replace(/-/g, '_')}_URL`;
				envVars[envKey] = url;
			}
		}

		// Create task definition
		const taskFamily = `${repoName}-${service.name}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
		const containerName = service.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
		const taskDefArn = await createTaskDefinition(
			taskFamily,
			containerName,
			imageUri,
			service.port,
			envVars,
			region,
			ws
		);

		// Create/update ECS service
		const serviceName = `${repoName}-${service.name}-svc`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
		await createOrUpdateService(
			clusterArn,
			serviceName,
			taskDefArn,
			subnetIds.slice(0, 2),
			securityGroupId,
			1,
			region,
			ws
		);

		// Wait for service to be stable
		send(`Waiting for service ${service.name} to be stable...`, 'deploy');
		await waitForServiceStable(clusterArn, serviceName, region, ws);

		// Get service URL (for now, use task public IP)
		const serviceUrl = await getServiceUrl(clusterArn, serviceName, service.port, region, ws);
		
		serviceUrls.set(service.name, serviceUrl);
		deployedServices.push(service.name);
		
		send(`Service ${service.name} deployed at: ${serviceUrl}`, 'deploy');
	}

	send(`\nAll ${deployedServices.length} services deployed successfully!`, 'done');
	return { serviceUrls, deployedServices };
}

/**
 * Detects language from directory
 */
function detectLanguage(dir: string): string {
	if (fs.existsSync(path.join(dir, "package.json"))) return "node";
	if (fs.existsSync(path.join(dir, "requirements.txt"))) return "python";
	if (fs.existsSync(path.join(dir, "go.mod"))) return "go";
	const files = fs.readdirSync(dir);
	if (files.some(f => f.endsWith(".csproj") || f.endsWith(".sln"))) return "dotnet";
	return "node";
}

/**
 * Waits for ECS service to be stable
 */
async function waitForServiceStable(
	clusterArn: string,
	serviceName: string,
	region: string,
	ws: any
): Promise<void> {
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

	let attempts = 0;
	const maxAttempts = 30;

	while (attempts < maxAttempts) {
		try {
			const output = await runAWSCommand([
				"ecs", "describe-services",
				"--cluster", clusterArn,
				"--services", serviceName,
				"--query", "services[0].deployments[0].runningCount",
				"--output", "text",
				"--region", region
			], ws, 'deploy');

			const runningCount = parseInt(output.trim());
			if (runningCount > 0) {
				send(`Service is running with ${runningCount} task(s)`, 'deploy');
				return;
			}
		} catch {
			// Continue waiting
		}

		attempts++;
		send(`Waiting for service to start... (${attempts}/${maxAttempts})`, 'deploy');
		await new Promise(resolve => setTimeout(resolve, 10000));
	}
}

/**
 * Gets the public URL for an ECS service
 */
async function getServiceUrl(
	clusterArn: string,
	serviceName: string,
	port: number,
	region: string,
	ws: any
): Promise<string> {
	try {
		// Get task ARN
		const taskOutput = await runAWSCommand([
			"ecs", "list-tasks",
			"--cluster", clusterArn,
			"--service-name", serviceName,
			"--query", "taskArns[0]",
			"--output", "text",
			"--region", region
		], ws, 'deploy');

		const taskArn = taskOutput.trim();
		if (!taskArn || taskArn === 'None') {
			return `http://<pending>:${port}`;
		}

		// Get task details
		const taskDetails = await runAWSCommand([
			"ecs", "describe-tasks",
			"--cluster", clusterArn,
			"--tasks", taskArn,
			"--query", "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value",
			"--output", "text",
			"--region", region
		], ws, 'deploy');

		const eniId = taskDetails.trim();
		if (!eniId || eniId === 'None') {
			return `http://<pending>:${port}`;
		}

		// Get public IP from ENI
		const ipOutput = await runAWSCommand([
			"ec2", "describe-network-interfaces",
			"--network-interface-ids", eniId,
			"--query", "NetworkInterfaces[0].Association.PublicIp",
			"--output", "text",
			"--region", region
		], ws, 'deploy');

		const publicIp = ipOutput.trim();
		if (publicIp && publicIp !== 'None') {
			return `http://${publicIp}:${port}`;
		}
	} catch {
		// Ignore errors
	}

	return `http://<check-aws-console>:${port}`;
}
