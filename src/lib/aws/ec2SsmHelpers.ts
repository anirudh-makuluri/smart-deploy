import fs from "fs";
import os from "os";
import path from "path";
import config from "../../config";
import { createWebSocketLogger } from "../websocketLogger";
import { runAWSCommand } from "./awsHelpers";
import {
	SSMClient,
	SendCommandCommand,
	GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm";
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { githubAuthenticatedCloneUrl } from "../githubGitAuth";
import { canonicalDockerfileDeployPath, inferSingleDockerfileBuild } from "../dockerfileDeployPath";

const SSM_ROLE_NAME = "smartdeploy-ec2-ssm-role";
export const SSM_PROFILE_NAME = "smartdeploy-ec2-ssm-profile";
const SSM_MANAGED_POLICY_ARN =
	"arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore";

function getClientConfig(region: string) {
	const conf: {
		region: string;
		credentials?: { accessKeyId: string; secretAccessKey: string };
	} = { region };
	if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
		conf.credentials = {
			accessKeyId: config.AWS_ACCESS_KEY_ID,
			secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
		};
	}
	return conf;
}

/**
 * Ensures an IAM role and instance profile exist for EC2 instances to be managed by SSM.
 * Returns the instance profile name to pass to run-instances.
 */
export async function ensureSSMInstanceProfile(
	region: string,
	ws: any
): Promise<string> {
	const send = createWebSocketLogger(ws);

	try {
		await runAWSCommand(
			[
				"iam",
				"get-instance-profile",
				"--instance-profile-name",
				SSM_PROFILE_NAME,
			],
			ws,
			"setup"
		);
		send(`SSM instance profile ${SSM_PROFILE_NAME} already exists`, "setup");
		return SSM_PROFILE_NAME;
	} catch {
		// Profile does not exist; create role and profile
	}

	send(`Creating IAM role and instance profile for SSM...`, "setup");

	const trustPolicy = JSON.stringify({
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Principal: { Service: "ec2.amazonaws.com" },
				Action: "sts:AssumeRole",
			},
		],
	});

	// Write policy to temp file to avoid Windows PowerShell JSON escaping issues
	const policyFile = path.join(os.tmpdir(), `iam-trust-policy-${Date.now()}.json`);
	const policyFileUri = "file://" + path.resolve(policyFile).replace(/\\/g, "/");

	try {
		fs.writeFileSync(policyFile, trustPolicy, "utf8");
		await runAWSCommand(
			[
				"iam",
				"create-role",
				"--role-name",
				SSM_ROLE_NAME,
				"--assume-role-policy-document",
				policyFileUri,
			],
			ws,
			"setup"
		);
	} finally {
		try {
			fs.unlinkSync(policyFile);
		} catch {
			// ignore cleanup errors
		}
	}

	await runAWSCommand(
		[
			"iam",
			"attach-role-policy",
			"--role-name",
			SSM_ROLE_NAME,
			"--policy-arn",
			SSM_MANAGED_POLICY_ARN,
		],
		ws,
		"setup"
	);

	await runAWSCommand(
		["iam", "create-instance-profile", "--instance-profile-name", SSM_PROFILE_NAME],
		ws,
		"setup"
	);

	await runAWSCommand(
		[
			"iam",
			"add-role-to-instance-profile",
			"--instance-profile-name",
			SSM_PROFILE_NAME,
			"--role-name",
			SSM_ROLE_NAME,
		],
		ws,
		"setup"
	);

	// IAM is eventually consistent; brief wait before using the profile
	await new Promise((r) => setTimeout(r, 5000));
	send(`SSM instance profile ${SSM_PROFILE_NAME} created`, "setup");
	return SSM_PROFILE_NAME;
}

/**
 * Returns the current EC2 instance state (e.g. "running", "stopped") or undefined if not found.
 * Uses the AWS SDK instead of CLI text output so we never mis-read AWS CLI's literal "None"
 * (printed when JMESPath returns null for empty Reservations).
 */
export async function getInstanceState(
	instanceId: string,
	region: string,
	_ws: unknown
): Promise<string | undefined> {
	const client = new EC2Client(getClientConfig(region));
	try {
		const resp = await client.send(
			new DescribeInstancesCommand({ InstanceIds: [instanceId] })
		);
		for (const reservation of resp.Reservations ?? []) {
			for (const inst of reservation.Instances ?? []) {
				if (inst.InstanceId === instanceId) {
					const name = inst.State?.Name;
					if (name) return name;
				}
			}
		}
	} catch (e: unknown) {
		const err = e as { name?: string; Code?: string };
		const code = err.name || err.Code;
		if (
			code === "InvalidInstanceID.NotFound" ||
			code === "InvalidInstanceID.Malformed" ||
			(typeof e === "object" &&
				e !== null &&
				String((e as Error).message || "").includes("InvalidInstanceID"))
		) {
			return undefined;
		}
		throw e;
	}
	return undefined;
}

/** Reject path traversal in Dockerfile keys from scan_results. */
function isSafeDockerfileRelPath(p: string): boolean {
	if (!p || p.includes("..")) return false;
	if (path.isAbsolute(p)) return false;
	return true;
}

/**
 * Align docker-compose `dockerfile:` values with canonicalDockerfileDeployPath so validation and builds match written files.
 */
function normalizeDockerfilePathsInCompose(compose: string): string {
	return compose.replace(/^([ \t]*dockerfile:\s*)([^\n]*)$/gim, (full, prefix: string, rhs: string) => {
		const hashIdx = rhs.indexOf("#");
		const valuePart = hashIdx >= 0 ? rhs.slice(0, hashIdx) : rhs;
		const comment = hashIdx >= 0 ? rhs.slice(hashIdx) : "";
		const trimmedRhs = valuePart.trimEnd();
		if (!trimmedRhs) return full;
		const qDouble = trimmedRhs.startsWith('"') && trimmedRhs.endsWith('"');
		const qSingle = trimmedRhs.startsWith("'") && trimmedRhs.endsWith("'");
		const inner = (qDouble || qSingle ? trimmedRhs.slice(1, -1) : trimmedRhs).trim();
		if (inner.includes("..")) return full;
		if (path.isAbsolute(inner)) return full;
		const normalized = canonicalDockerfileDeployPath(inner.replace(/^\.\//, ""));
		if (normalized === inner) return full;
		if (qDouble) return `${prefix}"${normalized}"${comment}`;
		if (qSingle) return `${prefix}'${normalized}'${comment}`;
		return `${prefix}${normalized}${comment}`;
	});
}

/**
 * Ensures every service in a compose YAML has `env_file` referencing `.env`,
 * so that env vars written to the repo root are available inside containers.
 */
/**
 * Generates bash commands to write Dockerfiles from scan_results.dockerfiles
 * into the cloned repo at the paths given by each key (e.g. client/Dockerfile, apps/web/Dockerfile).
 * Keys that name a directory only (e.g. "client") are written to client/Dockerfile.
 */
function buildDockerfileWriteScript(dockerfiles: Record<string, string>): string {
	const entries = Object.entries(dockerfiles || {})
		.map(([filePath, content]) => {
			const raw = filePath.replace(/^\.\//, "").replace(/\\/g, "/");
			const safePath = canonicalDockerfileDeployPath(raw);
			return [safePath, content] as [string, string];
		})
		.filter(([safePath]) => isSafeDockerfileRelPath(safePath));

	if (entries.length === 0) return "";

	return entries
		.map(([safePath, content]) => {
			const lastSlash = safePath.lastIndexOf("/");
			const dir = lastSlash >= 0 ? safePath.slice(0, lastSlash) : "";
			const mkdirLine =
				dir.length > 0
					? `mkdir -p "${dir.replace(/"/g, '\\"')}"\n`
					: "";
			return `
echo "Writing Dockerfile from scan_results to ${safePath}..."
${mkdirLine}cat > "${safePath.replace(/"/g, '\\"')}" << 'DOCKERFILEEOF'
${content}
DOCKERFILEEOF
`;
		})
		.join("\n");
}

/**
 * Generates bash commands to write docker-compose.yml from scan_results.docker_compose
 * into the cloned repo.
 */
function buildComposeWriteScript(dockerCompose: string): string {
	if (!dockerCompose) return "";
	const normalizedCompose = normalizeDockerfilePathsInCompose(dockerCompose);
	return `
echo "Writing docker-compose.yml from scan_results..."
cat > docker-compose.yml << 'COMPOSEEOF'
${normalizedCompose}
COMPOSEEOF
`;
}

function bashSingleQuoted(s: string): string {
	return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Generates bash commands to build and run Docker containers.
 * Uses docker-compose if a compose file exists; otherwise falls back to
 * single-service docker build + docker run.
 */
function buildDockerRunScript(
	mainPort: string,
	singleDocker?: { dockerfile: string; context: string } | null,
): string {
	const singleBuildLines =
		singleDocker != null
			? `
    echo "No docker-compose found. Building single-service image from ${singleDocker.dockerfile} (context: ${singleDocker.context})..."
    if [ ! -f ${bashSingleQuoted(singleDocker.dockerfile)} ]; then
        echo "ERROR: Dockerfile not found at ${singleDocker.dockerfile}"
        echo "Repo root: $(pwd)"
        ls -la
        exit 1
    fi
    docker build -f ${bashSingleQuoted(singleDocker.dockerfile)} -t smartdeploy-app ${bashSingleQuoted(singleDocker.context)}
`
			: `
    echo "No docker-compose found. Building single-service Docker image..."
    if [ ! -f Dockerfile ]; then
        echo "ERROR: No Dockerfile found in repository root."
        exit 1
    fi
    docker build -t smartdeploy-app .
`;

	return `
if [ -f docker-compose.yml ] || [ -f docker-compose.yaml ] || [ -f compose.yml ] || [ -f compose.yaml ]; then
    echo "Building and starting containers with docker-compose..."
    COMPOSE_FILE=""
    if [ -f docker-compose.yml ]; then COMPOSE_FILE="docker-compose.yml"; fi
    if [ -z "$COMPOSE_FILE" ] && [ -f docker-compose.yaml ]; then COMPOSE_FILE="docker-compose.yaml"; fi
    if [ -z "$COMPOSE_FILE" ] && [ -f compose.yml ]; then COMPOSE_FILE="compose.yml"; fi
    if [ -z "$COMPOSE_FILE" ] && [ -f compose.yaml ]; then COMPOSE_FILE="compose.yaml"; fi

    echo "Using compose file: $COMPOSE_FILE"

    echo "Validating dockerfile paths referenced by compose..."
    DOCKERFILES=$(awk '/^[[:space:]]*dockerfile:[[:space:]]*/{print $2}' "$COMPOSE_FILE" | tr -d '\r' | sort -u)
    if [ -n "$DOCKERFILES" ]; then
        for df in $DOCKERFILES; do
            if [ ! -f "$df" ]; then
                echo "ERROR: dockerfile path referenced by compose does not exist: $df"
                echo "Repo root: $(pwd)"
                echo "Top-level listing:"
                ls -la
                echo "apps/ listing (if exists):"
                ls -la apps 2>/dev/null || true
                exit 1
            fi
        done
    else
        echo "No explicit dockerfile: entries found in compose."
    fi
    docker-compose up -d --build
else
${singleBuildLines}
    docker rm -f smartdeploy-app 2>/dev/null || true
    docker run -d --name smartdeploy-app --env-file .env -p ${mainPort || "8080"}:${mainPort || "8080"} --restart unless-stopped smartdeploy-app
fi

docker system prune -af --volumes 2>/dev/null || true
`;
}

/**
 * Builds the bash script for the FIRST deploy of containers via SSM.
 * Called after user-data has finished (packages installed, repo cloned, SSM ready).
 * Writes Dockerfiles + docker-compose.yml from scan_results if missing, then builds/runs.
 */
type ScanServiceForDocker = { dockerfile_path?: string; build_context?: string };

export function buildFirstDeployScript(params: {
	envFileContentBase64: string;
	dockerCompose: string;
	dockerfiles: Record<string, string>;
	mainPort: string;
	scanServices?: ScanServiceForDocker[] | null;
}): string {
	const { envFileContentBase64, dockerCompose, dockerfiles, mainPort, scanServices } = params;

	const dockerfileScript = buildDockerfileWriteScript(dockerfiles);
	const composeScript = buildComposeWriteScript(dockerCompose);
	const singleDocker = inferSingleDockerfileBuild(dockerfiles, scanServices);
	const runScript = buildDockerRunScript(mainPort, singleDocker);

	return `set -e
echo "=== SSM first deploy: writing artifacts and building ==="

cd /home/ec2-user/app

${envFileContentBase64 ? `echo '${envFileContentBase64}' | base64 -d > .env` : ""}

${dockerfileScript}

${composeScript}

${runScript}

echo "====================================== Deployment script complete! ======================================"
`;
}

/**
 * Builds the bash script run on the instance for redeploy (git pull + rebuild).
 * Uses scan_results to write Dockerfiles and docker-compose.yml if missing.
 */
export function buildRedeployScript(params: {
	repoUrl: string;
	branch: string;
	token: string;
	commitSha?: string;
	envFileContentBase64: string;
	dockerCompose: string;
	dockerfiles: Record<string, string>;
	mainPort: string;
	scanServices?: ScanServiceForDocker[] | null;
}): string {
	const {
		repoUrl,
		branch,
		token,
		commitSha,
		envFileContentBase64,
		dockerCompose,
		dockerfiles,
		mainPort,
		scanServices,
	} = params;
	const authenticatedUrl = githubAuthenticatedCloneUrl(repoUrl, token);

	const dockerfileScript = buildDockerfileWriteScript(dockerfiles);
	const composeScript = buildComposeWriteScript(dockerCompose);
	const singleDocker = inferSingleDockerfileBuild(dockerfiles, scanServices);
	const runScript = buildDockerRunScript(mainPort, singleDocker);

	return `set -e
echo "=== Disk space before redeploy ==="
df -h /

cd /home/ec2-user/app

docker-compose down 2>/dev/null || docker rm -f smartdeploy-app 2>/dev/null || true
docker system prune -af --volumes 2>/dev/null || true
git gc --aggressive --prune=now 2>/dev/null || true

git remote set-url origin '${authenticatedUrl}'
git fetch origin
git checkout ${branch}
git reset --hard origin/${branch}
${commitSha ? `git checkout ${commitSha}` : ""}
git gc --aggressive --prune=now 2>/dev/null || true

${envFileContentBase64 ? `echo '${envFileContentBase64}' | base64 -d > .env` : ""}

${dockerfileScript}

${composeScript}

${runScript}

echo "====================================== Redeploy complete! ======================================"
`;
}

/**
 * Returns true if the instance is registered with SSM (agent reporting).
 */
export async function isInstanceSsmManaged(
	instanceId: string,
	region: string,
	ws: any
): Promise<boolean> {
	try {
		const out = await runAWSCommand(
			[
				"ssm",
				"describe-instance-information",
				"--filters",
				`Key=InstanceIds,Values=${instanceId}`,
				"--query",
				"InstanceInformationList[0].InstanceId",
				"--output",
				"text",
				"--region",
				region,
			],
			ws,
			"deploy"
		);
		return (out || "").trim() === instanceId;
	} catch {
		return false;
	}
}

const SSM_REGISTRATION_TIMEOUT_MS = 3 * 60 * 1000;
const SSM_REGISTRATION_POLL_MS = 15 * 1000;

/**
 * Gathers network diagnostics for SSM registration failures (public IP, subnet, route to internet).
 */
async function getSsmRegistrationDiagnostics(
	instanceId: string,
	region: string,
	ws: any
): Promise<string> {
	try {
		const instRaw = await runAWSCommand(
			[
				"ec2",
				"describe-instances",
				"--instance-ids",
				instanceId,
				"--query",
				"Reservations[0].Instances[0].{PublicIp:PublicIpAddress,SubnetId:SubnetId,VpcId:VpcId,State:State.Name}",
				"--output",
				"json",
				"--region",
				region,
			],
			ws,
			"deploy"
		);
		const inst = JSON.parse(instRaw.trim()) as { PublicIp: string | null; SubnetId: string | null; VpcId: string | null; State: string };
		const publicIp = inst?.PublicIp ?? "none";
		const subnetId = inst?.SubnetId ?? "";
		const vpcId = inst?.VpcId ?? "";
		if (!subnetId) return ` Instance: ${publicIp}; subnet unknown.`;

		// Get route table for this subnet (explicit association or VPC main)
		let routesRaw: string;
		const rtBySubnet = await runAWSCommand(
			[
				"ec2",
				"describe-route-tables",
				"--filters",
				`Name=association.subnet-id,Values=${subnetId}`,
				"--query",
				"RouteTables[*].Routes[?DestinationCidrBlock=='0.0.0.0/0'].[GatewayId,NatGatewayId]",
				"--output",
				"json",
				"--region",
				region,
			],
			ws,
			"deploy"
		);
		routesRaw = rtBySubnet;
		const parsed = JSON.parse(routesRaw.trim());
		const routesArray = Array.isArray(parsed) ? parsed : [parsed];
		let flat = routesArray.flat(2).filter(Boolean) as string[];
		if (flat.length === 0 && vpcId) {
			const rtMain = await runAWSCommand(
				[
					"ec2",
					"describe-route-tables",
					"--filters",
					`Name=vpc-id,Values=${vpcId}`,
					"Name=association.main,Values=true",
					"--query",
					"RouteTables[*].Routes[?DestinationCidrBlock=='0.0.0.0/0'].[GatewayId,NatGatewayId]",
					"--output",
					"json",
					"--region",
					region,
				],
				ws,
				"deploy"
			);
			const mainParsed = JSON.parse(rtMain.trim());
			flat = (Array.isArray(mainParsed) ? mainParsed : [mainParsed]).flat(2).filter(Boolean) as string[];
		}
		const hasIgw = flat.some((id) => id?.startsWith("igw-"));
		const hasNat = flat.some((id) => id?.startsWith("nat-"));
		const hasOutbound = hasIgw || hasNat;

		if (publicIp === "none" && !hasOutbound) {
			return ` Instance has no public IP and subnet has no 0.0.0.0/0 route to IGW/NAT — add a NAT Gateway or create VPC endpoints for SSM (ssm, ec2messages, ssmmessages) in this VPC.`;
		}
		if (publicIp === "none" && hasOutbound) {
			return ` Instance has no public IP (private subnet). Subnet has default route (NAT/IGW). If using private subnet, create VPC endpoints for SSM (ssm, ec2messages, ssmmessages) so the instance can reach SSM without internet.`;
		}
		if (hasOutbound) {
			return ` Instance has public IP ${publicIp} and subnet has internet route. SSM agent may not be running — reboot the instance in EC2 console (Instance state → Reboot), wait 2–3 min, then redeploy.`;
		}
		return ` Instance has public IP ${publicIp} but subnet has no 0.0.0.0/0 route — check subnet route table and add IGW or NAT.`;
	} catch {
		return "";
	}
}

/**
 * Ensures the instance is registered with SSM. If it is not (e.g. "Unidentified" in console),
 * attaches the SmartDeploy SSM instance profile and waits for the agent to register.
 */
export async function ensureInstanceSsmReady(
	instanceId: string,
	region: string,
	ws: any,
	send: (msg: string, stepId: string) => void
): Promise<void> {
	if (await isInstanceSsmManaged(instanceId, region, ws)) {
		send("Instance is registered with SSM.", "deploy");
		return;
	}


	// Get current IAM instance profile (ARN or "None")
	const currentProfileOut = await runAWSCommand(
		[
			"ec2",
			"describe-instances",
			"--instance-ids",
			instanceId,
			"--query",
			"Reservations[0].Instances[0].IamInstanceProfile.Arn",
			"--output",
			"text",
			"--region",
			region,
		],
		ws,
		"deploy"
	);
	const currentArn = (currentProfileOut || "").trim();
	const hasOurProfile = currentArn !== "None" && currentArn !== "" && currentArn.includes(SSM_PROFILE_NAME);

	if (!hasOurProfile) {
		send("Instance is not SSM-managed. Attaching SSM instance profile...", "deploy");
		await runAWSCommand(
			[
				"ec2",
				"modify-instance-attribute",
				"--instance-id",
				instanceId,
				"--iam-instance-profile",
				`Name=${SSM_PROFILE_NAME}`,
				"--region",
				region,
			],
			ws,
			"deploy"
		);
		send("SSM profile attached. Waiting for agent to register (up to 3 min)...", "deploy");
	} else {
		send("Instance has SSM profile but not yet registered. Waiting for agent (up to 3 min)...", "deploy");
	}

	const deadline = Date.now() + SSM_REGISTRATION_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, SSM_REGISTRATION_POLL_MS));
		if (await isInstanceSsmManaged(instanceId, region, ws)) {
			send("Instance is now registered with SSM.", "deploy");
			return;
		}
		send("Still waiting for SSM agent to register...", "deploy");
	}

	// If instance has our profile but still not registered, try one reboot (helps when profile was attached after launch)
	if (hasOurProfile) {
		send("Trying one reboot to let SSM agent pick up the instance profile...", "deploy");
		try {
			await runAWSCommand(
				["ec2", "reboot-instances", "--instance-ids", instanceId, "--region", region],
				ws,
				"deploy"
			);
			await new Promise((r) => setTimeout(r, 60_000)); // wait for reboot
			const rebootDeadline = Date.now() + SSM_REGISTRATION_TIMEOUT_MS;
			while (Date.now() < rebootDeadline) {
				await new Promise((r) => setTimeout(r, SSM_REGISTRATION_POLL_MS));
				if (await isInstanceSsmManaged(instanceId, region, ws)) {
					send("Instance is now registered with SSM after reboot.", "deploy");
					return;
				}
				send("Still waiting for SSM agent after reboot...", "deploy");
			}
		} catch {
			// ignore reboot errors, fall through to final error
		}
	}

	const diagnostics = await getSsmRegistrationDiagnostics(instanceId, region, ws);
	if (diagnostics) send("SSM diagnostic:" + diagnostics, "deploy");
	throw new Error(
		"Instance did not register with SSM. Common causes: (1) Instance has no outbound internet (e.g. private subnet without NAT). Add a NAT Gateway or create VPC endpoints for SSM (ssm, ec2messages, ssmmessages). (2) SSM agent not running — in EC2 console, reboot the instance and redeploy. (3) Wrong account/region. Fix network or reboot the instance in EC2 console, then redeploy." +
		(diagnostics ? diagnostics : "")
	);
}

// ─── ECR-based deploy scripts (used by CodeBuild pipeline) ──────────────

/**
 * Generates the SSM script for deploying from a pre-built ECR image
 * (single service, no docker-compose).
 */
export function buildEcrDeployScript(params: {
	ecrRegistry: string;
	imageUri: string;
	region: string;
	envFileContentBase64: string;
	mainPort: string;
	ecrPasswordB64: string;
}): string {
	const { ecrRegistry, imageUri, envFileContentBase64, mainPort, ecrPasswordB64 } = params;
	return `set -e
echo "=== Deploying from ECR ==="

echo '${ecrPasswordB64}' | base64 -d | docker login --username AWS --password-stdin ${ecrRegistry}

mkdir -p /home/ec2-user/app
cd /home/ec2-user/app

docker-compose down 2>/dev/null || docker rm -f smartdeploy-app 2>/dev/null || true
docker system prune -af --volumes 2>/dev/null || true

${envFileContentBase64 ? `echo '${envFileContentBase64}' | base64 -d > .env` : "touch .env"}

echo "Pulling image: ${imageUri}"
docker pull ${imageUri}

docker run -d --name smartdeploy-app \\
  --env-file .env \\
  -p ${mainPort || "8080"}:${mainPort || "8080"} \\
  --restart unless-stopped \\
  ${imageUri}

echo "====================================== Deploy from ECR complete! ======================================"
`;
}

/**
 * Generates the SSM script for deploying from ECR with docker-compose.
 * Replaces build directives with ECR image references.
 */
function replaceBuildSectionWithImage(
	composeContent: string,
	serviceName: string,
	imageUri: string,
): string {
	const lines = composeContent.split("\n");
	const rewritten: string[] = [];
	let currentService = "";
	let serviceIndent = -1;
	let skipIndent = -1;

	for (const line of lines) {
		const indent = line.match(/^\s*/)?.[0].length ?? 0;
		const trimmed = line.trim();
		const isServiceLine = trimmed.endsWith(":");

		if (currentService === serviceName && trimmed && indent <= serviceIndent && !trimmed.startsWith("#")) {
			currentService = "";
			serviceIndent = -1;
			skipIndent = -1;
		}

		if (isServiceLine) {
			const candidate = trimmed.slice(0, -1).trim();
			if (candidate === serviceName) {
				currentService = serviceName;
				serviceIndent = indent;
				skipIndent = -1;
				rewritten.push(line);
				rewritten.push(`${" ".repeat(indent + 2)}image: ${imageUri}`);
				continue;
			}
			if (indent <= serviceIndent) {
				currentService = "";
				serviceIndent = -1;
				skipIndent = -1;
			}
		}

		if (currentService === serviceName) {
			if (trimmed.startsWith("build:")) {
				skipIndent = indent;
				continue;
			}
			if (skipIndent >= 0) {
				if (indent > skipIndent) {
					continue;
				}
				skipIndent = -1;
			}
			if (trimmed.startsWith("image:")) {
				continue;
			}
		}

		rewritten.push(line);
	}

	return rewritten.join("\n");
}

export function buildEcrComposeDeployScript(params: {
	ecrRegistry: string;
	ecrRepoName: string;
	imageTag: string;
	region: string;
	envFileContentBase64: string;
	composeContent: string;
	services: { name: string; port: number }[];
	ecrPasswordB64: string;
}): string {
	const { ecrRegistry, ecrRepoName, imageTag, envFileContentBase64, composeContent, services, ecrPasswordB64 } = params;

	let modifiedCompose = composeContent;
	for (const svc of services) {
		const svcUri = `${ecrRegistry}/${ecrRepoName}-${svc.name}:${imageTag}`;
		modifiedCompose = replaceBuildSectionWithImage(modifiedCompose, svc.name, svcUri);
	}
	const composeB64 = Buffer.from(modifiedCompose, "utf8").toString("base64");

	return `set -e
echo "=== Deploying from ECR (compose) ==="

echo '${ecrPasswordB64}' | base64 -d | docker login --username AWS --password-stdin ${ecrRegistry}

mkdir -p /home/ec2-user/app
cd /home/ec2-user/app

docker-compose down 2>/dev/null || true
docker system prune -af --volumes 2>/dev/null || true

${envFileContentBase64 ? `echo '${envFileContentBase64}' | base64 -d > .env` : "touch .env"}

echo '${composeB64}' | base64 -d > docker-compose.yml

docker-compose pull
docker-compose up -d

echo "====================================== Deploy from ECR complete! ======================================"
`;
}

/**
 * Generates a minimal user-data script that only installs packages (Docker, SSM, nginx).
 * Actual container deployment happens via SSM after user-data finishes.
 */
export function generateEcrUserDataScript(mainPort: string, nginxConf?: string): string {
	const nginxBlock = nginxConf
		? `cat > /etc/nginx/nginx.conf << 'NGINXEOF'
${nginxConf}
NGINXEOF`
		: `sed -i 's/^[[:space:]]*server_name[[:space:]]\\+_;$/# &/' /etc/nginx/nginx.conf
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
}
NGINXEOF
rm -f /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/00-default.conf /etc/nginx/conf.d/ssl.conf 2>/dev/null || true`;

	return `#!/bin/bash
set -e
trap 'EXIT_CODE=$?; echo "Script error at line $LINENO, exit code $EXIT_CODE"; exit $EXIT_CODE' ERR

rm -rf /var/lib/cloud/data/tmp_* 2>/dev/null || true
rm -rf /var/lib/cloud/instances/*/sem/* 2>/dev/null || true

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

mkdir -p /home/ec2-user/app

systemctl start nginx && systemctl enable nginx
${nginxBlock}
nginx -t && systemctl reload nginx

echo "====================================== Instance setup complete! ======================================"
`;
}

/**
 * Runs the redeploy script on an existing instance via SSM and streams output to send().
 */
export async function runRedeployViaSsm(params: {
	instanceId: string;
	region: string;
	script: string;
	send: (msg: string, stepId: string) => void;
}): Promise<{ success: boolean; output: string }> {
	const { instanceId, region, script, send } = params;
	const client = new SSMClient(getClientConfig(region));

	// SSM Run Command has a 4096 char limit per command; pass script as base64
	const scriptBase64 = Buffer.from(script, "utf8").toString("base64");
	const commands = [`echo '${scriptBase64}' | base64 -d | bash`];

	send("Sending redeploy command to instance via SSM...", "deploy");
	const sendResult = await client.send(
		new SendCommandCommand({
			InstanceIds: [instanceId],
			DocumentName: "AWS-RunShellScript",
			Parameters: { commands },
		})
	);

	const commandId = sendResult.Command?.CommandId;
	if (!commandId) {
		throw new Error("SSM SendCommand did not return a CommandId");
	}

	send("Redeploy command sent. Streaming output...", "deploy");
	const pollIntervalMs = 2000;
	let lastSentLength = 0;
	const terminalStates = ["Success", "Failed", "Cancelled", "TimedOut"];

	while (true) {
		await new Promise((r) => setTimeout(r, pollIntervalMs));

		const invocation = await client.send(
			new GetCommandInvocationCommand({
				CommandId: commandId,
				InstanceId: instanceId,
			})
		);

		const status = invocation.Status;
		const stdout = invocation.StandardOutputContent ?? "";
		const stderr = invocation.StandardErrorContent ?? "";

		const fullOutput = stdout + (stderr ? "\n" + stderr : "");
		if (fullOutput.length > lastSentLength) {
			const newContent = fullOutput.slice(lastSentLength);
			if (newContent.trim()) send(newContent.trimEnd(), "deploy");
			lastSentLength = fullOutput.length;
		}

		if (status && terminalStates.includes(status)) {
			const success = status === "Success";
			if (!success && stderr) send(`Stderr: ${stderr}`, "deploy");
			return { success, output: fullOutput };
		}
	}
}
