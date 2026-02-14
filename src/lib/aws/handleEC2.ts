import fs from "fs";
import os from "os";
import path from "path";
import config from "../../config";
import { DeployConfig } from "../../app/types";
import { createWebSocketLogger } from "../websocketLogger";
import { MultiServiceConfig } from "../multiServiceDetector";
import { 
	setupAWSCredentials, 
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
	generateResourceName
} from "./awsHelpers";

/**
 * Terminates an EC2 instance and optionally cleans up ALB resources
 */
async function terminateInstance(
	instanceId: string,
	region: string,
	ws: any,
	options?: { 
		cleanupAlbTargetGroup?: boolean;
		targetGroupName?: string;
	}
): Promise<void> {
	const send = createWebSocketLogger(ws);

	try {
		// Cleanup ALB target group if requested
		if (options?.cleanupAlbTargetGroup && options?.targetGroupName) {
			try {
				const targetGroupName = options.targetGroupName;
				const targetGroupArn = (
					await runAWSCommand([
						"elbv2",
						"describe-target-groups",
						"--names",
						targetGroupName,
						"--query",
						"TargetGroups[0].TargetGroupArn",
						"--output",
						"text",
						"--region",
						region,
					], ws, "deploy")
				).trim();
				
				if (targetGroupArn && targetGroupArn !== "None") {
					try {
						const accountId = (await runAWSCommand([
							"sts",
							"get-caller-identity",
							"--query",
							"Account",
							"--output",
							"text"
						], ws, "auth")).trim();
						const suffix = accountId ? accountId.slice(-6) : "shared";
						const albName = `smartdeploy-${suffix}-alb`.slice(0, 32);
						const albArn = (await runAWSCommand([
							"elbv2",
							"describe-load-balancers",
							"--names",
							albName,
							"--query",
							"LoadBalancers[0].LoadBalancerArn",
							"--output",
							"text",
							"--region",
							region
						], ws, "deploy")).trim();
						
						if (albArn && albArn !== "None") {
							const listenerArns: string[] = [];
							const httpsListenerArn = (await runAWSCommand([
								"elbv2",
								"describe-listeners",
								"--load-balancer-arn",
								albArn,
								"--query",
								"Listeners[?Port==`443`].ListenerArn[0]",
								"--output",
								"text",
								"--region",
								region
							], ws, "deploy")).trim();
							if (httpsListenerArn && httpsListenerArn !== "None") listenerArns.push(httpsListenerArn);
							
							const httpListenerArn = (await runAWSCommand([
								"elbv2",
								"describe-listeners",
								"--load-balancer-arn",
								albArn,
								"--query",
								"Listeners[?Port==`80`].ListenerArn[0]",
								"--output",
								"text",
								"--region",
								region
							], ws, "deploy")).trim();
							if (httpListenerArn && httpListenerArn !== "None") listenerArns.push(httpListenerArn);

							for (const listenerArn of listenerArns) {
								const rulesRaw = await runAWSCommand([
									"elbv2",
									"describe-rules",
									"--listener-arn",
									listenerArn,
									"--output",
									"json",
									"--region",
									region
								], ws, "deploy");
								let rules: Array<{ RuleArn?: string; Actions?: Array<{ Type?: string; TargetGroupArn?: string }> }> = [];
								try {
									const parsed = JSON.parse(rulesRaw);
									rules = Array.isArray(parsed?.Rules) ? parsed.Rules : [];
								} catch {
									rules = [];
								}

								for (const rule of rules) {
									const forwardsTarget = (rule.Actions || []).some(
										(action) => action.Type === "forward" && action.TargetGroupArn === targetGroupArn
									);
									if (forwardsTarget && rule.RuleArn) {
										await runAWSCommand([
											"elbv2",
											"delete-rule",
											"--rule-arn",
											rule.RuleArn,
											"--region",
											region
										], ws, "deploy");
									}
								}
							}
						}
					} catch {
						// Ignore listener rule cleanup errors
					}

					send(`Deleting ALB target group ${targetGroupName}...`, "deploy");
					await runAWSCommand([
						"elbv2",
						"delete-target-group",
						"--target-group-arn",
						targetGroupArn,
						"--region",
						region,
					], ws, "deploy");
				}
			} catch {
				// Target group may not exist; ignore cleanup errors
			}
		}

		// Check instance state before terminating
		const stateOutput = await runAWSCommand([
			"ec2", "describe-instances",
			"--instance-ids", instanceId,
			"--query", "Reservations[0].Instances[0].State.Name",
			"--output", "text",
			"--region", region
		], ws, 'deploy');
		
		const state = (stateOutput || "").trim();
		if (state && state !== "None" && state !== "terminated") {
			send(`Terminating instance ${instanceId} (${state})...`, 'deploy');
			await runAWSCommand([
				"ec2", "terminate-instances",
				"--instance-ids", instanceId,
				"--region", region
			], ws, 'deploy');
			send(`Instance ${instanceId} termination initiated.`, 'deploy');
		}
	} catch (error: any) {
		send(`Error terminating instance: ${error.message}`, 'deploy');
		throw error;
	}
}
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
	const send = createWebSocketLogger(ws);

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

function normalizeDomain(input?: string): string {
	const raw = (input || "").trim();
	if (!raw) return "";
	try {
		const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
		return url.hostname;
	} catch {
		return raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
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
	dbConnectionString?: string,
	commitSha?: string,
	customDomain?: string,
	letsEncryptEmail?: string
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

	const domainHost = normalizeDomain(customDomain);
	const email = (letsEncryptEmail || "").trim();

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
${commitSha ? `git checkout ${commitSha}` : ''}

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
# Comment out listen/server_name lines for the built-in default server, including default_server variants
sed -i 's/^[[:space:]]*server_name[[:space:]]\+_;$/# &/' /etc/nginx/nginx.conf
sed -i 's/^[[:space:]]*listen[[:space:]]\+80\(.*default_server.*\)\?;$/# &/' /etc/nginx/nginx.conf
sed -i 's/^[[:space:]]*listen[[:space:]]\+\[::]:80\(.*default_server.*\)\?;$/# &/' /etc/nginx/nginx.conf

# Configure nginx
cat > /etc/nginx/conf.d/upgrade-map.conf << 'NGINXEOF'
map \$http_upgrade \$connection_upgrade {
	default upgrade;
	'' close;
}
NGINXEOF

cat > /etc/nginx/conf.d/app.conf << 'NGINXEOF'
server {
    listen 80 default_server;
    server_name _;
    
    location / {
        proxy_pass http://127.0.0.1:${ports[0] || 8080};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\$http_upgrade;
		proxy_set_header Connection \$connection_upgrade;
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
  /server {/ { in_server=1; block="" }
  in_server { block = block $0 "\\n" }
  /}/ && in_server {
    in_server=0
    if (block ~ /listen 80/ && block ~ /server_name _;/) print block "\\n"
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
): Promise<{ success: boolean; baseUrl: string, serviceUrls: Map<string, string>; instanceId: string; publicIp: string; vpcId: string; subnetId: string; securityGroupId: string; amiId: string; sharedAlbDns?: string }> {
	const send = createWebSocketLogger(ws);

	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";
	const instanceName = generateResourceName(repoName, "ec2");
	const keyName = `smartdeploy`;
	const certificateArn = config.ECS_ACM_CERTIFICATE_ARN?.trim() || "";
	const sharedAlbEnabled = !!certificateArn && !!buildServiceHostname("app");

	// Save existing instance ID for later termination after new instance is confirmed working
	const existingInstanceId = deployConfig.ec2?.instanceId?.trim();

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
	}

	// Ensure ingress rules exist even when reusing a security group
	const ingressPorts = new Set<number>([22, 80, 443, 8080, 3000, 5000]);
	if (deployConfig.core_deployment_info?.port) {
		ingressPorts.add(deployConfig.core_deployment_info.port);
	}
	if (multiServiceConfig.isMultiService && multiServiceConfig.services.length > 0) {
		for (const svc of multiServiceConfig.services) {
			if (typeof svc.port === "number" && !Number.isNaN(svc.port)) {
				ingressPorts.add(svc.port);
			}
		}
	}
	for (const port of ingressPorts) {
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
		dbConnectionString,
		deployConfig.commitSha,
		sharedAlbEnabled ? undefined : deployConfig.custom_url,
		sharedAlbEnabled ? undefined : config.LETSENCRYPT_EMAIL
	);


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

	// Only send last N lines of console output to avoid flooding logs with full cloud-init/docker output
	const CONSOLE_TAIL_LINES = 80;
	function tailConsoleOutput(fullOutput: string): string {
		const lines = fullOutput.trim().split(/\r?\n/);
		if (lines.length <= CONSOLE_TAIL_LINES) return fullOutput.trim();
		return "... (showing last " + CONSOLE_TAIL_LINES + " lines)\n" + lines.slice(-CONSOLE_TAIL_LINES).join("\n");
	}

	let attempts = 0;
	const maxAttempts = 24; // 24 * 15s ≈ 6 min after initial delay
	while (attempts < maxAttempts) {
		attempts++;
		send(`Fetching instance system logs (${attempts}/${maxAttempts})...`, 'deploy');
		try {
			// Use runAWSCommandToFile to avoid Windows console encoding errors (exit 255) when output contains Unicode
			const consoleOut = await runAWSCommandToFile(
				[
					"ec2",
					"get-console-output",
					"--instance-id",
					instanceId,
					"--latest",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				'deploy'
			);

			if (consoleOut && consoleOut.trim()) {
				send(tailConsoleOutput(consoleOut), 'deploy');
			} else {
				send("(no new console output from instance yet)", 'deploy');
			}

			// Stop early if user-data signalled completion
			if (consoleOut.includes("Deployment complete!")) {
				send("Instance user-data finished running.", 'deploy');
				break;
			}
		} catch (err: any) {
			const msg = err instanceof Error ? err.message : String(err);
			send(`Error fetching console output: ${msg}`, 'deploy');
		}

		await new Promise((resolve) => setTimeout(resolve, 15000));
	}

	// Quick one-shot port detection: try likely ports (including any service ports) with curl,
	// mainly to choose a nice base URL. This doesn't block on readiness (we already streamed logs above).
	let detectedPort: number | null = null;
	try {
		const { runCommandLiveWithWebSocket } = await import("../../server-helper");
		const nullOut = process.platform === "win32" ? "NUL" : "/dev/null";
		const candidatePorts = Array.from(
			new Set<number>([
				80,
				8080,
				3000,
				5000,
				...services
					.map((svc) => svc.port)
					.filter((p): p is number => typeof p === "number" && !Number.isNaN(p)),
			])
		);

		for (const port of candidatePorts) {
			try {
				const out = await runCommandLiveWithWebSocket(
					"curl",
					[
						"-s",
						"-o",
						nullOut,
						"-w",
						"%{http_code}",
						"--connect-timeout",
						"4",
						`http://${publicIp}:${port}`,
					],
					ws,
					"deploy"
				);
				const code = (out || "").trim();
				if (code && code !== "000" && (code.startsWith("2") || code.startsWith("3"))) {
					send(`✅ Detected responding port ${port} (HTTP ${code})`, "deploy");
					detectedPort = port;
					break;
				}
			} catch {
				// ignore and try next port
			}
		}
	} catch {
		// If curl/runCommandLiveWithWebSocket fails, fall back to 80
	}

	if (!detectedPort) {
		send(`❌ New instance failed to respond on any known ports.`, "deploy");
		
		// Terminate the failed new instance
		try {
			send(`Cleaning up failed instance ${instanceId}...`, "deploy");
			await terminateInstance(instanceId, region, ws);
			send(`Failed instance ${instanceId} terminated.`, "deploy");
		} catch (error: any) {
			send(`⚠️ Failed to terminate failed instance: ${error.message}. Please manually clean up instance ${instanceId}.`, "deploy");
		}
		
		if (existingInstanceId) {
			send(`⚠️ Falling back to existing instance ${existingInstanceId}...`, "deploy");
			send("New instance deployment failed. Reverting to previous instance.", "deploy");
			return {
				success: false,
				baseUrl: deployConfig.deployUrl || "",
				serviceUrls: new Map(),
				instanceId: existingInstanceId,
				publicIp: "",
				vpcId,
				subnetId: subnetIds[0],
				securityGroupId,
				amiId,
			};
		}
		throw new Error("New instance failed to respond and no previous instance to fall back to");
	}

	const serviceUrls = new Map<string, string>();
	let sharedAlbDns: string | undefined;
	let baseUrl = detectedPort == 80 || detectedPort == 8080 ? `http://${publicIp}` : `http://${publicIp}:${detectedPort}`;

	try {
		if (sharedAlbEnabled) {
			send("Configuring shared ALB routing to new instance...", "deploy");
			const sharedAlb = await ensureSharedAlb({
				vpcId,
				subnetIds: subnetIds.slice(0, 2),
				region,
				ws,
				certificateArn,
			});
			sharedAlbDns = sharedAlb.dnsName;
			const listenerArnForRules = sharedAlb.httpsListenerArn || sharedAlb.httpListenerArn;
			const customHost = normalizeDomain(deployConfig.custom_url);

			// ALB forwards only to nginx on port 80.
			await allowAlbToReachService(securityGroupId, sharedAlb.albSgId, 80, ws);
			const targetGroupName = `${repoName}-tg`
				.toLowerCase()
				.replace(/[^a-z0-9-]/g, "-")
				.replace(/-+/g, "-")
				.replace(/^-|-$/g, "")
				.slice(0, 32) || "smartdeploy-tg";

			const targetGroupArn = await ensureTargetGroup(targetGroupName, vpcId, 80, region, ws, {
				targetType: "instance",
				healthCheckPath: "/",
			});
			
			// Deregister old instance from target group if it exists
			if (existingInstanceId) {
				try {
					await runAWSCommand([
						"elbv2",
						"deregister-targets",
						"--target-group-arn",
						targetGroupArn,
						"--targets",
						`Id=${existingInstanceId},Port=80`,
						"--region",
						region
					], ws, "deploy");
					send(`Deregistered old instance ${existingInstanceId} from target group.`, "deploy");
				} catch {
					// Old instance may not be registered; continue
				}
			}
			
			// Register new instance to target group
			await registerInstanceToTargetGroup(targetGroupArn, instanceId, 80, region, ws);

			for (const svc of services) {
				const preferredSubdomain = services.length === 1 && deployConfig.service_name?.trim()
					? deployConfig.service_name.trim()
					: svc.name;
				const serviceHostname = customHost || buildServiceHostname(svc.name, preferredSubdomain);
				if (serviceHostname) {
					await ensureHostRule(listenerArnForRules, serviceHostname, targetGroupArn, region, ws);
				}

				const serviceUrl = serviceHostname
					? `${certificateArn ? "https" : "http"}://${serviceHostname}`
					: `${certificateArn ? "https" : "http"}://${sharedAlb.dnsName}`;
				serviceUrls.set(svc.name, serviceUrl);
			}

			if (services.length === 1) {
				baseUrl = serviceUrls.get(services[0].name) || baseUrl;
			}
		} else {
			for (const svc of services) {
				if (services.length === 1) {
					serviceUrls.set(svc.name, baseUrl);
				} else {
					serviceUrls.set(svc.name, `http://${publicIp}:${svc.port}`);
				}
			}
		}

		send(`\n✅ New instance is responding and ALB configured!`, 'deploy');
		
		// Now that new instance is confirmed working, terminate the old instance
		if (existingInstanceId) {
			send(`Terminating old instance ${existingInstanceId}...`, 'deploy');
			try {
				const targetGroupName = `${repoName}-tg`
					.toLowerCase()
					.replace(/[^a-z0-9-]/g, "-")
					.replace(/-+/g, "-")
					.replace(/^-|-$/g, "")
					.slice(0, 32) || "smartdeploy-tg";
				
				await terminateInstance(existingInstanceId, region, ws, {
					cleanupAlbTargetGroup: sharedAlbEnabled,
					targetGroupName: sharedAlbEnabled ? targetGroupName : undefined
				});
				send(`Old instance ${existingInstanceId} terminated successfully.`, 'deploy');
			} catch (error: any) {
				send(`⚠️ Failed to terminate old instance: ${error.message}`, 'deploy');
				send("Continuing with new instance. You may want to manually terminate the old instance.", 'deploy');
			}
		}

	} catch (error: any) {
		send(`❌ ALB configuration failed: ${error.message}`, 'deploy');
		
		// Terminate the failed new instance
		try {
			send(`Cleaning up failed instance ${instanceId}...`, "deploy");
			await terminateInstance(instanceId, region, ws);
			send(`Failed instance ${instanceId} terminated.`, "deploy");
		} catch (cleanupError: any) {
			send(`⚠️ Failed to terminate failed instance: ${cleanupError.message}. Please manually clean up instance ${instanceId}.`, "deploy");
		}
		
		if (existingInstanceId) {
			send(`⚠️ Falling back to existing instance ${existingInstanceId}...`, 'deploy');
			return {
				success: false,
				baseUrl: deployConfig.deployUrl || "",
				serviceUrls: new Map(),
				instanceId: existingInstanceId,
				publicIp: "",
				vpcId,
				subnetId: subnetIds[0],
				securityGroupId,
				amiId,
			};
		}
		throw error;
	}

	send(`\nDeployment complete!`, 'done');
	send(`Application URL: ${baseUrl}`, 'done');
	send(`Instance ID: ${instanceId}`, 'done');
	send(`SSH: ssh -i ${keyName}.pem ec2-user@${publicIp}`, 'done');

	return {
		success: true,
		baseUrl,
		serviceUrls,
		instanceId,
		publicIp,
		vpcId,
		subnetId: subnetIds[0],
		securityGroupId,
		amiId,
		sharedAlbDns,
	};
}
