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
import { githubAuthenticatedCloneUrl } from "../githubGitAuth";

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
 * Returns the current state of an EC2 instance (e.g. "running", "stopped", "terminated").
 */
export async function getInstanceState(
	instanceId: string,
	region: string,
	ws: any
): Promise<string> {
	const output = await runAWSCommand(
		[
			"ec2",
			"describe-instances",
			"--instance-ids",
			instanceId,
			"--query",
			"Reservations[0].Instances[0].State.Name",
			"--output",
			"text",
			"--region",
			region,
		],
		ws,
		"deploy"
	);
	return (output || "").trim();
}

/**
 * Generates bash commands to write Dockerfiles from scan_results.dockerfiles
 * into the cloned repo.
 *
 * Note: To prevent path mismatches on EC2 (compose references vs generated keys),
 * we normalize all generated Dockerfiles to be written at repo root with stable names.
 */
function buildDockerfileWriteScript(dockerfiles: Record<string, string>): string {
	return Object.entries(dockerfiles)
		.map(([filePath, content]) => {
			const safePath = filePath.replace(/^\.\//, "");
			const normalizedName =
				safePath.includes("apps/web/") ? "Dockerfile.web"
					: safePath.includes("apps/backend/") ? "Dockerfile.backend"
						: (safePath.split("/").pop() || safePath);
			return `
echo "Writing Dockerfile from scan_results to Dockerfile.${normalizedName} (root)..."
cat > "Dockerfile.${normalizedName}" << 'DOCKERFILEEOF'
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
	return `
echo "Writing docker-compose.yml from scan_results..."
cat > docker-compose.yml << 'COMPOSEEOF'
${dockerCompose}
COMPOSEEOF

# Normalize dockerfile references to root-level Dockerfiles we write above.
# Supports both nested paths and already-normalized names.
echo "Normalizing docker-compose.yml dockerfile: paths..."
sed -i 's#^\\([[:space:]]*dockerfile:[[:space:]]*\\)apps/web/Dockerfile[[:space:]]*$#\\1Dockerfile.web#' docker-compose.yml 2>/dev/null || true
sed -i 's#^\\([[:space:]]*dockerfile:[[:space:]]*\\)apps/backend/Dockerfile[[:space:]]*$#\\1Dockerfile.backend#' docker-compose.yml 2>/dev/null || true
sed -i 's#^\\([[:space:]]*dockerfile:[[:space:]]*\\)Dockerfile\\.web[[:space:]]*$#\\1Dockerfile.web#' docker-compose.yml 2>/dev/null || true
sed -i 's#^\\([[:space:]]*dockerfile:[[:space:]]*\\)Dockerfile\\.backend[[:space:]]*$#\\1Dockerfile.backend#' docker-compose.yml 2>/dev/null || true
`;
}

/**
 * Generates bash commands to build and run Docker containers.
 * Uses docker-compose if a compose file exists; otherwise falls back to
 * single-service docker build + docker run.
 */
function buildDockerRunScript(mainPort: string): string {
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
    echo "No docker-compose found. Building single-service Docker image..."
    if [ ! -f Dockerfile ]; then
        echo "ERROR: No Dockerfile found in repository root."
        exit 1
    fi
    docker build -t smartdeploy-app .
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
export function buildFirstDeployScript(params: {
	envFileContentBase64: string;
	dockerCompose: string;
	dockerfiles: Record<string, string>;
	mainPort: string;
}): string {
	const { envFileContentBase64, dockerCompose, dockerfiles, mainPort } = params;

	const dockerfileScript = buildDockerfileWriteScript(dockerfiles);
	const composeScript = buildComposeWriteScript(dockerCompose);
	const runScript = buildDockerRunScript(mainPort);

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
	} = params;
	const authenticatedUrl = githubAuthenticatedCloneUrl(repoUrl, token);

	const dockerfileScript = buildDockerfileWriteScript(dockerfiles);
	const composeScript = buildComposeWriteScript(dockerCompose);
	const runScript = buildDockerRunScript(mainPort);

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
