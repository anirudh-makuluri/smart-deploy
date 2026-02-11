import fs from "fs";
import os from "os";
import path from "path";
import config from "../../config";
import { DeployConfig } from "../../app/types";
import { MultiServiceConfig } from "../multiServiceDetector";
import { 
	setupAWSCredentials, 
	runAWSCommand, 
	getDefaultVpcId,
	getSubnetIds,
	ensureSecurityGroup,
	generateResourceName
} from "./awsHelpers";

/**
 * Gets the latest Amazon Linux 2023 AMI ID
 */
async function getLatestAMI(region: string, ws: any): Promise<string> {
	// Use key=value form with quoted query so & in JMESPath is not interpreted by Windows shell
	const query = "sort_by(Images, &CreationDate)[-1].ImageId";
	const queryArg = process.platform === 'win32' ? `--query="${query}"` : `--query=${query}`;
	const output = await runAWSCommand([
		"ec2", "describe-images",
		"--owners", "amazon",
		"--filters",
		"Name=name,Values=al2023-ami-*-x86_64",
		"Name=state,Values=available",
		queryArg,
		"--output", "text",
		`--region=${region}`
	], ws, 'setup');

	return output.trim();
}

/**
 * Creates a key pair for SSH access
 */
async function ensureKeyPair(
	keyName: string,
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

	try {
		await runAWSCommand([
			"ec2", "describe-key-pairs",
			"--key-names", keyName,
			"--region", region
		], ws, 'setup');
		send(`Key pair ${keyName} already exists`, 'setup');
	} catch {
		send(`Creating key pair: ${keyName}...`, 'setup');
		await runAWSCommand([
			"ec2", "create-key-pair",
			"--key-name", keyName,
			"--query", "KeyMaterial",
			"--output", "text",
			"--region", region
		], ws, 'setup');
	}
}

/**
 * Parses comma-separated KEY=value string, allowing commas inside values
 * (splits only at comma followed by a key pattern, e.g. ,NEXT_KEY=)
 */
function parseEnvVarsAllowCommasInValues(envVarsString: string): { key: string; value: string }[] {
	const trimmed = envVarsString.trim();
	if (!trimmed) return [];
	// Split at comma that is followed by a valid env key (letters/underscore then =)
	const segments = trimmed.split(/,(?=[A-Za-z_][A-Za-z0-9_]*=)/).map((s) => s.trim()).filter(Boolean);
	return segments
		.map((segment) => {
			const eqIdx = segment.indexOf("=");
			if (eqIdx === -1) return null;
			const key = segment.slice(0, eqIdx).trim();
			const value = segment.slice(eqIdx + 1).trim();
			return key ? { key, value } : null;
		})
		.filter((e): e is { key: string; value: string } => e != null);
}

/**
 * Builds .env file content with safe escaping (values with newlines/quotes get quoted)
 */
function buildEnvFileContent(entries: { key: string; value: string }[]): string {
	const lines: string[] = [];
	for (const { key, value } of entries) {
		const needsQuoting = /[\n"\\]/.test(value);
		if (needsQuoting) {
			const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
			lines.push(`${key}="${escaped}"`);
		} else {
			lines.push(`${key}=${value}`);
		}
	}
	return lines.join("\n");
}

/**
 * Generates user-data script for EC2 instance
 */
function generateUserDataScript(
	repoUrl: string,
	branch: string,
	token: string,
	services: { name: string; dir: string; port: number }[],
	envVars: string,
	dbConnectionString?: string
): string {
	const authenticatedUrl = repoUrl.replace("https://", `https://${token}@`);
	
	// Generate docker-compose.yml content
	const composeServices: Record<string, any> = {};
	const ports: string[] = [];
	
	for (const svc of services) {
		const servicePort = svc.port || 8080;
		ports.push(String(servicePort));
		
		composeServices[svc.name] = {
			build: {
				context: svc.dir === '.' ? '.' : `./${svc.dir}`,
				dockerfile: 'Dockerfile'
			},
			ports: [`${servicePort}:${servicePort}`],
			environment: [
				`PORT=${servicePort}`,
				'NODE_ENV=production'
			],
			restart: 'unless-stopped'
		};

		if (dbConnectionString) {
			composeServices[svc.name].environment.push(`DATABASE_URL=${dbConnectionString}`);
		}
	}

	const composeContent = {
		version: '3.8',
		services: composeServices
	};

	// Build .env content and base64-encode so values with commas/newlines/quotes (e.g. JSON keys) are safe
	const envEntries = parseEnvVarsAllowCommasInValues(envVars);
	if (dbConnectionString) {
		envEntries.push({ key: "DATABASE_URL", value: dbConnectionString });
	}
	const envFileContent = buildEnvFileContent(envEntries);
	const envBase64 = envFileContent ? Buffer.from(envFileContent, "utf8").toString("base64") : "";

	return `#!/bin/bash
set -e

# Update system
yum update -y

# Create 2 GB swap file — t3.micro (1 GB RAM) runs out of memory during Docker builds
dd if=/dev/zero of=/swapfile bs=1M count=2048
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Install Docker
yum install -y docker git
systemctl start docker
systemctl enable docker

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Install Docker Buildx (required by docker-compose build; Amazon Linux Docker may not include 0.17+)
mkdir -p /usr/libexec/docker/cli-plugins /root/.docker/cli-plugins
curl -sSL "https://github.com/docker/buildx/releases/download/v0.19.3/buildx-v0.19.3.linux-amd64" -o /usr/libexec/docker/cli-plugins/docker-buildx
chmod +x /usr/libexec/docker/cli-plugins/docker-buildx
cp /usr/libexec/docker/cli-plugins/docker-buildx /root/.docker/cli-plugins/docker-buildx

# Clone repository
cd /home/ec2-user
git clone -b ${branch} ${authenticatedUrl} app
cd app

# Set environment variables (base64-decoded to support commas, newlines, quotes in values)
${envBase64 ? `echo '${envBase64}' | base64 -d > .env` : "touch .env"}

# Create docker-compose.yml if not exists
if [ ! -f docker-compose.yml ]; then
cat > docker-compose.yml << 'COMPOSEEOF'
${JSON.stringify(composeContent, null, 2)}
COMPOSEEOF
fi

# Build and start containers
docker-compose up -d --build

# Setup nginx reverse proxy
yum install -y nginx
systemctl start nginx
systemctl enable nginx

# Disable the default nginx server block on port 80 in nginx.conf (it conflicts with our app.conf)
# Comment out the listen/server_name lines for the built-in default server
sed -i 's/^[[:space:]]*server_name[[:space:]]\+_;$/# &/' /etc/nginx/nginx.conf
sed -i 's/^[[:space:]]*listen[[:space:]]\+80;$/# &/' /etc/nginx/nginx.conf
sed -i 's/^[[:space:]]*listen[[:space:]]\+\[::]:80;$/# &/' /etc/nginx/nginx.conf

# Configure nginx
cat > /etc/nginx/conf.d/app.conf << 'NGINXEOF'
server {
    listen 80 default_server;
    server_name _;
    
    location / {
        proxy_pass http://127.0.0.1:${ports[0] || 8080};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_cache_bypass \\$http_upgrade;
    }
}
NGINXEOF

# Remove any default server config that might take precedence
rm -f /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/00-default.conf /etc/nginx/conf.d/ssl.conf 2>/dev/null || true

# Validate and reload
nginx -t
systemctl reload nginx

# Show how nginx has wired port 80 (from nginx's own view)
echo "====== nginx servers listening on port 80 ======"
nginx -T 2>/dev/null | awk '
  /server {/ { in_server=1; block=\"\" }
  in_server { block = block $0 \"\\n\" }
  /}/ && in_server {
    in_server=0
    if (block ~ /listen 80/ && block ~ /server_name _;/) print block \"\\n\"
  }'
echo "==============================================="

echo "Nginx configured to proxy to the application on port ${ports[0] || 8080}"
echo "====================================== Deployment complete! ======================================"
`;
}

/**
 * Handles deployment to AWS EC2
 */
export async function handleEC2(
	deployConfig: DeployConfig,
	appDir: string,
	multiServiceConfig: MultiServiceConfig,
	token: string,
	dbConnectionString: string | undefined,
	ws: any
): Promise<{ serviceUrls: Map<string, string>; instanceId: string; publicIp: string; vpcId: string; subnetId: string; securityGroupId: string; amiId: string }> {
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
	const instanceName = generateResourceName(repoName, "ec2");
	const keyName = `smartdeploy`;

	// If this deployment already has an EC2 instance, terminate it so we replace with a new one (redeploy = update)
	const existingInstanceId = deployConfig.ec2?.instanceId?.trim();
	if (existingInstanceId) {
		try {
			const stateOutput = await runAWSCommand([
				"ec2", "describe-instances",
				"--instance-ids", existingInstanceId,
				"--query", "Reservations[0].Instances[0].State.Name",
				"--output", "text",
				"--region", region
			], ws, 'setup');
			const state = (stateOutput || "").trim();
			if (state && state !== "None" && state !== "terminated") {
				send(`Terminating previous instance ${existingInstanceId} (${state})...`, 'setup');
				await runAWSCommand([
					"ec2", "terminate-instances",
					"--instance-ids", existingInstanceId,
					"--region", region
				], ws, 'setup');
				send("Previous instance termination initiated.", 'setup');
			}
		} catch {
			// Instance may already be gone; continue to launch new one
		}
	}

	// Reuse saved networking when present (e.g. redeploy); otherwise create
	let vpcId: string;
	let subnetIds: string[];
	let securityGroupId: string;
	if (deployConfig.ec2?.vpcId?.trim() && deployConfig.ec2?.subnetId?.trim() && deployConfig.ec2?.securityGroupId?.trim()) {
		vpcId = deployConfig.ec2.vpcId.trim();
		subnetIds = [deployConfig.ec2.subnetId.trim()];
		securityGroupId = deployConfig.ec2.securityGroupId.trim();
		send("Reusing existing VPC, subnet, and security group...", 'setup');
	} else {
		send("Setting up networking...", 'setup');
		vpcId = await getDefaultVpcId(ws);
		subnetIds = await getSubnetIds(vpcId, ws);
		securityGroupId = await ensureSecurityGroup(
			`${repoName}-ec2-sg`,
			vpcId,
			`Security group for ${repoName} EC2 instance`,
			ws
		);
		// Add SSH access to security group
		try {
			await runAWSCommand([
				"ec2", "authorize-security-group-ingress",
				"--group-id", securityGroupId,
				"--protocol", "tcp",
				"--port", "22",
				"--cidr", "0.0.0.0/0",
				"--region", region
			], ws, 'setup');
		} catch {
			// Rule might already exist
		}
		// Add application ports
		const appPorts = [8080, 3000, 5000];
		for (const port of appPorts) {
			try {
				await runAWSCommand([
					"ec2", "authorize-security-group-ingress",
					"--group-id", securityGroupId,
					"--protocol", "tcp",
					"--port", String(port),
					"--cidr", "0.0.0.0/0",
					"--region", region
				], ws, 'setup');
			} catch {
				// Rule might already exist
			}
		}
	}

	// Create key pair
	await ensureKeyPair(keyName, region, ws);

	// Use stored AMI when present (redeploy); otherwise get latest
	let amiId: string;
	if (deployConfig.ec2?.amiId?.trim()) {
		amiId = deployConfig.ec2.amiId.trim();
		send(`✅ Using stored AMI: ${amiId}`, 'setup');
	} else {
		send("Finding latest AMI...", 'setup');
		amiId = await getLatestAMI(region, ws);
		send(`✅ Using AMI: ${amiId}`, 'setup');
	}

	// Determine services to deploy
	const services: { name: string; dir: string; port: number }[] = [];
	if (multiServiceConfig.isMultiService && multiServiceConfig.services.length > 0) {
		for (const svc of multiServiceConfig.services) {
			services.push({
				name: svc.name,
				dir: svc.workdir,
				port: svc.port || 8080
			});
		}
	} else {
		services.push({
			name: repoName,
			dir: '.',
			port: deployConfig.core_deployment_info?.port || 8080
		});
	}

	// Generate user-data script
	const userData = generateUserDataScript(
		deployConfig.url,
		deployConfig.branch || 'main',
		token,
		services,
		deployConfig.env_vars || '',
		dbConnectionString
	);

	console.log("userData", userData);

	// Base64 encode user-data and write to temp file to avoid "command line too long" on Windows
	const userDataBase64 = Buffer.from(userData).toString('base64');
	const userDataFile = path.join(os.tmpdir(), `ec2-userdata-${Date.now()}.b64`);
	fs.writeFileSync(userDataFile, userDataBase64, 'utf8');
	const userDataFileUri = "fileb://" + path.resolve(userDataFile).replace(/\\/g, '/');

	let instanceId: string;
	try {
		// Launch EC2 instance
		send(`Launching EC2 instance: ${instanceName}...`, 'deploy');

		const runOutput = await runAWSCommand([
			"ec2", "run-instances",
			"--image-id", amiId,
			"--instance-type", "t3.micro",
			"--key-name", keyName,
			"--security-group-ids", securityGroupId,
			"--subnet-id", subnetIds[0],
			"--user-data", userDataFileUri,
			"--tag-specifications", `ResourceType=instance,Tags=[{Key=Name,Value=${instanceName}},{Key=Project,Value=SmartDeploy}]`,
			"--query", "Instances[0].InstanceId",
			"--output", "text",
			"--region", region
		], ws, 'deploy');

		instanceId = runOutput.trim();
		send(`Instance launched: ${instanceId}`, 'deploy');
	} finally {
		try {
			fs.unlinkSync(userDataFile);
		} catch {
			// ignore cleanup errors
		}
	}

	// Wait for instance to be running
	send("Waiting for instance to be running...", 'deploy');
	await runAWSCommand([
		"ec2", "wait", "instance-running",
		"--instance-ids", instanceId,
		"--region", region
	], ws, 'deploy');

	// Get public IP
	send("Getting instance public IP...", 'deploy');
	const ipOutput = await runAWSCommand([
		"ec2", "describe-instances",
		"--instance-ids", instanceId,
		"--query", "Reservations[0].Instances[0].PublicIpAddress",
		"--output", "text",
		"--region", region
	], ws, 'deploy');

	const publicIp = ipOutput.trim();
	send(`Instance public IP: ${publicIp}`, 'deploy');

	// Give user-data time to run (install docker, clone, build can take 2–5+ minutes)
	send("Waiting for application to deploy (user-data runs in background; this may take 5+ minutes)...", 'deploy');
	const initialDelayMs = 90 * 1000;
	send(`Waiting ${initialDelayMs / 1000}s before first health check...`, 'deploy');
	await new Promise(resolve => setTimeout(resolve, initialDelayMs));

	const portsToTry = [80, 8080, 3000, 5000];
	const nullOut = process.platform === "win32" ? "NUL" : "/dev/null";
	let attempts = 0;
	const maxAttempts = 24; // 24 * 15s ≈ 6 min after initial delay
	let detectedPort: number = 80;

	while (attempts < maxAttempts) {
		let responded = false;
		for (const port of portsToTry) {
			try {
				const { runCommandLiveWithWebSocket } = await import("../../server-helper");
				const out = await runCommandLiveWithWebSocket("curl", [
					"-s", "-o", nullOut, "-w", "%{http_code}",
					"--connect-timeout", "8",
					`http://${publicIp}:${port}`
				], ws, 'deploy');
				const code = (out || "").trim();
				if (code && code !== "000" && (code.startsWith("2") || code.startsWith("3"))) {
					send(`✅ Application is responding on port ${port} (HTTP ${code})!`, 'deploy');
					detectedPort = port;
					responded = true;
					break;
				}
			} catch {
				// try next port
			}
		}
		if (responded) break;
		attempts++;
		send(`Waiting for application... (${attempts}/${maxAttempts}) – ensure ports 80, 8080 are open in the security group.`, 'deploy');
		await new Promise(resolve => setTimeout(resolve, 15000));
	}
	if (attempts >= maxAttempts) {
		send(`Health check did not get a response. Instance is up; check /var/log/cloud-init-output.log on the instance (SSH) to see if user-data completed.`, 'deploy');
	}

	const serviceUrls = new Map<string, string>();
	const baseUrl = detectedPort == 80 || detectedPort == 8080 ? `http://${publicIp}` : `http://${publicIp}:${detectedPort}`;
	
	for (const svc of services) {
		if (services.length === 1) {
			serviceUrls.set(svc.name, baseUrl);
		} else {
			serviceUrls.set(svc.name, `http://${publicIp}:${svc.port}`);
		}
	}

	send(`\nDeployment complete!`, 'done');
	send(`Application URL: ${baseUrl}`, 'done');
	send(`Instance ID: ${instanceId}`, 'done');
	send(`SSH: ssh -i ${keyName}.pem ec2-user@${publicIp}`, 'done');

	return {
		serviceUrls,
		instanceId,
		publicIp,
		vpcId,
		subnetId: subnetIds[0],
		securityGroupId,
		amiId,
	};
}
