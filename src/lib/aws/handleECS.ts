import fs from "fs";
import os from "os";
import path from "path";
import archiver from "archiver";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { CodeBuildClient, StartBuildCommand, BatchGetBuildsCommand, CreateProjectCommand, BatchGetProjectsCommand, UpdateProjectCommand } from "@aws-sdk/client-codebuild";
import { IAMClient, GetRoleCommand, CreateRoleCommand, PutRolePolicyCommand, AttachRolePolicyCommand } from "@aws-sdk/client-iam";
import config from "../../config";
import { DeployConfig, ECSDeployDetails } from "../../app/types";
import { MultiServiceConfig, ServiceDefinition } from "../multiServiceDetector";
import { createWebSocketLogger } from "../websocketLogger";
import { 
	setupAWSCredentials, 
	runAWSCommand, 
	getDefaultVpcId,
	getSubnetIds,
	ensureSecurityGroup,
	generateResourceName,
	waitForResource,
	ensureSharedAlb,
	ensureTargetGroup,
	ensureHostRule,
	buildServiceHostname,
	allowAlbToReachService,
	getAccountId
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
 * Checks if the project uses an older version of react-scripts that needs OpenSSL legacy provider.
 */
function needsOpenSSLLegacyProvider(serviceDir: string): boolean {
	const pkgPath = path.join(serviceDir, "package.json");
	if (!fs.existsSync(pkgPath)) return false;
	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const reactScriptsVersion = pkg.dependencies?.["react-scripts"] || pkg.devDependencies?.["react-scripts"];
		if (reactScriptsVersion) {
			// Extract major version number
			const majorVersion = parseInt(reactScriptsVersion.replace(/[^0-9]/g, "").charAt(0) || "5");
			// react-scripts < 5.0 needs legacy provider
			return majorVersion < 5;
		}
	} catch {
		return false;
	}
	return false;
}

/**
 * Generates a Dockerfile for a service if it doesn't exist
 */
function generateDockerfile(serviceDir: string, language: string, port: number = 8080): void {
	const dockerfilePath = path.join(serviceDir, "Dockerfile");
	if (fs.existsSync(dockerfilePath)) return;

	let content = "";
	// Use ECR Public (public.ecr.aws/docker/library/...) for base images so CodeBuild
	// in AWS doesn't hit Docker Hub unauthenticated pull rate limits (429).
	switch (language) {
		case "node":
			const needsLegacyProvider = needsOpenSSLLegacyProvider(serviceDir);
			const buildCmd = needsLegacyProvider 
				? "RUN NODE_OPTIONS=--openssl-legacy-provider npm run build --if-present"
				: "RUN npm run build --if-present";
			
			if (isNextJsApp(serviceDir)) {
				content = `
FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
${buildCmd}
ENV PORT=${port}
EXPOSE ${port}
CMD ["npm", "start"]
`.trim();
			} else {
				content = `
FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
${buildCmd}
ENV PORT=${port}
EXPOSE ${port}
CMD ["npm", "start"]
`.trim();
			}
			break;
		case "python":
			content = `
FROM public.ecr.aws/docker/library/python:3.11-slim
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
FROM public.ecr.aws/docker/library/golang:1.21-alpine AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o main .

FROM public.ecr.aws/docker/library/alpine:latest
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
FROM public.ecr.aws/docker/library/node:20-alpine
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
 * Ensures ECR repository exists. Creates first to avoid "repository does not exist" in logs.
 */
async function ensureECRRepository(
	repoName: string,
	region: string,
	ws: any
): Promise<string> {
	const send = createWebSocketLogger(ws);

	send(`Ensuring ECR repository: ${repoName}...`, 'docker');
	let createErr: unknown;
	try {
		const createOutput = await runAWSCommand([
			"ecr", "create-repository",
			"--repository-name", repoName,
			"--query", "repository.repositoryUri",
			"--output", "text",
			"--region", region
		], ws, 'docker');
		const uri = createOutput.trim();
		if (uri) {
			send(`ECR repository ${repoName} created`, 'docker');
			return uri;
		}
	} catch (err) {
		createErr = err;
		// create-repository often fails with exit 254 when repo already exists; try describe
	}
	try {
		const describeOutput = await runAWSCommand([
			"ecr", "describe-repositories",
			"--repository-names", repoName,
			"--query", "repositories[0].repositoryUri",
			"--output", "text",
			"--region", region
		], ws, 'docker');
		const uri = describeOutput.trim();
		if (uri && uri !== 'None') {
			send(`ECR repository ${repoName} already exists`, 'docker');
			return uri;
		}
	} catch {
		// describe failed; throw the original create error
	}
	throw createErr ?? new Error(`Could not get or create ECR repository ${repoName}`);
}

/**
 * Zips a directory and uploads it to S3
 */
async function zipAndUploadToS3(
	sourceDir: string,
	bucketName: string,
	key: string,
	region: string
): Promise<string> {
	return new Promise((resolve, reject) => {
		const zipPath = path.join(os.tmpdir(), `deploy-${Date.now()}.zip`);
		const output = fs.createWriteStream(zipPath);
		const archive = archiver("zip", { zlib: { level: 6 } });

		output.on("close", async () => {
			try {
				const s3Client = new S3Client({ 
					region,
					credentials: config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY ? {
						accessKeyId: config.AWS_ACCESS_KEY_ID,
						secretAccessKey: config.AWS_SECRET_ACCESS_KEY
					} : undefined
				});
				const fileContent = fs.readFileSync(zipPath);
				
				await s3Client.send(new PutObjectCommand({
					Bucket: bucketName,
					Key: key,
					Body: fileContent,
					ContentType: "application/zip"
				}));

				// Clean up local zip
				fs.unlinkSync(zipPath);
				
				resolve(`s3://${bucketName}/${key}`);
			} catch (err) {
				try {
					fs.unlinkSync(zipPath);
				} catch {
					// Ignore cleanup errors
				}
				reject(err);
			}
		});

		archive.on("error", (err: Error) => reject(err));
		output.on("error", (err: Error) => reject(err));

		archive.pipe(output);
		archive.directory(sourceDir, false);
		archive.finalize();
	});
}

/**
 * Ensures S3 bucket exists for CodeBuild source
 */
async function ensureS3Bucket(bucketName: string, region: string, ws: any): Promise<void> {
	const send = createWebSocketLogger(ws);

	try {
		await runAWSCommand([
			"s3api", "head-bucket",
			"--bucket", bucketName
		], ws, 'setup');
		send(`S3 bucket ${bucketName} already exists`, 'setup');
	} catch {
		send(`Creating S3 bucket ${bucketName}...`, 'setup');
		await runAWSCommand([
			"s3api", "create-bucket",
			"--bucket", bucketName,
			"--region", region,
			...(region !== "us-east-1" ? ["--create-bucket-configuration", `LocationConstraint=${region}`] : [])
		], ws, 'setup');
	}
}

/**
 * Ensures CodeBuild service role exists
 */
async function ensureCodeBuildRole(roleName: string, accountId: string, region: string, ws: any): Promise<string> {
	const send = createWebSocketLogger(ws);

	const iamClient = new IAMClient({ 
		region: "us-west-2", // IAM is global
		credentials: config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY ? {
			accessKeyId: config.AWS_ACCESS_KEY_ID,
			secretAccessKey: config.AWS_SECRET_ACCESS_KEY
		} : undefined
	});

	const roleExists = await iamClient
		.send(new GetRoleCommand({ RoleName: roleName }))
		.then(() => true)
		.catch(() => false);
	
	if (!roleExists) {
		send(`Creating CodeBuild role ${roleName}...`, 'setup');
		
		const trustPolicy = {
			Version: "2012-10-17",
			Statement: [{
				Effect: "Allow",
				Principal: { Service: "codebuild.amazonaws.com" },
				Action: "sts:AssumeRole"
			}]
		};

		await iamClient.send(new CreateRoleCommand({
			RoleName: roleName,
			AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
			Description: "Role for CodeBuild to build Docker images and push to ECR"
		}));
	} else {
		send(`CodeBuild role ${roleName} already exists, ensuring policies are attached...`, 'setup');
	}

	// Attach managed policies for ECR and CloudWatch Logs access (idempotent - safe to call multiple times)
	const policies = [
		"arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser",
		"arn:aws:iam::aws:policy/CloudWatchLogsFullAccess"
	];

	for (const policyArn of policies) {
		try {
			await iamClient.send(new AttachRolePolicyCommand({
				RoleName: roleName,
				PolicyArn: policyArn
			}));
		} catch (err: any) {
			// Ignore if policy already attached
			if (!err.message?.includes("already attached")) {
				throw err;
			}
		}
	}

	// Add inline policy for S3 access to CodeBuild bucket (will overwrite if exists)
	const s3Policy = {
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Action: [
					"s3:GetObject",
					"s3:PutObject"
				],
				Resource: `arn:aws:s3:::smart-deploy-codebuild-${accountId}/*`
			},
			{
				Effect: "Allow",
				Action: [
					"s3:ListBucket"
				],
				Resource: `arn:aws:s3:::smart-deploy-codebuild-${accountId}`
			}
		]
	};

	await iamClient.send(new PutRolePolicyCommand({
		RoleName: roleName,
		PolicyName: "CodeBuildS3Access",
		PolicyDocument: JSON.stringify(s3Policy)
	}));

	// Add explicit inline policy for CloudWatch Logs (helps when org/boundary quirks prevent managed policy from taking effect as expected)
	const logsPolicy = {
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Action: [
					"logs:CreateLogGroup",
					"logs:CreateLogStream",
					"logs:PutLogEvents",
					"logs:DescribeLogStreams",
					"logs:DescribeLogGroups"
				],
				Resource: "*"
			}
		]
	};

	await iamClient.send(new PutRolePolicyCommand({
		RoleName: roleName,
		PolicyName: "CodeBuildCloudWatchLogsAccess",
		PolicyDocument: JSON.stringify(logsPolicy)
	}));

	// Wait a bit for role to propagate
	await new Promise(resolve => setTimeout(resolve, 2000));
	
	return `arn:aws:iam::${accountId}:role/${roleName}`;
}

/**
 * Ensures CodeBuild project exists
 */
async function ensureCodeBuildProject(
	projectName: string,
	roleArn: string,
	region: string,
	ws: any
): Promise<void> {
	const send = createWebSocketLogger(ws);

	const codeBuildClient = new CodeBuildClient({ 
		region,
		credentials: config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY ? {
			accessKeyId: config.AWS_ACCESS_KEY_ID,
			secretAccessKey: config.AWS_SECRET_ACCESS_KEY
		} : undefined
	});

	// Buildspec lives on the project so CodeBuild runs without overrides.
	// IMPORTANT: Build with full ECR tag so `docker push` works (otherwise you must `docker tag`).
	const buildspec = `version: 0.2
phases:
  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
  build:
    commands:
      - echo Build started on $(date)
      - echo Building the Docker image...
      - docker build -t $ECR_REGISTRY/$IMAGE_REPO_NAME:$IMAGE_TAG .
  post_build:
    commands:
      - echo Build completed on $(date)
      - echo Pushing the Docker image...
      - docker push $ECR_REGISTRY/$IMAGE_REPO_NAME:$IMAGE_TAG
`;

	try {
		const response = await codeBuildClient.send(new BatchGetProjectsCommand({
			names: [projectName]
		}));
		
		if (response.projects && response.projects.length > 0) {
			console.log('CodeBuild project already exists');
			send(`CodeBuild project ${projectName} already exists`, 'setup');
			// Ensure existing project has the latest buildspec (and correct tagging for push).
			await codeBuildClient.send(new UpdateProjectCommand({
				name: projectName,
				serviceRole: roleArn,
				environment: {
					type: "LINUX_CONTAINER",
					image: "aws/codebuild/standard:7.0",
					computeType: "BUILD_GENERAL1_SMALL",
					privilegedMode: true
				},
				artifacts: { type: "NO_ARTIFACTS" },
				source: {
					type: "NO_SOURCE",
					buildspec
				} as any
			}));
			send(`CodeBuild project ${projectName} updated`, 'setup');
			return;
		}
	} catch {
		// Project doesn't exist, create it
	}

	console.log('CodeBuild project does not exist, creating it');
	send(`Creating CodeBuild project ${projectName}...`, 'setup');
	console.log('Creating CodeBuild project: ', projectName);

	await codeBuildClient.send(new CreateProjectCommand({
		name: projectName,
		description: `Build Docker images for ${projectName}`,
		serviceRole: roleArn,
		artifacts: {
			type: "NO_ARTIFACTS"
		},
		environment: {
			type: "LINUX_CONTAINER",
			image: "aws/codebuild/standard:7.0",
			computeType: "BUILD_GENERAL1_SMALL",
			privilegedMode: true
		},
		source: {
			type: "NO_SOURCE",
			buildspec: buildspec
		} as any // Type assertion needed - AWS API supports buildspec for NO_SOURCE but SDK types don't reflect this
	}));

	send(`CodeBuild project ${projectName} created`, 'setup');
}

/**
 * Builds and pushes Docker image to ECR using AWS CodeBuild (cloud-based, no local Docker required)
 */
async function buildAndPushToECR(
	serviceDir: string,
	ecrUri: string,
	imageTag: string,
	region: string,
	ws: any
): Promise<string> {
	const send = createWebSocketLogger(ws);

	const fullImageUri = `${ecrUri}:${imageTag}`;
	// ECR URI format: {accountId}.dkr.ecr.{region}.amazonaws.com/{repoName}
	const accountId = ecrUri.split('.')[0];
	const ecrRepoName = ecrUri.split('/').pop() || ecrUri.split('/')[1];

	// Setup S3 bucket for source code
	const bucketName = `smart-deploy-codebuild-${accountId}`.toLowerCase();
	send(`Ensuring S3 bucket ${bucketName} exists...`, 'docker');
	await ensureS3Bucket(bucketName, region, ws);
	console.log('S3 bucket ensured');

	// Setup CodeBuild role
	const roleName = "smart-deploy-codebuild-role";
	send(`Ensuring CodeBuild IAM role...`, 'docker');
	const roleArn = await ensureCodeBuildRole(roleName, accountId, region, ws);
	console.log('CodeBuild role ensured');
	// Setup CodeBuild project
	const projectName = `smart-deploy-${ecrRepoName}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
	console.log('CodeBuild project name: ', projectName);
	send(`Ensuring CodeBuild project ${projectName}...`, 'docker');
	await ensureCodeBuildProject(projectName, roleArn, region, ws);
	console.log('CodeBuild project ensured');
	// Zip and upload source code to S3
	send(`Packaging source code...`, 'docker');
	const s3Key = `source/${ecrRepoName}/${imageTag}.zip`;
	const s3LocationFull = await zipAndUploadToS3(serviceDir, bucketName, s3Key, region);
	send(`Source code uploaded to ${s3LocationFull}`, 'docker');
	console.log('Source code uploaded to S3');
	// CodeBuild expects format: bucket-name/key (without s3:// prefix)
	const s3LocationForCodeBuild = s3LocationFull.replace(/^s3:\/\//, '');
	console.log('S3 location for CodeBuild: ', s3LocationForCodeBuild);
	// Start CodeBuild build
	send(`Starting CodeBuild build...`, 'docker');
	const codeBuildClient = new CodeBuildClient({ 
		region,
		credentials: config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY ? {
			accessKeyId: config.AWS_ACCESS_KEY_ID,
			secretAccessKey: config.AWS_SECRET_ACCESS_KEY
		} : undefined
	});

	console.log("accountId: ", accountId);

	const buildResponse = await codeBuildClient.send(new StartBuildCommand({
		projectName,
		sourceTypeOverride: "S3",
		sourceLocationOverride: s3LocationForCodeBuild,
		environmentVariablesOverride: [
			{ name: "ECR_REGISTRY", value: `${accountId}.dkr.ecr.${region}.amazonaws.com` },
			{ name: "IMAGE_REPO_NAME", value: ecrRepoName },
			{ name: "IMAGE_TAG", value: imageTag },
			{ name: "AWS_DEFAULT_REGION", value: region }
		]
	}));
	console.log('CodeBuild build started');
	const buildId = buildResponse.build?.id;
	if (!buildId) {
		throw new Error("Failed to start CodeBuild build");
	}
	console.log('Build ID: ', buildId);
	send(`Build started: ${buildId}`, 'docker');

	// Wait for build to complete
	send(`Waiting for build to complete (this may take a few minutes)...`, 'docker');
	let buildStatus = "IN_PROGRESS";
	let lastStatus = "";
	
	while (buildStatus === "IN_PROGRESS" || buildStatus === "SUCCEEDING") {
		await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
		
		const buildsResponse = await codeBuildClient.send(new BatchGetBuildsCommand({
			ids: [buildId]
		}));

		const build = buildsResponse.builds?.[0];
		if (!build) {
			throw new Error("Build not found");
		}

		buildStatus = build.buildStatus || "IN_PROGRESS";
		
		if (buildStatus !== lastStatus) {
			send(`Build status: ${buildStatus}`, 'docker');
			lastStatus = buildStatus;
		}

		if (buildStatus === "FAILED" || buildStatus === "FAULT" || buildStatus === "TIMED_OUT" || buildStatus === "STOPPED") {
			throw new Error(`CodeBuild build failed with status: ${buildStatus}. Check AWS CodeBuild console for details.`);
		}
	}
	console.log('Build status: ', buildStatus);
	if (buildStatus !== "SUCCEEDED") {
		throw new Error(`Build did not succeed. Status: ${buildStatus}`);
	}
	console.log('Build completed successfully');
	send(`✅ Build completed successfully!`, 'docker');
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
	const send = createWebSocketLogger(ws);

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
	const send = createWebSocketLogger(ws);

	send(`Creating task definition: ${taskFamily}...`, 'deploy');

	// Ensure CloudWatch log group exists up-front.
	// Important: the default AmazonECSTaskExecutionRolePolicy allows CreateLogStream/PutLogEvents
	// but NOT CreateLogGroup. If the log group doesn't exist and we set `awslogs-create-group=true`,
	// tasks fail to start with ResourceInitializationError (AccessDenied on logs:CreateLogGroup).
	await ensureCloudWatchLogGroup(`/ecs/${taskFamily}`, region, ws);

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
					"awslogs-stream-prefix": "ecs"
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
 * Ensures a CloudWatch Logs log group exists (idempotent).
 * We do this during deploy so the ECS task execution role doesn't need logs:CreateLogGroup.
 */
async function ensureCloudWatchLogGroup(
	logGroupName: string,
	region: string,
	ws: any
): Promise<void> {
	try {
		const existing = await runAWSCommand([
			"logs",
			"describe-log-groups",
			"--log-group-name-prefix",
			logGroupName,
			"--query",
			`logGroups[?logGroupName=='${logGroupName}'].logGroupName | [0]`,
			"--output",
			"text",
			"--region",
			region
		], ws, "deploy");

		if (existing && existing.trim() === logGroupName) return;
	} catch {
		// ignore and attempt create
	}

	try {
		await runAWSCommand([
			"logs",
			"create-log-group",
			"--log-group-name",
			logGroupName,
			"--region",
			region
		], ws, "deploy");
	} catch {
		// If it already exists or we can't create it, ignore here.
		// If creation truly fails, task startup will surface logs permission issues.
	}
}

/**
 * Ensures an ALB security group exists (ingress 80 from internet).
 */
async function ensureAlbSecurityGroup(
	albSgName: string,
	vpcId: string,
	ws: any
): Promise<string> {
	const sgId = await ensureSecurityGroup(
		albSgName,
		vpcId,
		`Security group for ALB ${albSgName}`,
		ws
	);

	// Allow inbound HTTP and HTTPS from anywhere (idempotent; errors ignored)
	for (const port of [80, 443]) {
		try {
			await runAWSCommand([
				"ec2",
				"authorize-security-group-ingress",
				"--group-id",
				sgId,
				"--ip-permissions",
				`IpProtocol=tcp,FromPort=${port},ToPort=${port},IpRanges=[{CidrIp=0.0.0.0/0}]`,
			], ws, "setup");
		} catch {
			// likely already exists
		}
	}
	return sgId;
}

/**
 * Ensures an ALB exists and returns its ARN and DNS name.
 */
async function ensureAlb(
	albName: string,
	subnetIds: string[],
	albSgId: string,
	region: string,
	ws: any
): Promise<{ albArn: string; dnsName: string }> {
	// Try describe
	try {
		const albArn = (
			await runAWSCommand(
				[
					"elbv2",
					"describe-load-balancers",
					"--names",
					albName,
					"--query",
					"LoadBalancers[0].LoadBalancerArn",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();
		const dnsName = (
			await runAWSCommand(
				[
					"elbv2",
					"describe-load-balancers",
					"--names",
					albName,
					"--query",
					"LoadBalancers[0].DNSName",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();
		if (albArn && albArn !== "None") return { albArn, dnsName };
	} catch {
		// does not exist
	}

	const albArn = (
		await runAWSCommand(
			[
				"elbv2",
				"create-load-balancer",
				"--name",
				albName,
				"--type",
				"application",
				"--scheme",
				"internet-facing",
				"--subnets",
				...subnetIds,
				"--security-groups",
				albSgId,
				"--query",
				"LoadBalancers[0].LoadBalancerArn",
				"--output",
				"text",
				"--region",
				region,
			],
			ws,
			"deploy"
		)
	).trim();

	const dnsName = (
		await runAWSCommand(
			[
				"elbv2",
				"describe-load-balancers",
				"--load-balancer-arns",
				albArn,
				"--query",
				"LoadBalancers[0].DNSName",
				"--output",
				"text",
				"--region",
				region,
			],
			ws,
			"deploy"
		)
	).trim();

	return { albArn, dnsName };
}

/**
 * Ensures an HTTP listener exists on port 80.
 * When redirectToHttps is true, HTTP redirects to HTTPS (301); otherwise forwards to target group.
 */
async function ensureHttpListener(
	albArn: string,
	targetGroupArn: string,
	region: string,
	ws: any,
	opts?: { redirectToHttps?: boolean }
): Promise<void> {
	const redirectToHttps = opts?.redirectToHttps ?? false;
	try {
		// Use .ListenerArn[0] instead of | [0] so the query has no pipe (avoids shell splitting on Windows)
		const listenerArn = (
			await runAWSCommand(
				[
					"elbv2",
					"describe-listeners",
					"--load-balancer-arn",
					albArn,
					"--query",
					"Listeners[?Port==`80`].ListenerArn[0]",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();
		if (listenerArn && listenerArn !== "None") {
			if (redirectToHttps) {
				await runAWSCommand(
					[
						"elbv2",
						"modify-listener",
						"--listener-arn",
						listenerArn,
						"--default-actions",
						"Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}",
						"--region",
						region,
					],
					ws,
					"deploy"
				);
			}
			return;
		}
	} catch {
		// ignore
	}

	try {
		await runAWSCommand(
			[
				"elbv2",
				"create-listener",
				"--load-balancer-arn",
				albArn,
				"--protocol",
				"HTTP",
				"--port",
				"80",
				"--default-actions",
				redirectToHttps
					? "Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}"
					: `Type=forward,TargetGroupArn=${targetGroupArn}`,
				"--region",
				region,
			],
			ws,
			"deploy"
		);
	} catch (err: any) {
		// Listener already exists: AWS CLI returns 254 for DuplicateListener; our throw message is "exited with code 254"
		if (err?.message?.includes("DuplicateListener") || err?.message?.includes("exited with code 254")) return;
		throw err;
	}
}

/**
 * Ensures an HTTPS listener exists on port 443 with the given ACM certificate.
 * AWS ACM-issued certs are auto-renewed by AWS; no Let's Encrypt needed.
 */
async function ensureHttpsListener(
	albArn: string,
	targetGroupArn: string,
	certificateArn: string,
	region: string,
	ws: any
): Promise<void> {
	try {
		// Use .ListenerArn[0] instead of | [0] so the query has no pipe (avoids shell splitting on Windows)
		const existing = (
			await runAWSCommand(
				[
					"elbv2",
					"describe-listeners",
					"--load-balancer-arn",
					albArn,
					"--query",
					"Listeners[?Port==`443`].ListenerArn[0]",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();
		if (existing && existing !== "None") return;
	} catch {
		// ignore
	}

	try {
		await runAWSCommand(
			[
				"elbv2",
				"create-listener",
				"--load-balancer-arn",
				albArn,
				"--protocol",
				"HTTPS",
				"--port",
				"443",
				"--certificates",
				`CertificateArn=${certificateArn}`,
				"--default-actions",
				`Type=forward,TargetGroupArn=${targetGroupArn}`,
				"--region",
				region,
			],
			ws,
			"deploy"
		);
	} catch (err: any) {
		if (err?.message?.includes("DuplicateListener") || err?.message?.includes("exited with code 254")) return;
		throw err;
	}
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
	targetGroupArn: string,
	containerName: string,
	containerPort: number,
	desiredCount: number,
	region: string,
	ws: any
): Promise<string> {
	const send = createWebSocketLogger(ws);

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
			"--load-balancers", `targetGroupArn=${targetGroupArn},containerName=${containerName},containerPort=${containerPort}`,
			"--health-check-grace-period-seconds", "60",
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
			"--load-balancers", `targetGroupArn=${targetGroupArn},containerName=${containerName},containerPort=${containerPort}`,
			"--health-check-grace-period-seconds", "60",
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
): Promise<{ serviceUrls: Map<string, string>; deployedServices: string[]; sharedAlbDns?: string; details: ECSDeployDetails }> {
	const send = createWebSocketLogger(ws);

	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";
	const imageTag = `v-${Date.now()}`;

	// Setup AWS credentials
	send("Authenticating with AWS...", 'auth');
	await setupAWSCredentials(ws);

	// Reuse stored ECS details when available (redeploy), otherwise create new resources
	let clusterName: string;
	let vpcId: string;
	let subnetIds: string[];
	let securityGroupId: string;

	const existingEcs = deployConfig.ecs;
	if (existingEcs?.clusterName?.trim() && existingEcs?.vpcId?.trim() && existingEcs?.securityGroupId?.trim() && existingEcs?.subnetIds?.length) {
		clusterName = existingEcs.clusterName.trim();
		vpcId = existingEcs.vpcId.trim();
		subnetIds = existingEcs.subnetIds;
		securityGroupId = existingEcs.securityGroupId.trim();
		send("Reusing existing ECS cluster, VPC, subnet, and security group...", 'setup');
	} else {
		clusterName = generateResourceName(repoName, "cluster");
		send("Setting up networking...", 'setup');
		vpcId = await getDefaultVpcId(ws);
		subnetIds = await getSubnetIds(vpcId, ws);
		securityGroupId = await ensureSecurityGroup(
			`${repoName}-ecs-sg`,
			vpcId,
			`Security group for ${repoName} ECS services`,
			ws
		);
	}

	// Create/ensure ECS cluster
	const clusterArn = await ensureECSCluster(clusterName, region, ws);

	const serviceUrls = new Map<string, string>();
	const deployedServices: string[] = [];
	const ecsServiceNamesList: string[] = [];

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
		// For single-service Next.js apps, default the container port to 3000 instead of 8080
		// because many templates pin the port in the start script (e.g. `next start -p 3000`),
		// which ignores the PORT env variable. Using 3000 keeps ALB, target group and container aligned.
		const isSingleServiceNextJs = isNextJsApp(appDir);
		const defaultPort = isSingleServiceNextJs ? 3000 : 8080;

		services.push({
			name: repoName,
			dir: appDir,
			language: detectLanguage(appDir),
			port: deployConfig.core_deployment_info?.port || defaultPort
		});
	}

	// --- Shared ALB setup (one ALB for all services with host-based routing) ---
	const certificateArn = config.ECS_ACM_CERTIFICATE_ARN?.trim() || undefined;
	const baseDomain = config.NEXT_PUBLIC_DEPLOYMENT_DOMAIN?.trim() || undefined;
	
	let sharedAlbArn: string | undefined;
	let sharedAlbDns: string | undefined;
	let sharedAlbListenerArn: string | undefined;
	let sharedAlbSgId: string | undefined;
	
	if (certificateArn && baseDomain) {
		send('\nSetting up shared ALB with host-based routing...', 'deploy');
		const sharedAlb = await ensureSharedAlb({
			vpcId,
			subnetIds: subnetIds.slice(0, 2),
			region,
			ws,
			certificateArn
		});
		sharedAlbArn = sharedAlb.albArn;
		sharedAlbDns = sharedAlb.dnsName;
		sharedAlbListenerArn = sharedAlb.httpsListenerArn;
		sharedAlbSgId = sharedAlb.albSgId;
		send(`Shared ALB ready: ${sharedAlbDns}`, 'deploy');
	} else {
		send('\nNo shared ALB (requires ECS_ACM_CERTIFICATE_ARN and NEXT_PUBLIC_DEPLOYMENT_DOMAIN)', 'deploy');
	}

	// Deploy each service
	for (const service of services) {
		send(`\nDeploying service: ${service.name}...`, 'deploy');

		// Generate Dockerfile if needed
		generateDockerfile(service.dir, service.language, service.port);

		// ECR repo name: single service reuses repoName to avoid "repo-repo"; multi-service uses repo-service
		const isSingleService = services.length === 1 && service.name === repoName;
		const ecrRepoName = (isSingleService ? repoName : `${repoName}-${service.name}`).toLowerCase().replace(/[^a-z0-9-]/g, '-');
		const ecrUri = await ensureECRRepository(ecrRepoName, region, ws);

		// Build and push image
		const imageUri = await buildAndPushToECR(service.dir, ecrUri, imageTag, region, ws);
		console.log('Image URI: ', imageUri);
		// Prepare environment variables
		const envVars: Record<string, string> = {
			PORT: String(service.port),
			NODE_ENV: 'production'
		};
		console.log('Environment variables: ', envVars);
		// Add database connection if available
		if (dbConnectionString) {
			envVars.DATABASE_URL = dbConnectionString;
			envVars.DB_CONNECTION_STRING = dbConnectionString;
			envVars.ConnectionStrings__DefaultConnection = dbConnectionString;
		}
		console.log('Database connection string: ', dbConnectionString);
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
		console.log('Other service URLs: ', serviceUrls);
		// Add other service URLs
		for (const [svcName, url] of serviceUrls.entries()) {
			if (svcName !== service.name) {
				const envKey = `${svcName.toUpperCase().replace(/-/g, '_')}_URL`;
				envVars[envKey] = url;
			}
		}
		console.log('Environment variables: ', envVars);
		// Create task definition (single service: avoid duplicate repoName in family name)
		const taskFamily = (isSingleService ? repoName : `${repoName}-${service.name}`).toLowerCase().replace(/[^a-z0-9-]/g, '-');
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
		console.log('Task definition ARN: ', taskDefArn);

		// ECS service name (single service: use repoName-svc)
		const ecsServiceName = (isSingleService ? `${repoName}-svc` : `${repoName}-${service.name}-svc`)
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, '-');

		ecsServiceNamesList.push(ecsServiceName);

		// --- Target Group and ALB registration ---
		const tgName = `${ecsServiceName}-tg`.toLowerCase().slice(0, 32);
		let targetGroupArn: string;
		let serviceUrl: string;

		if (sharedAlbArn && sharedAlbListenerArn && baseDomain) {
			// Use shared ALB with host-based routing
			send(`Registering ${service.name} to shared ALB...`, 'deploy');
			
			// Create target group for this service
			targetGroupArn = await ensureTargetGroup(tgName, vpcId, service.port, region, ws);
			
			// Build service hostname
			const serviceHostname = buildServiceHostname(service.name, baseDomain);
			
			if (serviceHostname) {
				// Add host-based routing rule to HTTPS listener
				await ensureHostRule(sharedAlbListenerArn, serviceHostname, targetGroupArn, region, ws);
				
				// Allow shared ALB to reach service
				if (sharedAlbSgId) {
					await allowAlbToReachService(securityGroupId, sharedAlbSgId, service.port, ws);
				}
				
				// Service URL uses HTTPS with custom domain
				serviceUrl = `https://${serviceHostname}`;
				send(`Service registered: ${serviceUrl}`, 'deploy');
			} else {
				// Fallback if hostname build fails
				serviceUrl = `https://${sharedAlbDns}`;
			}
		} else {
			// Fallback: per-service ALB (when shared ALB not configured)
			send(`Creating dedicated ALB for ${service.name}...`, 'deploy');
			const albName = `${ecsServiceName}-alb`.toLowerCase().slice(0, 32);
			const albSgId = await ensureAlbSecurityGroup(`${ecsServiceName}-alb-sg`.toLowerCase().slice(0, 255), vpcId, ws);
			await allowAlbToReachService(securityGroupId, albSgId, service.port, ws);

			const { albArn, dnsName: albDns } = await ensureAlb(albName, subnetIds.slice(0, 2), albSgId, region, ws);
			targetGroupArn = await ensureTargetGroup(tgName, vpcId, service.port, region, ws);
			
			await ensureHttpListener(albArn, targetGroupArn, region, ws, {
				redirectToHttps: !!certificateArn,
			});
			
			if (certificateArn) {
				send("Adding HTTPS listener (443) to dedicated ALB...", "deploy");
				await ensureHttpsListener(albArn, targetGroupArn, certificateArn, region, ws);
			}
			
			serviceUrl = certificateArn ? `https://${albDns}` : `http://${albDns}`;
		}

		// Create/update ECS service (behind ALB)
		await createOrUpdateService(
			clusterArn,
			ecsServiceName,
			taskDefArn,
			subnetIds.slice(0, 2),
			securityGroupId,
			targetGroupArn,
			containerName,
			service.port,
			1,
			region,
			ws
		);
		console.log('ECS service created/updated: ', ecsServiceName);	
		// Wait for service to be stable
		send(`Waiting for service ${service.name} to be stable...`, 'deploy');
		await waitForServiceStable(clusterArn, ecsServiceName, region, ws);
		console.log('Service stable');
		
		console.log('Service URL: ', serviceUrl);
		serviceUrls.set(service.name, serviceUrl);
		deployedServices.push(service.name);
		console.log('Service deployed: ', service.name);
		console.log('Service deployed at: ', serviceUrl);
		send(`Service ${service.name} deployed at: ${serviceUrl}`, 'deploy');
	}
	
	console.log('All services deployed successfully');
	send(`\nAll ${deployedServices.length} services deployed successfully!`, 'done');
	
	return {
		serviceUrls,
		deployedServices,
		sharedAlbDns,
		details: {
			clusterName,
			clusterArn,
			serviceNames: ecsServiceNamesList,
			vpcId,
			subnetIds,
			securityGroupId,
		},
	};
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
	const send = createWebSocketLogger(ws);

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
