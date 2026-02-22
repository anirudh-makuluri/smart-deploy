import fs from "fs";
import os from "os";
import path from "path";
import config from "../../config";
import { DeployConfig } from "../../app/types";
import { createWebSocketLogger } from "../websocketLogger";
import { MultiServiceConfig } from "../multiServiceDetector";
import {
	runAWSCommand,
	runAWSCommandToFile,
	getDefaultVpcId,
	getSubnetIds,
	ensureSecurityGroup,
	ensureSharedAlb,
	ensureTargetGroup,
	ensureHostRule,
	registerInstanceToTargetGroup,
	allowAlbToReachService,
	buildServiceHostname,
	generateResourceName,
} from "./awsHelpers";
import {
	ensureSSMInstanceProfile,
	getInstanceState,
	buildRedeployScript,
	runRedeployViaSsm,
	SSM_PROFILE_NAME,
} from "./ec2SsmHelpers";

// ─── Types ──────────────────────────────────────────────────────────────────

type SendFn = (msg: string, stepId: string) => void;

type ServiceDef = { name: string; dir: string; port: number };

type NetworkingResult = {
	vpcId: string;
	subnetIds: string[];
	securityGroupId: string;
};

export type EC2Result = {
	success: boolean;
	baseUrl: string;
	serviceUrls: Map<string, string>;
	instanceId: string;
	publicIp: string;
	vpcId: string;
	subnetId: string;
	securityGroupId: string;
	amiId: string;
	sharedAlbDns?: string;
};

// ─── Pure helpers (env / compose / user-data) ───────────────────────────────

function parseEnvVarsAllowCommasInValues(envVarsString: string): { key: string; value: string }[] {
	const trimmed = envVarsString.trim();
	if (!trimmed) return [];
	const segments = trimmed.split(/,(?=[A-Za-z_][A-Za-z0-9_]*=)/).map(s => s.trim()).filter(Boolean);
	return segments
		.map(segment => {
			const eqIdx = segment.indexOf("=");
			if (eqIdx === -1) return null;
			const key = segment.slice(0, eqIdx).trim();
			const value = segment.slice(eqIdx + 1).trim();
			return key ? { key, value } : null;
		})
		.filter((e): e is { key: string; value: string } => e != null);
}

function buildEnvFileContent(entries: { key: string; value: string }[]): string {
	return entries
		.map(({ key, value }) => {
			if (/[\n"\\]/.test(value)) {
				const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
				return `${key}="${escaped}"`;
			}
			return `${key}=${value}`;
		})
		.join("\n");
}

function normalizeDomain(input?: string): string {
	const raw = (input || "").trim();
	if (!raw) return "";
	try {
		return new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname;
	} catch {
		return raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
	}
}

/**
 * Generates Dockerfile content based on deployConfig
 */
function generateDockerfileContent(
	deployConfig: DeployConfig,
	serviceDir: string = "."
): string {
	// Use custom Dockerfile if provided
	if (deployConfig.dockerfileContent) {
		return deployConfig.dockerfileContent;
	}

	const coreInfo = deployConfig.core_deployment_info;
	const language = (coreInfo?.language || "node").toLowerCase();
	const workdir = coreInfo?.workdir || (serviceDir === "." ? "/app" : `/app/${serviceDir}`);
	const port = coreInfo?.port || 8080;
	const installCmd = coreInfo?.install_cmd || "";
	const buildCmd = coreInfo?.build_cmd || "";
	const runCmd = coreInfo?.run_cmd || "";

	let dockerfileContent = "";

	switch (language) {
		case "node":
		case "javascript":
		case "typescript":
			dockerfileContent = `
FROM node:20-alpine
WORKDIR ${workdir}
COPY package*.json ./
RUN ${installCmd || "npm ci --production=false"}
COPY . .
${buildCmd ? `RUN ${buildCmd}` : "RUN npm run build --if-present || true"}
ENV PORT=${port}
EXPOSE ${port}
CMD ${JSON.stringify(runCmd ? runCmd.split(" ") : ["npm", "start"])}
			`.trim();
			break;

		case "python":
			dockerfileContent = `
FROM python:3.11-slim
WORKDIR ${workdir}
COPY requirements.txt* ./
RUN ${installCmd || "pip install --no-cache-dir -r requirements.txt || pip install --no-cache-dir -r requirements.txt || true"}
COPY . .
${buildCmd ? `RUN ${buildCmd}` : ""}
ENV PORT=${port}
EXPOSE ${port}
CMD ${JSON.stringify(runCmd ? runCmd.split(" ") : ["python", "app.py"])}
			`.trim();
			break;

		case "go":
		case "golang":
			dockerfileContent = `
FROM golang:1.21-alpine AS builder
WORKDIR ${workdir}
COPY go.* ./
RUN ${installCmd || "go mod download"}
COPY . .
${buildCmd ? `RUN ${buildCmd}` : "RUN CGO_ENABLED=0 go build -o main ."}

FROM alpine:latest
WORKDIR /app
RUN apk --no-cache add ca-certificates
COPY --from=builder ${workdir}/main .
ENV PORT=${port}
EXPOSE ${port}
CMD ${JSON.stringify(runCmd ? runCmd.split(" ") : ["./main"])}
			`.trim();
			break;

		case "java":
			dockerfileContent = `
FROM openjdk:17-alpine
WORKDIR ${workdir}
COPY . .
RUN ${installCmd || "./mvnw install || mvn install || true"}
${buildCmd ? `RUN ${buildCmd}` : "RUN ./mvnw package || mvn package || true"}
ENV PORT=${port}
EXPOSE ${port}
CMD ${JSON.stringify(runCmd ? runCmd.split(" ") : ["java", "-jar", "target/app.jar"])}
			`.trim();
			break;

		case "rust":
			dockerfileContent = `
FROM rust:1.70-alpine AS builder
WORKDIR ${workdir}
COPY Cargo.* ./
RUN cargo fetch
COPY . .
${buildCmd ? `RUN ${buildCmd}` : "RUN cargo build --release"}

FROM alpine:latest
WORKDIR /app
RUN apk --no-cache add ca-certificates
COPY --from=builder ${workdir}/target/release/app .
ENV PORT=${port}
EXPOSE ${port}
CMD ${JSON.stringify(runCmd ? runCmd.split(" ") : ["./app"])}
			`.trim();
			break;

		case "dotnet":
		case "csharp":
			dockerfileContent = `
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR ${workdir}
COPY *.csproj ./
RUN ${installCmd || "dotnet restore"}
COPY . .
${buildCmd ? `RUN ${buildCmd}` : "RUN dotnet build -c Release"}
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/publish .
ENV PORT=${port}
EXPOSE ${port}
CMD ${JSON.stringify(runCmd ? runCmd.split(" ") : ["dotnet", "*.dll"])}
			`.trim();
			break;

		default:
			// Default to Node.js
			dockerfileContent = `
FROM node:20-alpine
WORKDIR ${workdir}
COPY package*.json ./
RUN npm install
COPY . .
ENV PORT=${port}
EXPOSE ${port}
CMD ["npm", "start"]
			`.trim();
	}

	return dockerfileContent;
}

function buildComposeAndEnv(
	services: ServiceDef[],
	envVars: string,
	dbConnectionString?: string,
	customDomain?: string,
): { composeYml: string; envBase64: string } {
	const composeServices: Record<string, unknown> = {};
	for (const svc of services) {
		const p = svc.port || 8080;
		const env: string[] = [`PORT=${p}`, "NODE_ENV=production"];
		if (dbConnectionString) env.push(`DATABASE_URL=${dbConnectionString}`);
		composeServices[svc.name] = {
			build: { context: svc.dir === "." ? "." : `./${svc.dir}`, dockerfile: "Dockerfile" },
			ports: [`${p}:${p}`],
			environment: env,
			restart: "unless-stopped",
		};
	}
	const composeYml = JSON.stringify({ version: "3.8", services: composeServices }, null, 2);

	const envEntries = parseEnvVarsAllowCommasInValues(envVars);
	const host = normalizeDomain(customDomain);
	if (host) {
		envEntries.push({ key: "NEXT_PUBLIC_WS_URL", value: `wss://${host}/ws` });
		envEntries.push({ key: "NEXTAUTH_URL", value: `https://${host}` });
	}
	if (dbConnectionString) envEntries.push({ key: "DATABASE_URL", value: dbConnectionString });
	const raw = buildEnvFileContent(envEntries);
	return { composeYml, envBase64: raw ? Buffer.from(raw, "utf8").toString("base64") : "" };
}

function generateUserDataScript(
	deployConfig: DeployConfig,
	repoUrl: string,
	branch: string,
	token: string,
	services: ServiceDef[],
	envVars: string,
	dbConnectionString?: string,
	commitSha?: string,
	customDomain?: string,
): string {
	const authUrl = repoUrl.replace("https://", `https://${token}@`);
	const { composeYml, envBase64 } = buildComposeAndEnv(services, envVars, dbConnectionString, customDomain);
	let mainPort = "";
	let wsPort = "";
	const ports: string[] = [];
	const serviceDirs = services.map(s => s.dir === "." ? "." : `./${s.dir}`).join(" ");
	
	// Generate Dockerfile content for each service
	const dockerfileContents: Record<string, string> = {};
	for (const svc of services) {
		dockerfileContents[svc.dir] = generateDockerfileContent(deployConfig, svc.dir);
	}
	
	for (const svc of services) {
		const p = svc.port || 8080;
		ports.push(String(p));
		if (svc.name.toLowerCase().includes("websocket")) wsPort = String(p);
		else if (!mainPort) mainPort = String(p);
	}

	return `#!/bin/bash
# Use set -e but trap errors to ensure we always output completion signal
set -e
trap 'EXIT_CODE=$?; echo "Script error at line $LINENO, exit code $EXIT_CODE"; exit $EXIT_CODE' ERR

# Clean up cloud-init logs and temp files immediately to free space
# (cloud-init may have failed due to disk space, leaving temp files behind)
rm -rf /var/lib/cloud/data/tmp_* 2>/dev/null || true
rm -rf /var/lib/cloud/instances/*/sem/* 2>/dev/null || true
find /tmp -type f -mtime +0 -delete 2>/dev/null || true

# Log disk space at start
echo "=== Initial disk space ==="
df -h /
echo "=========================="

# Install essential packages first (skip full update to save space)
yum install -y docker git

# Clean up yum cache immediately to free space
yum clean all
rm -rf /var/cache/yum/*

# Check disk space before creating swap
AVAILABLE=$(df / | tail -1 | awk '{print $4}')
AVAILABLE_MB=$((AVAILABLE / 1024))
echo "Available disk space: $AVAILABLE_MB MB"

# Create swap file only if we have enough space (use 1GB instead of 2GB to be safer)
if [ $AVAILABLE_MB -gt 1200 ]; then
    echo "Creating 1GB swap file..."
    dd if=/dev/zero of=/swapfile bs=1M count=1024
    chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
    echo "Warning: Insufficient space for swap file (need ~1200MB, have $AVAILABLE_MB MB)"
fi

# Start Docker and configure
systemctl start docker && systemctl enable docker

# Configure Docker to clean up unused resources automatically
cat > /etc/docker/daemon.json << 'DOCKEREOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
DOCKEREOF
systemctl restart docker

# Install docker-compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose

# Install docker buildx
mkdir -p /usr/libexec/docker/cli-plugins /root/.docker/cli-plugins
curl -sSL "https://github.com/docker/buildx/releases/download/v0.19.3/buildx-v0.19.3.linux-amd64" -o /usr/libexec/docker/cli-plugins/docker-buildx
chmod +x /usr/libexec/docker/cli-plugins/docker-buildx
cp /usr/libexec/docker/cli-plugins/docker-buildx /root/.docker/cli-plugins/docker-buildx

# Clean up any existing Docker images/containers to free space
docker system prune -af --volumes 2>/dev/null || true

echo "=== Disk space before clone ==="
df -h /
echo "==============================="

# Clone repository
cd /home/ec2-user
git clone -b ${branch} ${authUrl} app && cd app
${commitSha ? `git checkout ${commitSha}` : ""}

# Clean up git history to save space (keep only current commit)
git gc --aggressive --prune=now || true

${envBase64 ? `echo '${envBase64}' | base64 -d > .env` : "touch .env"}

# Check if repo has its own docker-compose.yml
if [ -f docker-compose.yml ]; then
    echo "Using existing docker-compose.yml from repository"
    # Validate docker-compose.yml syntax
    if ! docker-compose config > /dev/null 2>&1; then
        echo "ERROR: Invalid docker-compose.yml syntax"
        docker-compose config
        exit 1
    fi
    echo "docker-compose.yml syntax is valid"
else
    echo "No docker-compose.yml found. Creating Dockerfiles and docker-compose.yml..."
    
    # Create Dockerfiles if they don't exist
    echo "Creating Dockerfiles..."
    ${services.map(svc => {
		const dir = svc.dir === "." ? "." : svc.dir;
		const dockerfilePath = dir === "." ? "Dockerfile" : `${dir}/Dockerfile`;
		const dockerfileContent = dockerfileContents[svc.dir];
		// Escape for bash heredoc - need to escape $ and backticks
		const escapedContent = dockerfileContent
			.replace(/\\/g, '\\\\')
			.replace(/\$/g, '\\$')
			.replace(/`/g, '\\`');
		return `
if [ ! -f ${dockerfilePath} ]; then
    echo "Creating Dockerfile at ${dockerfilePath}..."
    mkdir -p ${dir === "." ? "." : dir}
    cat > ${dockerfilePath} << 'DOCKERFILEEOF'
${escapedContent}
DOCKERFILEEOF
    echo "✅ Dockerfile created at ${dockerfilePath}"
else
    echo "Dockerfile already exists at ${dockerfilePath}, skipping creation"
fi
`;
	}).join("\n")}
    
    # Create docker-compose.yml
    echo "Creating docker-compose.yml..."
    cat > docker-compose.yml << 'COMPOSEEOF'
${composeYml}
COMPOSEEOF
    echo "✅ docker-compose.yml created"
fi

echo "=== Disk space before build ==="
df -h /
echo "==============================="

# Build and start containers (critical step - if this fails, deployment failed)
echo "Building and starting containers..."
if ! docker-compose up -d --build 2>&1 | tee /tmp/docker-build.log; then
    echo "ERROR: docker-compose up failed"
    echo "=== Docker-compose configuration ==="
    docker-compose config || true
    echo "=== Build log ==="
    cat /tmp/docker-build.log || true
    echo "=== Available Dockerfiles ==="
    find . -name "Dockerfile" -type f || echo "No Dockerfiles found"
    echo "=== Directory structure ==="
    ls -la
    echo "=== Service directories ==="
    ls -la */ 2>/dev/null || echo "No subdirectories found"
    exit 1
fi

# Clean up Docker build cache and unused images after build
docker system prune -af --volumes 2>/dev/null || true

echo "=== Disk space after build ==="
df -h /
echo "=============================="

# Install and configure nginx
yum install -y nginx && systemctl start nginx && systemctl enable nginx

# Clean up yum cache again after nginx install
yum clean all

sed -i 's/^[[:space:]]*server_name[[:space:]]\\+_;$/# &/' /etc/nginx/nginx.conf
sed -i 's/^[[:space:]]*listen[[:space:]]\\+80\\(.*default_server.*\\)\\?;$/# &/' /etc/nginx/nginx.conf
sed -i 's/^[[:space:]]*listen[[:space:]]\\+\\[::]\\:80\\(.*default_server.*\\)\\?;$/# &/' /etc/nginx/nginx.conf
cat > /etc/nginx/conf.d/upgrade-map.conf << 'NGINXEOF'
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
NGINXEOF
cat > /etc/nginx/conf.d/app.conf << 'NGINXEOF'
server {
    listen 80 default_server;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:${mainPort || 8080};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
${wsPort ? `    location /ws {
        proxy_pass http://127.0.0.1:${wsPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }` : ""}
}
NGINXEOF
rm -f /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/00-default.conf /etc/nginx/conf.d/ssl.conf 2>/dev/null || true

# Test and reload nginx (critical step)
if ! nginx -t; then
    echo "ERROR: nginx configuration test failed"
    cat /etc/nginx/conf.d/app.conf || true
    exit 1
fi

if ! systemctl reload nginx; then
    echo "ERROR: nginx reload failed"
    systemctl status nginx || true
    exit 1
fi

echo "=== Final disk space ==="
df -h /
echo "========================"

# Verify containers are running
if docker-compose ps | grep -q "Up"; then
    echo "====================================== Deployment complete! ======================================"
else
    echo "WARNING: Some containers may not be running"
    docker-compose ps || true
    echo "====================================== Deployment complete! ======================================"
fi
`;
}

function sanitizeConsoleOutput(raw: string): string {
	return raw
		.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
		.replace(/\x1b\][^\x07]*\x07/g, "")
		.replace(/\x1b[()][AB012]/g, "")
		.replace(/\x1b[^[\]()a-zA-Z]?[a-zA-Z]/g, "")
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
		// Remove Unicode arrow characters and other symbols that cause Windows encoding issues
		.replace(/[\u2190-\u21FF]/g, "") // Arrows
		.replace(/[\u2600-\u26FF]/g, "") // Miscellaneous symbols
		.replace(/[\u2700-\u27BF]/g, "") // Dingbats
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\n{3,}/g, "\n\n");
}

// ─── Focused async functions ────────────────────────────────────────────────

/** Sets up VPC, subnets, security group, and opens ingress ports. */
async function ensureNetworking(
	deployConfig: DeployConfig,
	repoName: string,
	region: string,
	services: ServiceDef[],
	multiServiceConfig: MultiServiceConfig,
	ws: any,
	send: SendFn,
): Promise<NetworkingResult> {
	let vpcId: string;
	let subnetIds: string[];
	let securityGroupId: string;

	if (deployConfig.ec2?.vpcId?.trim() && deployConfig.ec2?.subnetId?.trim() && deployConfig.ec2?.securityGroupId?.trim()) {
		vpcId = deployConfig.ec2.vpcId.trim();
		subnetIds = [deployConfig.ec2.subnetId.trim()];
		securityGroupId = deployConfig.ec2.securityGroupId.trim();
		send("Reusing existing VPC, subnet, and security group...", "setup");
	} else {
		send("Setting up networking...", "setup");
		vpcId = await getDefaultVpcId(ws);
		subnetIds = await getSubnetIds(vpcId, ws);
		securityGroupId = await ensureSecurityGroup(`${repoName}-ec2-sg`, vpcId, `Security group for ${repoName} EC2 instance`, ws);
	}

	const ports = new Set<number>([22, 80, 443, 8080, 3000, 5000]);
	if (deployConfig.core_deployment_info?.port) ports.add(deployConfig.core_deployment_info.port);
	for (const svc of services) if (typeof svc.port === "number" && !Number.isNaN(svc.port)) ports.add(svc.port);
	if (multiServiceConfig.isMultiService) {
		for (const svc of multiServiceConfig.services) if (typeof svc.port === "number") ports.add(svc.port);
	}
	for (const port of ports) {
		try {
			await runAWSCommand(["ec2", "authorize-security-group-ingress", "--group-id", securityGroupId, "--protocol", "tcp", "--port", String(port), "--cidr", "0.0.0.0/0", "--region", region], ws, "setup");
		} catch { /* rule may already exist */ }
	}

	return { vpcId, subnetIds, securityGroupId };
}

/** Redeploys to an existing running instance via SSM. */
async function redeployInstance(params: {
	deployConfig: DeployConfig;
	existingInstanceId: string;
	region: string;
	services: ServiceDef[];
	repoName: string;
	token: string;
	composeYml: string;
	envBase64: string;
	net: NetworkingResult;
	amiId: string;
	certificateArn: string;
	sharedAlbEnabled: boolean;
	ws: any;
	send: SendFn;
}): Promise<EC2Result> {
	const { deployConfig, existingInstanceId, region, services, repoName, token, composeYml, envBase64, net, amiId, certificateArn, sharedAlbEnabled, ws, send } = params;

	send("Reusing existing instance (SSM redeploy)...", "deploy");
	const script = buildRedeployScript({
		repoUrl: deployConfig.url,
		branch: deployConfig.branch || "main",
		token,
		commitSha: deployConfig.commitSha,
		envFileContentBase64: envBase64,
		dockerComposeYml: composeYml,
		deployConfig,
		services: services.map(s => ({ dir: s.dir, port: s.port })),
	});
	const { success } = await runRedeployViaSsm({ instanceId: existingInstanceId, region, script, send });

	if (!success) {
		send("Redeploy command failed. Check logs above.", "deploy");
		return {
			success: false,
			baseUrl: deployConfig.deployUrl || deployConfig.ec2?.baseUrl || "",
			serviceUrls: new Map(),
			instanceId: existingInstanceId,
			publicIp: deployConfig.ec2?.publicIp || "",
			...net, subnetId: net.subnetIds[0], amiId,
		};
	}

	const publicIp = deployConfig.ec2?.publicIp?.trim() || (
		await runAWSCommand(["ec2", "describe-instances", "--instance-ids", existingInstanceId, "--query", "Reservations[0].Instances[0].PublicIpAddress", "--output", "text", "--region", region], ws, "deploy")
	).trim();

	const { baseUrl, serviceUrls } = buildServiceUrls(deployConfig, services, repoName, publicIp, certificateArn, sharedAlbEnabled);
	send("Redeploy complete.", "done");
	send(`Application URL: ${baseUrl}`, "done");
	return { success: true, baseUrl, serviceUrls, instanceId: existingInstanceId, publicIp, ...net, subnetId: net.subnetIds[0], amiId };
}

/** Launches a brand-new EC2 instance, waits for user-data to finish, and detects a healthy port. */
async function launchNewInstance(params: {
	deployConfig: DeployConfig;
	instanceName: string;
	region: string;
	services: ServiceDef[];
	token: string;
	dbConnectionString: string | undefined;
	net: NetworkingResult;
	amiId: string;
	sharedAlbEnabled: boolean;
	ws: any;
	send: SendFn;
}): Promise<{ instanceId: string; publicIp: string; detectedPort: number }> {
	const { deployConfig, instanceName, region, services, token, dbConnectionString, net, amiId, sharedAlbEnabled, ws, send } = params;
	const keyName = "smartdeploy";

	await ensureSSMInstanceProfile(region, ws);
	await ensureKeyPair(keyName, region, ws);

	const userData = generateUserDataScript(
		deployConfig,
		deployConfig.url,
		deployConfig.branch || "main",
		token,
		services,
		deployConfig.env_vars || "",
		dbConnectionString,
		deployConfig.commitSha,
		sharedAlbEnabled ? undefined : deployConfig.custom_url,
	);
	const b64 = Buffer.from(userData).toString("base64");
	const tmpFile = path.join(os.tmpdir(), `ec2-userdata-${Date.now()}.b64`);
	fs.writeFileSync(tmpFile, b64, "utf8");
	const fileUri = "fileb://" + path.resolve(tmpFile).replace(/\\/g, "/");

	let instanceId: string;
	try {
		send(`Launching EC2 instance: ${instanceName}...`, "deploy");
		// Increase root EBS volume to 20GB (default is 8GB which is too small for Docker builds)
		const blockDeviceMapping = `DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}`;
		const out = await runAWSCommand([
			"ec2", "run-instances",
			"--image-id", amiId,
			"--instance-type", "t3.micro",
			"--key-name", keyName,
			"--security-group-ids", net.securityGroupId,
			"--subnet-id", net.subnetIds[0],
			"--user-data", fileUri,
			"--iam-instance-profile", `Name=${SSM_PROFILE_NAME}`,
			"--block-device-mappings", blockDeviceMapping,
			"--tag-specifications", `ResourceType=instance,Tags=[{Key=Name,Value=${instanceName}},{Key=Project,Value=SmartDeploy}]`,
			"--query", "Instances[0].InstanceId",
			"--output", "text",
			"--region", region,
		], ws, "deploy");
		instanceId = out.trim();
		send(`Instance launched: ${instanceId} (20GB EBS volume)`, "deploy");
	} finally {
		try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
	}

	send("Waiting for instance to be running...", "deploy");
	await runAWSCommand(["ec2", "wait", "instance-running", "--instance-ids", instanceId, "--region", region], ws, "deploy");

	const publicIp = (await runAWSCommand(["ec2", "describe-instances", "--instance-ids", instanceId, "--query", "Reservations[0].Instances[0].PublicIpAddress", "--output", "text", "--region", region], ws, "deploy")).trim();
	send(`Instance public IP: ${publicIp}`, "deploy");

	await waitForUserData(instanceId, region, ws, send);
	const detectedPort = await detectRespondingPort(publicIp, services, ws, send);

	if (!detectedPort) {
		send("❌ Instance failed to respond on any known ports.", "deploy");
		try { await terminateInstance(instanceId, region, ws); } catch { /* ignore */ }
		throw new Error("Instance failed to respond on any known ports");
	}

	return { instanceId, publicIp, detectedPort };
}

/** Configures the shared ALB for a new instance (target group, listener rules, host routing). */
async function configureAlb(params: {
	deployConfig: DeployConfig;
	instanceId: string;
	existingInstanceId: string | undefined;
	services: ServiceDef[];
	repoName: string;
	net: NetworkingResult;
	region: string;
	certificateArn: string;
	ws: any;
	send: SendFn;
}): Promise<{ sharedAlbDns: string; serviceUrls: Map<string, string> }> {
	const { deployConfig, instanceId, existingInstanceId, services, repoName, net, region, certificateArn, ws, send } = params;

	send("Configuring shared ALB routing...", "deploy");
	const alb = await ensureSharedAlb({ vpcId: net.vpcId, subnetIds: net.subnetIds.slice(0, 2), region, ws, certificateArn });
	const listenerArn = alb.httpsListenerArn || alb.httpListenerArn;
	const customHost = normalizeDomain(deployConfig.custom_url);

	await allowAlbToReachService(net.securityGroupId, alb.albSgId, 80, ws);

	const tgName = `${repoName}-tg`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "smartdeploy-tg";
	const tgArn = await ensureTargetGroup(tgName, net.vpcId, 80, region, ws, { targetType: "instance", healthCheckPath: "/" });

	if (existingInstanceId) {
		try {
			await runAWSCommand(["elbv2", "deregister-targets", "--target-group-arn", tgArn, "--targets", `Id=${existingInstanceId},Port=80`, "--region", region], ws, "deploy");
		} catch { /* may not be registered */ }
	}
	await registerInstanceToTargetGroup(tgArn, instanceId, 80, region, ws);

	const serviceUrls = new Map<string, string>();
	for (const svc of services) {
		const sub = services.length === 1 && deployConfig.service_name?.trim() ? deployConfig.service_name.trim() : svc.name;
		const hostname = customHost || buildServiceHostname(svc.name, sub);
		if (hostname) await ensureHostRule(listenerArn, hostname, tgArn, region, ws);
		const url = hostname ? `${certificateArn ? "https" : "http"}://${hostname}` : `${certificateArn ? "https" : "http"}://${alb.dnsName}`;
		serviceUrls.set(svc.name, url);
	}

	return { sharedAlbDns: alb.dnsName, serviceUrls };
}

// ─── Small helpers used by the main functions ───────────────────────────────

async function ensureKeyPair(keyName: string, region: string, ws: any): Promise<void> {
	const send = createWebSocketLogger(ws);
	try {
		await runAWSCommand(["ec2", "describe-key-pairs", "--key-names", keyName, "--region", region], ws, "setup");
		send(`Key pair ${keyName} already exists`, "setup");
	} catch {
		send(`Creating key pair: ${keyName}...`, "setup");
		await runAWSCommand(["ec2", "create-key-pair", "--key-name", keyName, "--query", "KeyMaterial", "--output", "text", "--region", region], ws, "setup");
	}
}

async function getLatestAMI(region: string, ws: any): Promise<string> {
	const q = "sort_by(Images, &CreationDate)[-1].ImageId";
	const qArg = process.platform === "win32" ? `--query="${q}"` : `--query=${q}`;
	return (await runAWSCommand(["ec2", "describe-images", "--owners", "amazon", "--filters", "Name=name,Values=al2023-ami-*-x86_64", "Name=state,Values=available", qArg, "--output", "text", `--region=${region}`], ws, "setup")).trim();
}

async function terminateInstance(instanceId: string, region: string, ws: any): Promise<void> {
	const send = createWebSocketLogger(ws);
	const state = (await runAWSCommand(["ec2", "describe-instances", "--instance-ids", instanceId, "--query", "Reservations[0].Instances[0].State.Name", "--output", "text", "--region", region], ws, "deploy")).trim();
	if (state && state !== "None" && state !== "terminated") {
		send(`Terminating instance ${instanceId} (${state})...`, "deploy");
		await runAWSCommand(["ec2", "terminate-instances", "--instance-ids", instanceId, "--region", region], ws, "deploy");
	}
}

async function waitForUserData(instanceId: string, region: string, ws: any, send: SendFn): Promise<void> {
	send("Waiting for user-data to finish (this may take 5+ minutes)...", "deploy");
	await new Promise(r => setTimeout(r, 90_000));
	let lastLen = 0;
	let consecutiveErrors = 0;
	let encodingErrorShown = false;
	let cloudInitFailureDetected = false;
	for (let i = 1; i <= 24; i++) {
		send(`Fetching instance system logs (${i}/24)...`, "deploy");
		try {
			const raw = await runAWSCommandToFile(["ec2", "get-console-output", "--instance-id", instanceId, "--latest", "--output", "text", "--region", region], ws, "deploy");
			console.log(raw);
			consecutiveErrors = 0; // Reset error counter on success
			if (raw?.trim()) {
				const clean = sanitizeConsoleOutput(raw);
				
				// Check for cloud-init failures
				if (!cloudInitFailureDetected) {
					const failurePatterns = [
						/Failed to start.*cloud-final/i,
						/cloud-init.*failed/i,
						/cloud-final.*failed/i,
						/Error.*cloud-init/i,
					];
					for (const pattern of failurePatterns) {
						if (pattern.test(clean)) {
							cloudInitFailureDetected = true;
							send("⚠️ Warning: Cloud-init failure detected. User-data script may have failed. Checking if application is running anyway...", "deploy");
							break;
						}
					}
				}
				
				if (clean.length > lastLen) {
					const lines = clean.substring(lastLen).trim().split(/\n/).filter(l => l.trim());
					if (lines.length) send((lines.length > 30 ? lines.slice(-30) : lines).join("\n"), "deploy");
					lastLen = clean.length;
				}
				
				// Check for success signal
				if (clean.includes("Deployment complete!")) {
					if (cloudInitFailureDetected) {
						send("✅ User-data script completed despite cloud-init warnings.", "deploy");
					} else {
						send("Instance user-data finished.", "deploy");
					}
					return;
				}
				
				// If cloud-init finished but we haven't seen "Deployment complete!", wait a bit more
				if (clean.includes("Cloud-init v.") && clean.includes("finished") && i >= 12) {
					send("Cloud-init finished. Checking if deployment completed...", "deploy");
					// Give it a few more attempts to see if deployment completed
					if (i >= 18) {
						send("Cloud-init finished but no deployment completion signal found. Proceeding to check application status...", "deploy");
						return;
					}
				}
			}
		} catch (e: any) {
			consecutiveErrors++;
			const errorMsg = e.message ?? String(e);
			const sanitized = sanitizeConsoleOutput(errorMsg.replace(/[\u2190-\u21FF\u2600-\u26FF\u2700-\u27BF]/g, ""));
			
			if (errorMsg.includes("charmap") || errorMsg.includes("codec") || errorMsg.includes("encode")) {
				if (!encodingErrorShown) {
					send(`Note: Console output encoding issue detected (Windows compatibility). Continuing...`, "deploy");
					encodingErrorShown = true;
				}
				consecutiveErrors = Math.max(0, consecutiveErrors - 1);
			} else {
				send(`Error fetching console: ${sanitized}`, "deploy");
			}
			
			if (consecutiveErrors >= 5) {
				send("Too many consecutive errors fetching console output. Continuing deployment...", "deploy");
				break;
			}
		}
		await new Promise(r => setTimeout(r, 15_000));
	}
	
	if (cloudInitFailureDetected) {
		send("⚠️ Cloud-init failure was detected. Proceeding to check if application is running despite the failure...", "deploy");
	}
}

async function detectRespondingPort(publicIp: string, services: ServiceDef[], ws: any, send: SendFn): Promise<number | null> {
	try {
		const { runCommandLiveWithWebSocket } = await import("../../server-helper");
		const devNull = process.platform === "win32" ? "NUL" : "/dev/null";
		const candidates = Array.from(new Set([80, 8080, 3000, 5000, ...services.map(s => s.port).filter(Boolean)]));
		for (const port of candidates) {
			try {
				const code = (await runCommandLiveWithWebSocket("curl", ["-s", "-o", devNull, "-w", "%{http_code}", "--connect-timeout", "4", `http://${publicIp}:${port}`], ws, "deploy")).trim();
				if (code && code !== "000" && (code.startsWith("2") || code.startsWith("3"))) {
					send(`✅ Detected responding port ${port} (HTTP ${code})`, "deploy");
					return port;
				}
			} catch { /* try next */ }
		}
	} catch { /* curl unavailable */ }
	return null;
}

function buildServiceUrls(
	deployConfig: DeployConfig,
	services: ServiceDef[],
	repoName: string,
	publicIp: string,
	certificateArn: string,
	sharedAlbEnabled: boolean,
): { baseUrl: string; serviceUrls: Map<string, string> } {
	const serviceUrls = new Map<string, string>();
	let baseUrl: string;
	if (sharedAlbEnabled && deployConfig.service_name) {
		const host = buildServiceHostname(deployConfig.service_name, deployConfig.service_name);
		baseUrl = host ? `${certificateArn ? "https" : "http"}://${host}` : deployConfig.ec2?.baseUrl || `http://${publicIp}`;
		serviceUrls.set(services[0]?.name || repoName, baseUrl);
	} else {
		baseUrl = deployConfig.ec2?.baseUrl || `http://${publicIp}`;
		for (const svc of services) serviceUrls.set(svc.name, baseUrl);
	}
	return { baseUrl, serviceUrls };
}

function resolveServices(repoName: string, deployConfig: DeployConfig, multi: MultiServiceConfig): ServiceDef[] {
	if (multi.isMultiService && multi.services.length > 0) {
		return multi.services.map(s => ({ name: s.name, dir: s.workdir, port: s.port || 8080 }));
	}
	return [{ name: repoName, dir: ".", port: deployConfig.core_deployment_info?.port || 8080 }];
}

// ─── Main entry point ───────────────────────────────────────────────────────

export async function handleEC2(
	deployConfig: DeployConfig,
	appDir: string,
	multiServiceConfig: MultiServiceConfig,
	token: string,
	dbConnectionString: string | undefined,
	ws: any,
	parentSend?: SendFn,
): Promise<EC2Result> {
	const send: SendFn = parentSend || createWebSocketLogger(ws);
	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";
	const certificateArn = config.ECS_ACM_CERTIFICATE_ARN?.trim() || "";
	const sharedAlbEnabled = !!certificateArn && !!buildServiceHostname("app");
	const existingInstanceId = deployConfig.ec2?.instanceId?.trim();

	const services = resolveServices(repoName, deployConfig, multiServiceConfig);
	const net = await ensureNetworking(deployConfig, repoName, region, services, multiServiceConfig, ws, send);
	const amiId = deployConfig.ec2?.amiId?.trim() || await getLatestAMI(region, ws);
	const customDomain = sharedAlbEnabled ? undefined : deployConfig.custom_url;
	const { composeYml, envBase64 } = buildComposeAndEnv(services, deployConfig.env_vars || "", dbConnectionString, customDomain);

	// ── Redeploy path: reuse existing running instance via SSM ──
	if (existingInstanceId) {
		const state = await getInstanceState(existingInstanceId, region, ws);
		if (state === "running") {
			return redeployInstance({
				deployConfig, existingInstanceId, region, services, repoName, token,
				composeYml, envBase64, net, amiId, certificateArn, sharedAlbEnabled, ws, send,
			});
		}
	}

	// ── Fresh deploy path: launch new instance ──
	const instanceName = generateResourceName(repoName, "ec2");
	const { instanceId, publicIp, detectedPort } = await launchNewInstance({
		deployConfig, instanceName, region, services, token, dbConnectionString,
		net, amiId, sharedAlbEnabled, ws, send,
	});

	let baseUrl = detectedPort === 80 || detectedPort === 8080 ? `http://${publicIp}` : `http://${publicIp}:${detectedPort}`;
	let serviceUrls = new Map<string, string>();
	let sharedAlbDns: string | undefined;

	if (sharedAlbEnabled) {
		const alb = await configureAlb({
			deployConfig, instanceId, existingInstanceId, services, repoName, net, region, certificateArn, ws, send,
		});
		sharedAlbDns = alb.sharedAlbDns;
		serviceUrls = alb.serviceUrls;
		if (services.length === 1) baseUrl = serviceUrls.get(services[0].name) || baseUrl;
	} else {
		for (const svc of services) {
			serviceUrls.set(svc.name, services.length === 1 ? baseUrl : `http://${publicIp}:${svc.port}`);
		}
	}

	send("✅ Instance is responding and configured!", "deploy");
	send(`Application URL: ${baseUrl}`, "done");
	send(`Instance ID: ${instanceId}`, "done");

	return { success: true, baseUrl, serviceUrls, instanceId, publicIp, vpcId: net.vpcId, subnetId: net.subnetIds[0], securityGroupId: net.securityGroupId, amiId, sharedAlbDns };
}
