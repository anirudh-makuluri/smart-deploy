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

	// Escape special characters for bash
	const composeYaml = JSON.stringify(composeContent);
	
	return `#!/bin/bash
set -e

# Update system
yum update -y

# Install Docker
yum install -y docker git
systemctl start docker
systemctl enable docker

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Clone repository
cd /home/ec2-user
git clone -b ${branch} ${authenticatedUrl} app
cd app

# Set environment variables
${envVars ? `cat > .env << 'ENVEOF'
${envVars.split(',').join('\n')}
ENVEOF` : ''}

${dbConnectionString ? `echo "DATABASE_URL=${dbConnectionString}" >> .env` : ''}

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

# Configure nginx
cat > /etc/nginx/conf.d/app.conf << 'NGINXEOF'
server {
    listen 80;
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

systemctl reload nginx

echo "Deployment complete!"
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
): Promise<{ serviceUrls: Map<string, string>, instanceId: string, publicIp: string }> {
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
	const keyName = `smartdeploy-${repoName}`;

	// Setup AWS credentials
	send("Authenticating with AWS...", 'auth');
	await setupAWSCredentials(ws);

	// Get networking info
	send("Setting up networking...", 'setup');
	const vpcId = await getDefaultVpcId(ws);
	const subnetIds = await getSubnetIds(vpcId, ws);
	
	// Create security group with HTTP, HTTPS, and SSH access
	const securityGroupId = await ensureSecurityGroup(
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

	// Create key pair
	await ensureKeyPair(keyName, region, ws);

	// Get AMI
	send("Finding latest AMI...", 'setup');
	const amiId = await getLatestAMI(region, ws);
	send(`Using AMI: ${amiId}`, 'setup');

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

	// Base64 encode user-data
	const userDataBase64 = Buffer.from(userData).toString('base64');

	// Launch EC2 instance
	send(`Launching EC2 instance: ${instanceName}...`, 'deploy');
	
	const runOutput = await runAWSCommand([
		"ec2", "run-instances",
		"--image-id", amiId,
		"--instance-type", "t3.micro",
		"--key-name", keyName,
		"--security-group-ids", securityGroupId,
		"--subnet-id", subnetIds[0],
		"--user-data", userDataBase64,
		"--tag-specifications", `ResourceType=instance,Tags=[{Key=Name,Value=${instanceName}},{Key=Project,Value=SmartDeploy}]`,
		"--query", "Instances[0].InstanceId",
		"--output", "text",
		"--region", region
	], ws, 'deploy');

	const instanceId = runOutput.trim();
	send(`Instance launched: ${instanceId}`, 'deploy');

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
					send(`Application is responding on port ${port} (HTTP ${code})!`, 'deploy');
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
	const baseUrl = detectedPort === 80 ? `http://${publicIp}` : `http://${publicIp}:${detectedPort}`;
	
	for (const svc of services) {
		if (services.length === 1) {
			serviceUrls.set(svc.name, baseUrl);
		} else {
			serviceUrls.set(svc.name, `${baseUrl}:${svc.port}`);
		}
	}

	send(`\nDeployment complete!`, 'done');
	send(`Application URL: ${baseUrl}`, 'done');
	send(`Instance ID: ${instanceId}`, 'done');
	send(`SSH: ssh -i ${keyName}.pem ec2-user@${publicIp}`, 'done');

	return { serviceUrls, instanceId, publicIp };
}
