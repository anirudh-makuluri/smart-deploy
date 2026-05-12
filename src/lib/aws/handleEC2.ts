import fs from "fs";
import os from "os";
import path from "path";
import config from "../../config";
import { DeployConfig, EC2Details } from "../../app/types";
import { createWebSocketLogger } from "../websocketLogger";
import { MultiServiceConfig } from "../multiServiceDetector";
import {
	runAWSCommand,
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
	buildFirstDeployScript,
	buildRedeployScript,
	buildEcrDeployScript,
	buildEcrComposeDeployScript,
	generateEcrUserDataScript,
	runRedeployViaSsm,
	ensureInstanceSsmReady,
	SSM_PROFILE_NAME,
} from "./ec2SsmHelpers";
import { githubAuthenticatedCloneUrl } from "../githubGitAuth";
import { resolveEc2InstanceType } from "./ec2InstanceTypes";

import { EC2Client, GetConsoleOutputCommand } from "@aws-sdk/client-ec2";

// ─── Types ──────────────────────────────────────────────────────────────────

type SendFn = (msg: string, stepId: string) => void;
const DIAGNOSTIC_LOG_TAIL = 300;
const DEFAULT_DIAGNOSTIC_CONTAINER = "smartdeploy-app";

export type ServiceDef = { name: string; dir: string; port: number; isMonorepo?: boolean; relativePath?: string; framework?: string; language?: string };

export type NetworkingResult = {
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
	const segments = trimmed.split(/\r?\n|,(?=[A-Za-z_][A-Za-z0-9_]*=)/).map(s => s.trim()).filter(Boolean);
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

function buildEnvBase64(
	envVars: string,
	dbConnectionString?: string,
	customDomain?: string,
): { envBase64: string } {
	const envEntries = parseEnvVarsAllowCommasInValues(envVars);
	const host = normalizeDomain(customDomain);
	if (host) {
		envEntries.push({ key: "NEXT_PUBLIC_WS_URL", value: `wss://${host}/ws` });
		envEntries.push({ key: "BETTER_AUTH_URL", value: `https://${host}` });
	}
	if (dbConnectionString) envEntries.push({ key: "DATABASE_URL", value: dbConnectionString });
	const raw = buildEnvFileContent(envEntries);
	return { envBase64: raw ? Buffer.from(raw, "utf8").toString("base64") : "" };
}

/**
 * Rewrites nginx config so upstreams work when nginx runs on the host.
 * Scan results often use Docker Compose service names (e.g. "web:3000", "backend:8080")
 * which only resolve inside the compose network. Host nginx must use 127.0.0.1:port
 * to reach published container ports. Replaces hostname:port with 127.0.0.1:port.
 */
function rewriteNginxConfForHost(nginxConf: string): string {
	return nginxConf.replace(/\b([a-zA-Z][a-zA-Z0-9_-]*):(\d+)\b/g, "127.0.0.1:$2");
}

function generateUserDataScript(
	repoUrl: string,
	branch: string,
	token: string,
	envBase64: string,
	mainPort: string,
	wsPort: string,
	nginxConf: string,
	commitSha?: string,
): string {
	const authUrl = githubAuthenticatedCloneUrl(repoUrl, token);
	const nginxConfForHost = nginxConf ? rewriteNginxConfForHost(nginxConf) : "";

	return `#!/bin/bash
set -e
trap 'EXIT_CODE=$?; echo "Script error at line $LINENO, exit code $EXIT_CODE"; exit $EXIT_CODE' ERR

rm -rf /var/lib/cloud/data/tmp_* 2>/dev/null || true
rm -rf /var/lib/cloud/instances/*/sem/* 2>/dev/null || true

echo "=== Initial disk space ==="
df -h /

yum install -y docker git nginx
dnf install -y amazon-ssm-agent 2>/dev/null || yum install -y amazon-ssm-agent 2>/dev/null || true
systemctl enable --now amazon-ssm-agent 2>/dev/null || true

yum clean all
rm -rf /var/cache/yum/*

AVAILABLE=$(df / | tail -1 | awk '{print $4}')
AVAILABLE_MB=$((AVAILABLE / 1024))
if [ $AVAILABLE_MB -gt 1200 ]; then
    dd if=/dev/zero of=/swapfile bs=1M count=1024
    chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

systemctl start docker && systemctl enable docker
cat > /etc/docker/daemon.json << 'DOCKEREOF'
{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}
DOCKEREOF
systemctl restart docker

curl -sL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose
mkdir -p /usr/libexec/docker/cli-plugins /root/.docker/cli-plugins
curl -sSL "https://github.com/docker/buildx/releases/download/v0.19.3/buildx-v0.19.3.linux-amd64" -o /usr/libexec/docker/cli-plugins/docker-buildx
chmod +x /usr/libexec/docker/cli-plugins/docker-buildx
cp /usr/libexec/docker/cli-plugins/docker-buildx /root/.docker/cli-plugins/docker-buildx

cd /home/ec2-user
git clone -b ${branch} ${authUrl} app
cd app
${commitSha ? `git checkout ${commitSha}` : ""}
git gc --aggressive --prune=now || true

${envBase64 ? `echo '${envBase64}' | base64 -d > .env` : "touch .env"}

systemctl start nginx && systemctl enable nginx

if [ -n "${nginxConfForHost ? "yes" : ""}" ]; then
    echo "Using nginx_conf from scan_results (rewritten for host upstreams)"
    cat > /etc/nginx/nginx.conf << 'NGINXEOF'
${nginxConfForHost}
NGINXEOF
else
    echo "Using default nginx reverse proxy config"
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
        proxy_pass http://127.0.0.1:${mainPort || "8080"};
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
fi

nginx -t && systemctl reload nginx

echo "====================================== Deployment complete! ======================================"
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

	const ec2Casted = (deployConfig.ec2 || {}) as EC2Details;
	if (ec2Casted?.vpcId?.trim() && ec2Casted?.subnetId?.trim() && ec2Casted?.securityGroupId?.trim()) {
		vpcId = ec2Casted.vpcId.trim();
		subnetIds = [ec2Casted.subnetId.trim()];
		securityGroupId = ec2Casted.securityGroupId.trim();
		send("Reusing existing VPC, subnet, and security group...", "setup");
	} else {
		send("Setting up networking...", "setup");
		vpcId = await getDefaultVpcId(ws);
		subnetIds = await getSubnetIds(vpcId, ws);
		securityGroupId = await ensureSecurityGroup(`${repoName}-ec2-sg`, vpcId, `Security group for ${repoName} EC2 instance`, ws);
	}

	const ports = new Set<number>([22, 80, 443]);
	if (typeof deployConfig.scanResults === "object" && deployConfig.scanResults && "services" in deployConfig.scanResults) {
		const sr = deployConfig.scanResults as Record<string, unknown>;
		const services = sr.services as Array<Record<string, unknown>>;
		if (Array.isArray(services) && services.length > 0 && "port" in services[0]) {
			const port = services[0].port as number;
			if (typeof port === "number" && !Number.isNaN(port)) {
				ports.add(port);
			}
		}
	}
	for (const svc of services) if (typeof svc.port === "number" && !Number.isNaN(svc.port)) ports.add(svc.port);
	if (multiServiceConfig.isMultiService) {
		for (const svc of multiServiceConfig.services) if (typeof svc.port === "number") ports.add(svc.port);
	}
	// Only add ingress rules that don't already exist to avoid InvalidPermission.Duplicate and noisy "Failed" logs
	const existingPorts = await getExistingIngressPorts(securityGroupId, region, ws);
	for (const port of ports) {
		if (existingPorts.has(port)) continue;
		await runAWSCommand(["ec2", "authorize-security-group-ingress", "--group-id", securityGroupId, "--protocol", "tcp", "--port", String(port), "--cidr", "0.0.0.0/0", "--region", region], ws, "setup");
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
	envBase64: string;
	mainPort: string;
	net: NetworkingResult;
	amiId: string;
	certificateArn: string;
	ws: any;
	send: SendFn;
}): Promise<EC2Result> {
	const { deployConfig, existingInstanceId, region, services, repoName, token, envBase64, mainPort, net, amiId, certificateArn, ws, send } = params;

	const scanResults = deployConfig.scanResults;
	send("Reusing existing instance (SSM redeploy)...", "deploy");
	await ensureInstanceSsmReady(existingInstanceId, region, ws, send);
	const scanResultsCasted = scanResults && typeof scanResults === "object" && "docker_compose" in scanResults 
		? (scanResults as Record<string, unknown>)
		: ({} as Record<string, unknown>);
	
	const script = buildRedeployScript({
		repoUrl: deployConfig.url,
		branch: deployConfig.branch?.trim() || "",
		token,
		commitSha: deployConfig.commitSha ?? undefined,
		envFileContentBase64: envBase64,
		dockerCompose: (scanResultsCasted.docker_compose as string) || "",
		dockerfiles: (scanResultsCasted.dockerfiles as Record<string, string>) || {},
		mainPort,
		scanServices: (scanResultsCasted.services as Array<{name: string; build_context: string; port: number; dockerfile_path: string; language?: string; framework?: string}>) || undefined,
		commands: scanResultsCasted.commands as Record<string, unknown> | string[] | undefined,
	});
	let ssmResult: { success: boolean };
	try {
		ssmResult = await runRedeployViaSsm({ instanceId: existingInstanceId, region, script, send });
	} catch (err: any) {
		const msg = err?.message ?? String(err);
		const isInvalidInstance =
			err?.name === "InvalidInstanceId" ||
			msg.includes("InvalidInstanceId") ||
			msg.includes("Instances not in a valid state");
		if (isInvalidInstance) {
			throw new Error(
				"SSM cannot run on this instance. Common causes: (1) Instance is in a different AWS account or region than your credentials. (2) Instance was not launched with SSM (e.g. older instance without the SSM instance profile). (3) SSM agent is not ready yet. Fix: Use the same account/region as the instance; or remove the saved instance ID and deploy again to launch a new instance with SSM support."
			);
		}
		throw err;
	}
	const { success } = ssmResult;

	if (!success) {
		send("Redeploy command failed. Check logs above.", "deploy");
		return {
			success: false,
			baseUrl: deployConfig.liveUrl || ((deployConfig.ec2 || {}) as EC2Details)?.baseUrl || "",
			serviceUrls: new Map(),
			instanceId: existingInstanceId,
			publicIp: ((deployConfig.ec2 || {}) as EC2Details)?.publicIp || "",
			...net, subnetId: net.subnetIds[0], amiId,
		};
	}

	const publicIp = ((deployConfig.ec2 || {}) as EC2Details)?.publicIp?.trim() || (
		await runAWSCommand(["ec2", "describe-instances", "--instance-ids", existingInstanceId, "--query", "Reservations[0].Instances[0].PublicIpAddress", "--output", "text", "--region", region], ws, "deploy")
	).trim();

	const { baseUrl, serviceUrls } = buildServiceUrls(deployConfig, services, repoName, publicIp, certificateArn);
	send("Redeploy complete.", "done");
	send(`Application URL: ${baseUrl}`, "done");
	return { success: true, baseUrl, serviceUrls, instanceId: existingInstanceId, publicIp, ...net, subnetId: net.subnetIds[0], amiId };
}

/** Launches a brand-new EC2 instance, waits for user-data (OS prep) to finish,
 *  then deploys containers via SSM and detects a healthy port.
 *  On failure (SSM deploy or port detection), returns success: false but still
 *  includes instanceId/publicIp so the caller can persist them for reuse on next deploy. */
async function launchNewInstance(params: {
	deployConfig: DeployConfig;
	instanceName: string;
	region: string;
	services: ServiceDef[];
	token: string;
	dbConnectionString: string | undefined;
	envBase64: string;
	mainPort: string;
	wsPort: string;
	net: NetworkingResult;
	amiId: string;
	ws: any;
	send: SendFn;
}): Promise<{ instanceId: string; publicIp: string; detectedPort: number | null; success: boolean }> {
	const { deployConfig, instanceName, region, services, token, envBase64, mainPort, wsPort, net, amiId, ws, send } = params;
	const keyName = "smartdeploy";

	await ensureSSMInstanceProfile(region, ws);
	await ensureKeyPair(keyName, region, ws);

	const nginxConf = deployConfig.scanResults && typeof deployConfig.scanResults === "object" && "nginx_conf" in deployConfig.scanResults
		? ((deployConfig.scanResults as Record<string, unknown>)?.nginx_conf as string) || ""
		: "";
	
	const userData = generateUserDataScript(
		deployConfig.url,
		deployConfig.branch?.trim() || "",
		token,
		envBase64,
		mainPort,
		wsPort,
		nginxConf,
		deployConfig.commitSha ?? undefined,
	);
	const tmpFile = path.join(os.tmpdir(), `ec2-userdata-${Date.now()}.sh`);
	fs.writeFileSync(tmpFile, userData, "utf8");
	const fileUri = "file://" + path.resolve(tmpFile).replace(/\\/g, "/");

	const ec2Config = (deployConfig.ec2 || {}) as EC2Details;
	let instanceId: string;
	try {
		const instanceType = resolveEc2InstanceType(ec2Config.instanceType);
		send(`Launching EC2 instance: ${instanceName} (${instanceType})...`, "deploy");
		const amiMinRootVolumeGiB = await getAmiMinimumRootVolumeGiB(amiId, region, ws);
		const rootVolumeGiB = Math.max(30, amiMinRootVolumeGiB);
		const blockDeviceMapping = `DeviceName=/dev/xvda,Ebs={VolumeSize=${rootVolumeGiB},VolumeType=gp3,DeleteOnTermination=true}`;
		const out = await runAWSCommand([
			"ec2", "run-instances",
			"--image-id", amiId,
			"--instance-type", instanceType,
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
		send(`Instance launched: ${instanceId} (${rootVolumeGiB}GB EBS root volume)`, "deploy");
	} finally {
		try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
	}

	send("Waiting for instance to be running...", "deploy");
	await runAWSCommand(["ec2", "wait", "instance-running", "--instance-ids", instanceId, "--region", region], ws, "deploy");

	const publicIp = (await runAWSCommand(["ec2", "describe-instances", "--instance-ids", instanceId, "--query", "Reservations[0].Instances[0].PublicIpAddress", "--output", "text", "--region", region], ws, "deploy")).trim();
	send(`Instance public IP: ${publicIp}`, "deploy");

	await waitForUserData(instanceId, region, ws, send);

	// Now deploy containers via SSM (Dockerfiles, compose, build/run)
	send("Waiting for SSM agent to be ready...", "deploy");
	await ensureInstanceSsmReady(instanceId, region, ws, send);

	const scanResultsCasted = deployConfig.scanResults && typeof deployConfig.scanResults === "object" && "docker_compose" in deployConfig.scanResults 
		? (deployConfig.scanResults as Record<string, unknown>)
		: ({} as Record<string, unknown>);
	
	const firstDeployScript = buildFirstDeployScript({
		envFileContentBase64: envBase64,
		dockerCompose: (scanResultsCasted.docker_compose as string) || "",
		dockerfiles: (scanResultsCasted.dockerfiles as Record<string, string>) || {},
		mainPort,
		scanServices: (scanResultsCasted.services as unknown as { name: string; build_context: string; port: number; dockerfile_path: string; language?: string; framework?: string }[]) || undefined,
		commands: scanResultsCasted.commands as Record<string, unknown> | string[] | undefined,
	});

	send("Deploying containers via SSM...", "deploy");
	const ssmResult = await runRedeployViaSsm({ instanceId, region, script: firstDeployScript, send });
	if (!ssmResult.success) {
		send("Container deployment failed via SSM. Instance will be reused on next deploy.", "deploy");
		return { instanceId, publicIp, detectedPort: null, success: false };
	}

	const detectedPort = await detectRespondingPort(publicIp, services, instanceId, region, ws, send);

	if (!detectedPort) {
		send("Instance failed to respond on any known ports. Instance will be reused on next deploy.", "deploy");
		return { instanceId, publicIp, detectedPort: null, success: false };
	}

	return { instanceId, publicIp, detectedPort, success: true };
}

/** Configures the shared ALB for a new instance (target group, listener rules, host routing). */
export async function configureAlb(params: {
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
	// With ACM: host rules must attach to HTTPS (443); HTTP (80) is redirect-only. Without ACM, rules use HTTP only.
	const listenerArn = certificateArn ? alb.httpsListenerArn : alb.httpListenerArn;
	if (!listenerArn) {
		throw new Error(
			certificateArn
				? "ALB HTTPS listener missing. Check EC2_ACM_CERTIFICATE_ARN is valid and in the same region as the load balancer."
				: "ALB HTTP listener missing."
		);
	}
	const customHost = normalizeDomain(deployConfig.liveUrl ?? undefined);

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
		const sub = services.length === 1 && deployConfig.serviceName?.trim() ? deployConfig.serviceName.trim() : svc.name;
		const hostname = customHost || buildServiceHostname(svc.name, sub);
		if (hostname) await ensureHostRule(listenerArn, hostname, tgArn, region, ws);
		const url = hostname ? `${certificateArn ? "https" : "http"}://${hostname}` : `${certificateArn ? "https" : "http"}://${alb.dnsName}`;
		serviceUrls.set(svc.name, url);
	}

	return { sharedAlbDns: alb.dnsName, serviceUrls };
}

// ─── Small helpers used by the main functions ───────────────────────────────

/** Returns TCP ports that already have 0.0.0.0/0 ingress on the security group. */
async function getExistingIngressPorts(groupId: string, region: string, ws: any): Promise<Set<number>> {
	const out = new Set<number>();
	try {
		const raw = await runAWSCommand(
			["ec2", "describe-security-groups", "--group-ids", groupId, "--query", "SecurityGroups[0].IpPermissions", "--output", "json", "--region", region],
			ws,
			"setup"
		);
		const perms = JSON.parse(raw.trim()) as Array<{ FromPort?: number; ToPort?: number; IpRanges?: Array<{ CidrIp?: string }> }>;
		if (!Array.isArray(perms)) return out;
		for (const p of perms) {
			const hasPublic = p.IpRanges?.some((r) => r.CidrIp === "0.0.0.0/0");
			if (!hasPublic || p.FromPort == null || p.ToPort == null) continue;
			for (let port = p.FromPort; port <= p.ToPort; port++) out.add(port);
		}
	} catch {
		// If describe fails, return empty set so we try adding all ports (old behavior)
	}
	return out;
}

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

async function getAmiMinimumRootVolumeGiB(amiId: string, region: string, ws: any): Promise<number> {
	try {
		const output = await runAWSCommand([
			"ec2",
			"describe-images",
			"--image-ids", amiId,
			"--query", "max(Images[0].BlockDeviceMappings[?Ebs.VolumeSize!=null].Ebs.VolumeSize)",
			"--output", "text",
			"--region", region,
		], ws, "setup");

		const parsed = Number.parseInt(output.trim(), 10);
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}
	} catch {
		// Fallback below
	}

	return 30;
}

async function terminateInstance(instanceId: string, region: string, ws: any): Promise<void> {
	const send = createWebSocketLogger(ws);
	const state = await getInstanceState(instanceId, region, ws);
	if (state && state !== "terminated") {
		send(`Terminating instance ${instanceId} (${state})...`, "deploy");
		await runAWSCommand(["ec2", "terminate-instances", "--instance-ids", instanceId, "--region", region], ws, "deploy");
	}
}

/**
 * Fetches EC2 console output via AWS SDK. No CLI/spawn, so no TTY or encoding issues.
 * Returns decoded console text (UTF-8).
 */
async function getConsoleOutput(instanceId: string, region: string): Promise<string> {
	const clientConfig: { region: string; credentials?: { accessKeyId: string; secretAccessKey: string } } = { region };
	if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
		clientConfig.credentials = {
			accessKeyId: config.AWS_ACCESS_KEY_ID,
			secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
		};
	}
	const client = new EC2Client(clientConfig);
	// Latest: true retrieves the most recent console output (same as EC2 console "System logs" and CLI --latest)
	const response = await client.send(new GetConsoleOutputCommand({ InstanceId: instanceId, Latest: true }));
	const base64 = response.Output;
	if (!base64) return "";
	// Node's Buffer.toString("utf8") replaces invalid UTF-8 sequences with replacement char
	return Buffer.from(base64, "base64").toString("utf8");
}

async function waitForUserData(instanceId: string, region: string, ws: any, send: SendFn): Promise<void> {
	send("Waiting for user-data to finish...", "deploy");
	let lastSnippet = "";
	let consecutiveErrors = 0;
	let encodingErrorShown = false;
	let cloudInitFailureDetected = false;
	for (let i = 1; i <= 72; i++) {
		try {
			const raw = await getConsoleOutput(instanceId, region);
			consecutiveErrors = 0;
			if (raw?.trim()) {
				const clean = sanitizeConsoleOutput(raw);

				let newContent = "";

				if (!lastSnippet) {
					newContent = clean;
				} else {
					const overlapIndex = clean.indexOf(lastSnippet);
					if (overlapIndex !== -1) {
						newContent = clean.substring(overlapIndex + lastSnippet.length);
					} else {
						newContent = clean;
					}
				}

				if (newContent) {
					const lines = newContent.split(/\n/);
					for (const line of lines) {
						if (line.trim()) send(line.trim(), "deploy");
					}
					lastSnippet = clean.slice(-250);
				}

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
							send("❌ Error: Cloud-init failure detected. The deployment script failed.", "deploy");
							throw new Error("Deployment failed during instance initialization (Cloud-init error). See logs for details.");
						}
					}
				}

				// Check for success signal (either legacy user-data or ECR minimal user-data)
				if (clean.includes("Deployment complete!") || clean.includes("Instance setup complete!")) {
					if (cloudInitFailureDetected) {
						send("✅ User-data script completed despite cloud-init warnings.", "deploy");
					} else {
						send("Instance user-data finished successfully.", "deploy");
					}
					return;
				}

				// If cloud-init finished but we haven't seen "Deployment complete!", wait a bit more
				if (clean.includes("Cloud-init v.") && clean.includes("finished") && i >= 12) {
					send("Cloud-init finished. Checking if deployment completed...", "deploy");
					if (i >= 18) {
						send("❌ Error: Cloud-init finished but no deployment completion signal found. The build likely failed.", "deploy");
						throw new Error("Deployment did not complete successfully. See deployment logs for Docker or build errors.");
					}
				}
			}
		} catch (e: any) {
			consecutiveErrors++;
			const errorMsg = e.message ?? String(e);
			const sanitized = sanitizeConsoleOutput(errorMsg.replace(/[\u2190-\u21FF\u2600-\u26FF\u2700-\u27BF]/g, ""));

			// Fail fast on explicit user-data/cloud-init script failures instead of continuing the polling loop.
			if (
				cloudInitFailureDetected ||
				errorMsg.includes("Deployment failed during instance initialization (Cloud-init error)") ||
				errorMsg.includes("Deployment did not complete successfully")
			) {
				throw e instanceof Error ? e : new Error(sanitized);
			}

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
		await new Promise(r => setTimeout(r, 5_000));
	}

	if (cloudInitFailureDetected) {
		send("⚠️ Cloud-init failure was detected. Proceeding to check if application is running despite the failure...", "deploy");
	}
}

export async function runPreCurlDiagnostics(params: {
	instanceId: string;
	region: string;
	send: SendFn;
	containerName?: string;
	tail?: number;
}): Promise<{ output: string; sawStartupSignal: boolean }> {
	const {
		instanceId,
		region,
		send,
		containerName = DEFAULT_DIAGNOSTIC_CONTAINER,
		tail = DIAGNOSTIC_LOG_TAIL,
	} = params;

	send(`diagnostics:docker_logs:start container=${containerName} tail=${tail}`, "deploy");

	const safeContainerName = containerName.replace(/'/g, "'\"'\"'");
	const safeTail = Number.isFinite(tail) && tail > 0 ? Math.floor(tail) : DIAGNOSTIC_LOG_TAIL;
	const script = `
set +e
if ! command -v docker >/dev/null 2>&1; then
  echo "[diagnostics] docker CLI not found on instance"
  exit 0
fi
if docker ps -a --format '{{.Names}}' | grep -Fxq '${safeContainerName}'; then
  echo "[diagnostics] collecting docker logs for ${safeContainerName}"
  docker logs --tail ${safeTail} ${safeContainerName} 2>&1 || true
else
  echo "[diagnostics] container '${safeContainerName}' not found; continuing to curl checks"
fi
`.trim();

	let output = "";
	try {
		const result = await runRedeployViaSsm({ instanceId, region, script, send });
		output = result.output || "";
	} catch (error: any) {
		send(
			`[diagnostics] failed to collect docker logs via SSM: ${error?.message ?? String(error)}. Continuing...`,
			"deploy"
		);
	}

	send("diagnostics:docker_logs:end", "deploy");
	return { output, sawStartupSignal: hasDockerStartupSuccessSignal(output) };
}

function hasDockerStartupSuccessSignal(logOutput: string): boolean {
	const text = (logOutput || "").toLowerCase();
	if (!text.trim()) return false;
	const patterns = [
		/\bserver (is )?(listening|started|running)\b/,
		/\bready in\b/,
		/\bapplication startup complete\b/,
		/\bhttp server listening\b/,
		/\blistening on (port|0\.0\.0\.0|http)/,
		/\bstarted successfully\b/,
	];
	return patterns.some((p) => p.test(text));
}

export async function detectRespondingPort(
	publicIp: string,
	services: ServiceDef[],
	instanceId: string,
	region: string,
	ws: any,
	send: SendFn,
	options?: {
		dockerSignalAttempts?: number;
		dockerSignalPollMs?: number;
		curlAttempts?: number;
		curlPollMs?: number;
	}
): Promise<number | null> {
	const dockerSignalAttempts = options?.dockerSignalAttempts ?? 12;
	const dockerSignalPollMs = options?.dockerSignalPollMs ?? 5000;
	const curlAttempts = options?.curlAttempts ?? 12;
	const curlPollMs = options?.curlPollMs ?? 5000;
	let sawDockerStartupSignal = false;

	send("Waiting for startup signal in container logs before curl checks...", "deploy");
	for (let attempt = 1; attempt <= dockerSignalAttempts; attempt++) {
		const diagnostic = await runPreCurlDiagnostics({ instanceId, region, send });
		if (diagnostic.sawStartupSignal) {
			sawDockerStartupSignal = true;
			send(`Startup signal found in docker logs (attempt ${attempt}/${dockerSignalAttempts}).`, "deploy");
			break;
		}
		if (attempt < dockerSignalAttempts) {
			send(`No startup signal in docker logs yet (attempt ${attempt}/${dockerSignalAttempts}).`, "deploy");
			await new Promise((r) => setTimeout(r, dockerSignalPollMs));
		}
	}

	if (!sawDockerStartupSignal) {
		send(
			"No startup signal detected in docker logs; proceeding with curl checks as fallback.",
			"deploy"
		);
	}

	try {
		const { runCommandLiveWithWebSocket } = await import("@/server-helper");
		const devNull = process.platform === "win32" ? "NUL" : "/dev/null";
		const candidates = Array.from(new Set([80, 8080, ...services.map(s => s.port).filter(Boolean)]));
		send("Waiting for application to be ready (this may take a minute)...", "deploy");
		send("diagnostics:curl:start", "deploy");
		for (let attempt = 1; attempt <= curlAttempts; attempt++) {
			for (const port of candidates) {
				try {
					const code = (await runCommandLiveWithWebSocket("curl", ["-s", "-o", devNull, "-w", "%{http_code}", "--connect-timeout", "4", `http://${publicIp}:${port}`], ws, "deploy")).trim();
					if (code && code !== "000" && (code.startsWith("2") || code.startsWith("3") || code.startsWith("4"))) {
						send(`Detected responding port ${port} (HTTP ${code})`, "deploy");
						send("diagnostics:curl:end", "deploy");
						return port;
					}
				} catch { /* try next */ }
			}
			if (attempt < curlAttempts) {
				await new Promise(r => setTimeout(r, curlPollMs));
			}
		}
	} catch { /* curl unavailable */ }
	send("diagnostics:curl:end", "deploy");
	return null;
}

function buildServiceUrls(
	deployConfig: DeployConfig,
	services: ServiceDef[],
	repoName: string,
	publicIp: string,
	certificateArn: string,
): { baseUrl: string; serviceUrls: Map<string, string> } {
	const serviceUrls = new Map<string, string>();
	const customHost = normalizeDomain(deployConfig.liveUrl ?? undefined);
	const scheme = certificateArn ? "https" : "http";
	const customBaseUrl = customHost ? `${scheme}://${customHost}` : "";
	const ec2Config = (deployConfig.ec2 || {}) as EC2Details;
	let baseUrl: string;
	if (deployConfig.serviceName) {
		const host = customHost || buildServiceHostname(deployConfig.serviceName, deployConfig.serviceName);
		baseUrl = host ? `${scheme}://${host}` : ec2Config?.baseUrl || `http://${publicIp}`;
		serviceUrls.set(services[0]?.name || repoName, baseUrl);
	} else {
		baseUrl = customBaseUrl || ec2Config?.baseUrl || `http://${publicIp}`;
		for (const svc of services) serviceUrls.set(svc.name, baseUrl);
	}
	return { baseUrl, serviceUrls };
}

function normalizePathForMatch(p?: string | null): string {
	return (p ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "").trim().toLowerCase();
}

function resolveServices(repoName: string, deployConfig: DeployConfig, multi: MultiServiceConfig): ServiceDef[] {
	if (multi.isMultiService && multi.services.length > 0) {
		const allServices = multi.services.map(s => ({
			name: s.name,
			dir: s.workdir,
			port: s.port || 8080,
			isMonorepo: multi.isMonorepo || false,
			relativePath: s.relativePath,
			framework: s.framework,
			language: s.language,
		}));

		const scanResultsCasted = deployConfig.scanResults && typeof deployConfig.scanResults === "object" && "services" in deployConfig.scanResults
			? (deployConfig.scanResults as Record<string, unknown>).services as Array<{ build_context: string }> | undefined
			: undefined;
		
		const mainService = scanResultsCasted?.[0];
		const requestedWorkdir = normalizePathForMatch(mainService?.build_context);
		if (requestedWorkdir && requestedWorkdir !== ".") {
			const byWorkdir = allServices.find((svc) => {
				const svcDir = normalizePathForMatch(svc.dir);
				const svcRelativePath = normalizePathForMatch(svc.relativePath);
				return svcDir === requestedWorkdir || svcRelativePath === requestedWorkdir;
			});
			if (byWorkdir) {
				return [byWorkdir];
			}
		}

		const serviceName = deployConfig.serviceName?.trim();
		if (serviceName?.startsWith(`${repoName}-`)) {
			const suffix = serviceName.slice(repoName.length + 1).toLowerCase();
			const byName = allServices.find((svc) => svc.name.toLowerCase() === suffix);
			if (byName) {
				return [byName];
			}
		}

		return allServices;
	}
	const scanServices = deployConfig.scanResults && typeof deployConfig.scanResults === "object" && "services" in deployConfig.scanResults
		? (deployConfig.scanResults as Record<string, unknown>).services as Array<{ port?: number }> | undefined
		: undefined;
	
	const mainServicePort = scanServices?.[0]?.port || 8080;
	return [{ name: repoName, dir: ".", port: mainServicePort }];
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
	const certificateArn = config.EC2_ACM_CERTIFICATE_ARN?.trim() || "";
	const ec2ConfigMain = (deployConfig.ec2 || {}) as EC2Details;
	const existingInstanceId = ec2ConfigMain?.instanceId?.trim() || "";

	const services = resolveServices(repoName, deployConfig, multiServiceConfig);
	const net = await ensureNetworking(deployConfig, repoName, region, services, multiServiceConfig, ws, send);
	const amiId = ec2ConfigMain?.amiId?.trim() || await getLatestAMI(region, ws);
	const { envBase64 } = buildEnvBase64(deployConfig.envVars || "", dbConnectionString, undefined);

	let mainPort = "";
	let wsPort = "";
	for (const svc of services) {
		const p = svc.port || 8080;
		if (svc.name.toLowerCase().includes("websocket")) wsPort = String(p);
		else if (!mainPort) mainPort = String(p);
	}
	if (!mainPort) mainPort = "8080";

	// ── Redeploy path: reuse existing running instance via SSM ──
	if (existingInstanceId) {
		let state = await getInstanceState(existingInstanceId, region, ws);
		if (state === "pending") {
			send("Existing instance is still starting; waiting until it is running...", "deploy");
			await runAWSCommand(
				["ec2", "wait", "instance-running", "--instance-ids", existingInstanceId, "--region", region],
				ws,
				"deploy"
			);
			state = await getInstanceState(existingInstanceId, region, ws);
		}
		if (state === "running") {
			return redeployInstance({
				deployConfig, existingInstanceId, region, services, repoName, token,
				envBase64, mainPort, net, amiId, certificateArn, ws, send,
			});
		}
		if (state) {
			send(
				`Saved instance ${existingInstanceId} is "${state}" (not running). Launching a new instance instead.`,
				"deploy"
			);
		} else {
			send(
				`Could not find instance ${existingInstanceId} in region ${region}. Launching a new instance. If the instance still exists, set the deployment AWS region to match.`,
				"deploy"
			);
		}
	}

	// ── Fresh deploy path: launch new instance ──
	const instanceName = generateResourceName(repoName, "ec2");
	const launchResult = await launchNewInstance({
		deployConfig, instanceName, region, services, token, dbConnectionString: undefined,
		envBase64, mainPort, wsPort, net, amiId, ws, send,
	});

	const { instanceId, publicIp, detectedPort, success: launchSuccess } = launchResult;

	// If instance was launched but deploy failed (SSM or port), return failure with instance details so they get persisted for reuse
	if (!launchSuccess || detectedPort == null) {
		return {
			success: false,
			baseUrl: "",
			serviceUrls: new Map(),
			instanceId,
			publicIp,
			vpcId: net.vpcId,
			subnetId: net.subnetIds[0],
			securityGroupId: net.securityGroupId,
			amiId,
		};
	}

	const customHost = normalizeDomain(deployConfig.liveUrl ?? undefined);
	const scheme = certificateArn ? "https" : "http";
	const customBaseUrl = customHost ? `${scheme}://${customHost}` : "";
	let baseUrl = customBaseUrl || (detectedPort === 80 || detectedPort === 8080 ? `http://${publicIp}` : `http://${publicIp}:${detectedPort}`);
	let serviceUrls = new Map<string, string>();
	let sharedAlbDns: string | undefined;

	try {
		const alb = await configureAlb({
			deployConfig, instanceId, existingInstanceId, services, repoName, net, region, certificateArn, ws, send,
		});
		sharedAlbDns = alb.sharedAlbDns;
		serviceUrls = alb.serviceUrls;
		if (services.length === 1) baseUrl = serviceUrls.get(services[0].name) || baseUrl;
	} catch (e: any) {
		send(`⚠️ Warning: ALB configuration skipped or failed: ${e.message}`, "deploy");
		send(`Falling back to direct instance IP.`, "deploy");
		const fallbackBase = detectedPort === 80 || detectedPort === 8080 ? `http://${publicIp}` : `http://${publicIp}:${detectedPort}`;
		for (const svc of services) {
			serviceUrls.set(svc.name, services.length === 1 ? (customBaseUrl || fallbackBase) : `http://${publicIp}:${svc.port}`);
		}
	}

	send("✅ Instance is responding and configured!", "deploy");
	send(`Application URL: ${baseUrl}`, "done");
	send(`Instance ID: ${instanceId}`, "done");

	return { success: true, baseUrl, serviceUrls, instanceId, publicIp, vpcId: net.vpcId, subnetId: net.subnetIds[0], securityGroupId: net.securityGroupId, amiId, sharedAlbDns };
}

// ─── ECR-based deploy (used by CodeBuild pipeline) ──────────────────────

export async function handleEC2FromEcr(params: {
	deployConfig: DeployConfig;
	imageUri: string;
	imageTag: string;
	ecrRegistry: string;
	ecrRepoName: string;
	ecrPasswordB64: string;
	multiServiceConfig: MultiServiceConfig;
	dbConnectionString?: string;
	ws: any;
	send: SendFn;
}): Promise<EC2Result> {
	const { deployConfig, imageUri, imageTag, ecrRegistry, ecrRepoName, ecrPasswordB64, multiServiceConfig, dbConnectionString, ws, send } = params;
	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";
	const certificateArn = config.EC2_ACM_CERTIFICATE_ARN?.trim() || "";
	const ec2ConfigEcr = (deployConfig.ec2 || {}) as EC2Details;
	const existingInstanceId = ec2ConfigEcr?.instanceId?.trim();

	const services = resolveServices(repoName, deployConfig, multiServiceConfig);
	const net = await ensureNetworking(deployConfig, repoName, region, services, multiServiceConfig, ws, send);
	const amiId = ec2ConfigEcr?.amiId?.trim() || await getLatestAMI(region, ws);
	const { envBase64 } = buildEnvBase64(deployConfig.envVars || "", dbConnectionString, undefined);

	let mainPort = "";
	for (const svc of services) {
		const p = svc.port || 8080;
		if (!mainPort) mainPort = String(p);
	}
	if (!mainPort) mainPort = "8080";

	const scanResults = deployConfig.scanResults;
	const scanResultsCasted = scanResults && typeof scanResults === "object" && "docker_compose" in scanResults
		? (scanResults as Record<string, unknown>)
		: ({} as Record<string, unknown>);
	
	const hasCompose = !!(scanResultsCasted.docker_compose) && ((scanResultsCasted.services as any)?.length || 0) > 1;

	// Build the SSM deploy script based on compose or single-service
	const buildDeployScript = (): string => {
		if (hasCompose) {
			const dockerCompose = (scanResultsCasted.docker_compose as string) || "";
			const services = ((scanResultsCasted.services as unknown) as Array<{ name: string; port: number }>) || [];
			
			return buildEcrComposeDeployScript({
				ecrRegistry,
				ecrRepoName,
				imageTag,
				region,
				envFileContentBase64: envBase64,
				composeContent: dockerCompose,
				services: services.map((s) => ({ name: s.name, port: s.port })),
				ecrPasswordB64,
			});
		}
		return buildEcrDeployScript({
			ecrRegistry,
			imageUri,
			region,
			envFileContentBase64: envBase64,
			mainPort,
			ecrPasswordB64,
		});
	};

	// ── Redeploy path: reuse existing running instance ──
	if (existingInstanceId) {
		let state = await getInstanceState(existingInstanceId, region, ws);
		if (state === "pending") {
			send("Existing instance is still starting; waiting...", "deploy");
			await runAWSCommand(
				["ec2", "wait", "instance-running", "--instance-ids", existingInstanceId, "--region", region],
				ws, "deploy",
			);
			state = await getInstanceState(existingInstanceId, region, ws);
		}
		if (state === "running") {
			send("Deploying ECR image to existing instance...", "deploy");
			await ensureInstanceSsmReady(existingInstanceId, region, ws, send);
			const script = buildDeployScript();
			const ssmResult = await runRedeployViaSsm({ instanceId: existingInstanceId, region, script, send });

			if (!ssmResult.success) {
				send("❌ ECR deploy failed. Check logs above.", "deploy");
				const ec2EcrCasted = (deployConfig.ec2 || {}) as EC2Details;
				return {
					success: false,
					baseUrl: deployConfig.liveUrl || ec2EcrCasted?.baseUrl || "",
					serviceUrls: new Map(),
					instanceId: existingInstanceId,
					publicIp: ec2EcrCasted?.publicIp || "",
					...net, subnetId: net.subnetIds[0], amiId,
				};
			}

			const publicIp = ((deployConfig.ec2 || {}) as EC2Details)?.publicIp?.trim() || (
				await runAWSCommand(["ec2", "describe-instances", "--instance-ids", existingInstanceId, "--query", "Reservations[0].Instances[0].PublicIpAddress", "--output", "text", "--region", region], ws, "deploy")
			).trim();

			const { baseUrl, serviceUrls } = buildServiceUrls(deployConfig, services, repoName, publicIp, certificateArn);
			send("✅ ECR deploy complete.", "done");
			send(`Application URL: ${baseUrl}`, "done");
			return { success: true, baseUrl, serviceUrls, instanceId: existingInstanceId, publicIp, ...net, subnetId: net.subnetIds[0], amiId };
		}
		if (state) {
			send(`Saved instance ${existingInstanceId} is "${state}". Launching new instance.`, "deploy");
		} else {
			send(`Could not find instance ${existingInstanceId}. Launching new instance.`, "deploy");
		}
	}

	// ── Fresh instance path ──
	const keyName = "smartdeploy";
	await ensureSSMInstanceProfile(region, ws);
	await ensureKeyPair(keyName, region, ws);

	const ecrNginxConf = deployConfig.scanResults && typeof deployConfig.scanResults === "object" && "nginx_conf" in deployConfig.scanResults
		? ((deployConfig.scanResults as Record<string, unknown>)?.nginx_conf as string) || ""
		: "";
	const userData = generateEcrUserDataScript(mainPort, ecrNginxConf);
	const tmpFile = path.join(os.tmpdir(), `ec2-userdata-ecr-${Date.now()}.sh`);
	fs.writeFileSync(tmpFile, userData, "utf8");
	const fileUri = "file://" + path.resolve(tmpFile).replace(/\\/g, "/");

	const instanceName = generateResourceName(repoName, "ec2");
	let instanceId: string;
	try {
		const ec2Config = (deployConfig.ec2 || {}) as EC2Details;
		const instanceType = resolveEc2InstanceType(ec2Config.instanceType);
		send(`Launching EC2 instance: ${instanceName} (${instanceType})...`, "deploy");
		const amiMinRootVolumeGiB = await getAmiMinimumRootVolumeGiB(amiId, region, ws);
		const rootVolumeGiB = Math.max(30, amiMinRootVolumeGiB);
		const blockDeviceMapping = `DeviceName=/dev/xvda,Ebs={VolumeSize=${rootVolumeGiB},VolumeType=gp3,DeleteOnTermination=true}`;
		const out = await runAWSCommand([
			"ec2", "run-instances",
			"--image-id", amiId,
			"--instance-type", instanceType,
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
		send(`Instance launched: ${instanceId}`, "deploy");
	} finally {
		try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
	}

	send("Waiting for instance to be running...", "deploy");
	await runAWSCommand(["ec2", "wait", "instance-running", "--instance-ids", instanceId, "--region", region], ws, "deploy");

	const publicIp = (await runAWSCommand(["ec2", "describe-instances", "--instance-ids", instanceId, "--query", "Reservations[0].Instances[0].PublicIpAddress", "--output", "text", "--region", region], ws, "deploy")).trim();
	send(`Instance public IP: ${publicIp}`, "deploy");

	// Wait for user-data (package install only); look for "Instance setup complete!"
	await waitForUserData(instanceId, region, ws, send);

	send("Waiting for SSM agent...", "deploy");
	await ensureInstanceSsmReady(instanceId, region, ws, send);

	send("Deploying ECR image via SSM...", "deploy");
	const script = buildDeployScript();
	const ssmResult = await runRedeployViaSsm({ instanceId, region, script, send });
	if (!ssmResult.success) {
		send("❌ Container deployment from ECR failed. Instance will be reused on next deploy.", "deploy");
		return { success: false, baseUrl: "", serviceUrls: new Map(), instanceId, publicIp, vpcId: net.vpcId, subnetId: net.subnetIds[0], securityGroupId: net.securityGroupId, amiId };
	}

	const detectedPort = await detectRespondingPort(publicIp, services, instanceId, region, ws, send);
	if (!detectedPort) {
		send("Instance failed to respond on any known ports. Instance will be reused on next deploy.", "deploy");
		return { success: false, baseUrl: "", serviceUrls: new Map(), instanceId, publicIp, vpcId: net.vpcId, subnetId: net.subnetIds[0], securityGroupId: net.securityGroupId, amiId };
	}

	const customHost = normalizeDomain(deployConfig.liveUrl ?? undefined);
	const scheme = certificateArn ? "https" : "http";
	const customBaseUrl = customHost ? `${scheme}://${customHost}` : "";
	let baseUrl = customBaseUrl || (detectedPort === 80 || detectedPort === 8080 ? `http://${publicIp}` : `http://${publicIp}:${detectedPort}`);
	let serviceUrls = new Map<string, string>();
	let sharedAlbDns: string | undefined;

	try {
		const alb = await configureAlb({
			deployConfig, instanceId, existingInstanceId, services, repoName, net, region, certificateArn, ws, send,
		});
		sharedAlbDns = alb.sharedAlbDns;
		serviceUrls = alb.serviceUrls;
		if (services.length === 1) baseUrl = serviceUrls.get(services[0].name) || baseUrl;
	} catch (e: any) {
		send(`⚠️ ALB configuration skipped: ${e.message}`, "deploy");
		const fallbackBase = detectedPort === 80 || detectedPort === 8080 ? `http://${publicIp}` : `http://${publicIp}:${detectedPort}`;
		for (const svc of services) serviceUrls.set(svc.name, services.length === 1 ? (customBaseUrl || fallbackBase) : `http://${publicIp}:${svc.port}`);
	}

	send("✅ Instance is responding and configured!", "deploy");
	send(`Application URL: ${baseUrl}`, "done");
	send(`Instance ID: ${instanceId}`, "done");

	return { success: true, baseUrl, serviceUrls, instanceId, publicIp, vpcId: net.vpcId, subnetId: net.subnetIds[0], securityGroupId: net.securityGroupId, amiId, sharedAlbDns };
}

