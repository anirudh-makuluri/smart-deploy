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
 * Generates Dockerfile content based on deployConfig (shared with handleEC2.ts logic)
 */
function generateDockerfileContentForRedeploy(
	deployConfig: any,
	serviceDir: string = "."
): string {
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

	switch (language) {
		case "node":
		case "javascript":
		case "typescript":
			return `
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
		case "python":
			return `
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
		case "go":
		case "golang":
			return `
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
		default:
			return `
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
}

/**
 * Builds the bash script run on the instance for redeploy (git pull + docker-compose up).
 */
export function buildRedeployScript(params: {
	repoUrl: string;
	branch: string;
	token: string;
	commitSha?: string;
	envFileContentBase64: string;
	dockerComposeYml: string;
	deployConfig?: any;
	services?: Array<{ dir: string; port: number }>;
}): string {
	const {
		repoUrl,
		branch,
		token,
		commitSha,
		envFileContentBase64,
		dockerComposeYml,
		deployConfig,
		services = [],
	} = params;
	const authenticatedUrl = repoUrl.replace("https://", `https://${token}@`);
	const composeEscaped = dockerComposeYml.replace(/'/g, "'\\''");

	// Generate Dockerfile creation commands if deployConfig is provided
	let dockerfileCreationScript = "";
	if (deployConfig) {
		for (const svc of services) {
			const dir = svc.dir === "." ? "." : svc.dir;
			const dockerfilePath = dir === "." ? "Dockerfile" : `${dir}/Dockerfile`;
			const dockerfileContent = generateDockerfileContentForRedeploy(deployConfig, svc.dir);
			const escapedContent = dockerfileContent.replace(/\$/g, '\\$').replace(/`/g, '\\`');
			dockerfileCreationScript += `
if [ ! -f ${dockerfilePath} ]; then
    echo "Creating Dockerfile at ${dockerfilePath}..."
    mkdir -p ${dir === "." ? "." : dir}
    cat > ${dockerfilePath} << 'DOCKERFILEEOF'
${escapedContent}
DOCKERFILEEOF
    echo "Dockerfile created at ${dockerfilePath}"
fi
`;
		}
	}

	return `set -e
echo "=== Disk space before redeploy ==="
df -h /
echo "=================================="

cd /home/ec2-user/app

# Clean up Docker resources before redeploy to free space
docker-compose down 2>/dev/null || true
docker system prune -af --volumes 2>/dev/null || true

# Clean up git to free space
git gc --aggressive --prune=now 2>/dev/null || true

echo "=== Disk space after cleanup ==="
df -h /
echo "================================"

git remote set-url origin '${authenticatedUrl}'
git fetch origin
git checkout ${branch}
git reset --hard origin/${branch}
${commitSha ? `git checkout ${commitSha}` : ""}

# Clean up git again after fetch
git gc --aggressive --prune=now 2>/dev/null || true

echo '${envFileContentBase64}' | base64 -d > .env
cat > docker-compose.yml << 'COMPOSEEOF'
${composeEscaped}
COMPOSEEOF

${dockerfileCreationScript}

echo "=== Disk space before build ==="
df -h /
echo "==============================="

docker-compose up -d --build

# Clean up Docker build cache after build
docker system prune -af --volumes 2>/dev/null || true

echo "=== Disk space after build ==="
df -h /
echo "=============================="
echo "====================================== Redeploy complete! ======================================"
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
