import {
	CodeBuildClient,
	CreateProjectCommand,
	StartBuildCommand,
	BatchGetProjectsCommand,
	BatchGetBuildsCommand,
} from "@aws-sdk/client-codebuild";
import {
	CloudWatchLogsClient,
	GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
	IAMClient,
	GetRoleCommand,
	CreateRoleCommand,
	PutRolePolicyCommand,
} from "@aws-sdk/client-iam";
import { getAwsClientConfig } from "./sdkClients";
import { getAwsAccountId } from "./ecrHelpers";
import type { SDArtifactsResponse } from "../../app/types";

type SendFn = (msg: string, stepId: string) => void;

const CODEBUILD_PROJECT_NAME = "smartdeploy-builder";
const CODEBUILD_ROLE_NAME = "smartdeploy-codebuild-role";
const LOG_GROUP = `/aws/codebuild/${CODEBUILD_PROJECT_NAME}`;

// ─── IAM Role ─────────────────────────────────────────────────────────────

export async function ensureCodeBuildRole(
	region: string,
	send: SendFn,
): Promise<string> {
	const iam = new IAMClient(getAwsClientConfig(region));

	try {
		const resp = await iam.send(new GetRoleCommand({ RoleName: CODEBUILD_ROLE_NAME }));
		return resp.Role!.Arn!;
	} catch (e: any) {
		if (e.name !== "NoSuchEntity" && e.name !== "NoSuchEntityException") throw e;
	}

	send("Creating CodeBuild service role...", "build");
	const accountId = await getAwsAccountId(region);

	const trustPolicy = JSON.stringify({
		Version: "2012-10-17",
		Statement: [{
			Effect: "Allow",
			Principal: { Service: "codebuild.amazonaws.com" },
			Action: "sts:AssumeRole",
		}],
	});

	const createResp = await iam.send(new CreateRoleCommand({
		RoleName: CODEBUILD_ROLE_NAME,
		AssumeRolePolicyDocument: trustPolicy,
	}));
	const roleArn = createResp.Role!.Arn!;

	const permissionsPolicy = JSON.stringify({
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
				Resource: `arn:aws:logs:${region}:${accountId}:log-group:/aws/codebuild/*`,
			},
			{
				Effect: "Allow",
				Action: [
					"ecr:CreateRepository",
					"ecr:DescribeRepositories",
					"ecr:GetAuthorizationToken",
					"ecr:BatchCheckLayerAvailability",
					"ecr:GetDownloadUrlForLayer",
					"ecr:BatchGetImage",
					"ecr:PutImage",
					"ecr:InitiateLayerUpload",
					"ecr:UploadLayerPart",
					"ecr:CompleteLayerUpload",
				],
				Resource: "*",
			},
		],
	});

	await iam.send(new PutRolePolicyCommand({
		RoleName: CODEBUILD_ROLE_NAME,
		PolicyName: "smartdeploy-codebuild-permissions",
		PolicyDocument: permissionsPolicy,
	}));

	// IAM is eventually consistent
	await new Promise((r) => setTimeout(r, 10_000));
	send("CodeBuild service role created.", "build");
	return roleArn;
}

// ─── CodeBuild Project ────────────────────────────────────────────────────

export async function ensureCodeBuildProject(
	region: string,
	roleArn: string,
	send: SendFn,
): Promise<string> {
	const cb = new CodeBuildClient(getAwsClientConfig(region));

	try {
		const resp = await cb.send(new BatchGetProjectsCommand({ names: [CODEBUILD_PROJECT_NAME] }));
		if (resp.projects && resp.projects.length > 0 && resp.projects[0].name) {
			return CODEBUILD_PROJECT_NAME;
		}
	} catch { /* project doesn't exist */ }

	send("Creating CodeBuild project...", "build");

	await cb.send(new CreateProjectCommand({
		name: CODEBUILD_PROJECT_NAME,
		source: {
			type: "NO_SOURCE",
			buildspec: "version: 0.2\nphases:\n  build:\n    commands:\n      - echo placeholder",
		},
		artifacts: { type: "NO_ARTIFACTS" },
		environment: {
			type: "LINUX_CONTAINER",
			computeType: "BUILD_GENERAL1_SMALL",
			image: "aws/codebuild/amazonlinux-x86_64-standard:5.0",
			privilegedMode: true,
			environmentVariables: [],
		},
		serviceRole: roleArn,
		logsConfig: {
			cloudWatchLogs: { status: "ENABLED", groupName: LOG_GROUP },
		},
	}));

	send("CodeBuild project created.", "build");
	return CODEBUILD_PROJECT_NAME;
}

// ─── Buildspec Generation ─────────────────────────────────────────────────

function yamlListEntry(line: string, spaces: number): string {
	// Quote commands to avoid YAML parsing issues when the command contains ":" or other special chars.
	const quoted = JSON.stringify(line);
	return " ".repeat(spaces) + "- " + quoted;
}

export function generateBuildspec(params: {
	ecrRegistry: string;
	ecrRepoName: string;
	imageTag: string;
	region: string;
	scanResults?: SDArtifactsResponse;
}): string {
	const { ecrRegistry, ecrRepoName, imageTag, region, scanResults } = params;
	const fullUri = `${ecrRegistry}/${ecrRepoName}:${imageTag}`;
	const services = scanResults?.services || [];
	const dockerfiles = scanResults?.dockerfiles || {};
	const hasCompose = !!scanResults?.docker_compose;

	const preBuildCmds: string[] = [
		"echo Logging in to Amazon ECR...",
		'REGION="${AWS_DEFAULT_REGION:-${AWS_REGION}}"',
		`if [ -z "$REGION" ]; then REGION="${region}"; fi`,
		`aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin ${ecrRegistry}`,
		// When DOCKERHUB_USERNAME + DOCKERHUB_TOKEN are passed as CodeBuild env overrides, authenticate to Docker Hub before docker build (avoids anonymous 429 rate limits).
		'if [ -n "$DOCKERHUB_USERNAME" ] && [ -n "$DOCKERHUB_TOKEN" ]; then echo "Logging in to Docker Hub..."; echo "$DOCKERHUB_TOKEN" | docker login --username "$DOCKERHUB_USERNAME" --password-stdin; fi',
		"echo Cloning source repository...",
		"git clone -b $BRANCH_NAME https://${GITHUB_TOKEN}@github.com/${REPO_FULL_NAME}.git src",
		"cd src",
		'if [ -n "$COMMIT_SHA" ]; then git checkout $COMMIT_SHA; fi',
	];

	// Write Dockerfiles from scan_results
	for (const [relPath, content] of Object.entries(dockerfiles)) {
		const safePath = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
		if (!safePath || safePath.includes("..")) continue;
		const dir = safePath.includes("/") ? safePath.substring(0, safePath.lastIndexOf("/")) : "";
		const b64 = Buffer.from(content, "utf8").toString("base64");
		if (dir) preBuildCmds.push(`mkdir -p "${dir}"`);
		preBuildCmds.push(`echo "${b64}" | base64 -d > "${safePath}"`);
	}

	if (hasCompose) {
		const composeContent = scanResults?.docker_compose;
		if (composeContent) {
			const b64 = Buffer.from(composeContent, "utf8").toString("base64");
			preBuildCmds.push(`echo "${b64}" | base64 -d > docker-compose.yml`);
		}
	}

	preBuildCmds.push(
		'if [ -n "$APP_ENV_VARS_B64" ]; then echo "$APP_ENV_VARS_B64" | base64 -d > .env; fi',
	);

	let buildCmds: string[];
	let postBuildCmds: string[];

	if (hasCompose && services.length > 1) {
		buildCmds = [
			"echo Building with docker-compose...",
			"docker-compose build",
		];
		postBuildCmds = ["echo Tagging and pushing images to ECR..."];
		for (const svc of services) {
			const svcUri = `${ecrRegistry}/${ecrRepoName}-${svc.name}:${imageTag}`;
			postBuildCmds.push(
				`IMAGE_ID=$(docker-compose images ${svc.name} -q 2>/dev/null | head -1); ` +
					`if [ -z "$IMAGE_ID" ]; then IMAGE_ID=$(docker images -q --filter "reference=*${svc.name}*" | head -1); fi; ` +
					`if [ -n "$IMAGE_ID" ]; then docker tag "$IMAGE_ID" "${svcUri}"; docker push "${svcUri}" || echo "Warning: could not push ${svc.name}"; ` +
					`else echo "Warning: could not find image for ${svc.name}"; fi`,
			);
		}
		postBuildCmds.push(
			`IMAGE_ID=$(docker-compose images ${services[0].name} -q 2>/dev/null | head -1); ` +
				`if [ -z "$IMAGE_ID" ]; then IMAGE_ID=$(docker images -q --filter "reference=*${services[0].name}*" | head -1); fi; ` +
				`if [ -n "$IMAGE_ID" ]; then docker tag "$IMAGE_ID" "${fullUri}"; docker push "${fullUri}"; ` +
				`else echo "Warning: could not find image for ${services[0].name}"; fi`,
		);
	} else {
		const dockerfilePath = services[0]?.dockerfile_path || Object.keys(dockerfiles)[0] || "Dockerfile";
		const buildContext = services[0]?.build_context || ".";
		buildCmds = [
			`echo Building Docker image from ${dockerfilePath}...`,
			`docker build -f ${dockerfilePath} -t ${fullUri} ${buildContext}`,
		];
		postBuildCmds = [
			"echo Pushing image to ECR...",
			`docker push ${fullUri}`,
		];
	}

	const SP = 6;
	const lines = [
		"version: 0.2",
		"phases:",
		"  pre_build:",
		"    commands:",
		...preBuildCmds.map((c) => yamlListEntry(c, SP)),
		"  build:",
		"    commands:",
		...buildCmds.map((c) => yamlListEntry(c, SP)),
		"  post_build:",
		"    commands:",
		...postBuildCmds.map((c) => yamlListEntry(c, SP)),
	];
	return lines.join("\n") + "\n";
}

// ─── Start Build ──────────────────────────────────────────────────────────

export async function startBuild(params: {
	region: string;
	projectName: string;
	repoFullName: string;
	branch: string;
	commitSha?: string;
	githubToken: string;
	buildspec: string;
	envVarsBase64?: string;
	/** Optional: Docker Hub PAT + user so CodeBuild can pull public bases (e.g. node:20-alpine) without anonymous rate limits. */
	dockerHub?: { username: string; token: string };
	send: SendFn;
}): Promise<string> {
	const cb = new CodeBuildClient(getAwsClientConfig(params.region));

	params.send(`Starting CodeBuild for ${params.repoFullName}@${params.branch}...`, "build");

	const envOverrides: { name: string; value: string; type: "PLAINTEXT" }[] = [
		{ name: "GITHUB_TOKEN", value: params.githubToken, type: "PLAINTEXT" },
		{ name: "REPO_FULL_NAME", value: params.repoFullName, type: "PLAINTEXT" },
		{ name: "BRANCH_NAME", value: params.branch, type: "PLAINTEXT" },
		{ name: "COMMIT_SHA", value: params.commitSha || "", type: "PLAINTEXT" },
		{ name: "AWS_DEFAULT_REGION", value: params.region, type: "PLAINTEXT" },
		{ name: "AWS_REGION", value: params.region, type: "PLAINTEXT" },
	];

	if (params.envVarsBase64) {
		envOverrides.push({ name: "APP_ENV_VARS_B64", value: params.envVarsBase64, type: "PLAINTEXT" });
	}

	if (params.dockerHub?.username && params.dockerHub?.token) {
		envOverrides.push(
			{ name: "DOCKERHUB_USERNAME", value: params.dockerHub.username, type: "PLAINTEXT" },
			{ name: "DOCKERHUB_TOKEN", value: params.dockerHub.token, type: "PLAINTEXT" },
		);
	}

	const resp = await cb.send(new StartBuildCommand({
		projectName: params.projectName,
		buildspecOverride: params.buildspec,
		environmentVariablesOverride: envOverrides,
	}));

	const buildId = resp.build!.id!;
	params.send(`Build started: ${buildId}`, "build");
	return buildId;
}

// ─── Stream Build Logs ────────────────────────────────────────────────────

export async function waitForBuildAndStreamLogs(params: {
	buildId: string;
	region: string;
	send: SendFn;
}): Promise<{ success: boolean }> {
	const { buildId, region, send } = params;
	const cb = new CodeBuildClient(getAwsClientConfig(region));
	const cwl = new CloudWatchLogsClient(getAwsClientConfig(region));

	let logGroupName: string | undefined = LOG_GROUP;
	let logStreamName: string | undefined;
	let nextToken: string | undefined;
	let logStreamAvailable = false;
	let sentLogLocation = false;
	const terminalStatuses = new Set(["SUCCEEDED", "FAILED", "FAULT", "STOPPED", "TIMED_OUT"]);

	while (true) {
		await new Promise((r) => setTimeout(r, 500));

		// Stream logs from CloudWatch
		if (!logStreamAvailable && logStreamName && logGroupName) {
			try {
				const resp = await cwl.send(new GetLogEventsCommand({
					logGroupName,
					logStreamName,
					startFromHead: true,
				}));
				logStreamAvailable = true;
				for (const event of resp.events || []) {
					if (event.message?.trim()) send(event.message.trimEnd(), "build");
				}
				nextToken = resp.nextForwardToken;
			} catch {
				// Log stream not ready yet
			}
		} else if (logStreamName && logGroupName) {
			try {
				const resp = await cwl.send(new GetLogEventsCommand({
					logGroupName,
					logStreamName,
					...(nextToken ? { nextToken } : { startFromHead: true }),
				}));
				for (const event of resp.events || []) {
					if (event.message?.trim()) send(event.message.trimEnd(), "build");
				}
				if (resp.nextForwardToken && resp.nextForwardToken !== nextToken) {
					nextToken = resp.nextForwardToken;
				}
			} catch {
				// Transient error, retry next iteration
			}
		}

		// Check build status
		try {
			const buildResp = await cb.send(new BatchGetBuildsCommand({ ids: [buildId] }));
			const build = buildResp.builds?.[0];
			if (!build) continue;

			// Prefer log stream/group from the build response when available
			if (!logStreamName && build.logs?.streamName) logStreamName = build.logs.streamName;
			if (build.logs?.groupName) logGroupName = build.logs.groupName;
			if (!sentLogLocation && (build.logs?.deepLink || build.logs?.groupName || build.logs?.streamName)) {
				const parts: string[] = [];
				if (build.logs?.groupName) parts.push(`group=${build.logs.groupName}`);
				if (build.logs?.streamName) parts.push(`stream=${build.logs.streamName}`);
				if (build.logs?.deepLink) parts.push(`link=${build.logs.deepLink}`);
				send(`CodeBuild logs: ${parts.join(" | ")}`, "build");
				sentLogLocation = true;
			}

			const status = build.buildStatus;
			if (status && terminalStatuses.has(status)) {
				// Drain remaining logs
				if (logStreamAvailable && logStreamName && logGroupName) {
					try {
						const finalResp = await cwl.send(new GetLogEventsCommand({
							logGroupName,
							logStreamName,
							...(nextToken ? { nextToken } : {}),
						}));
						for (const event of finalResp.events || []) {
							if (event.message?.trim()) send(event.message.trimEnd(), "build");
						}
					} catch { /* OK */ }
				}

				const success = status === "SUCCEEDED";
				if (!success) {
					const lastPhase = build.phases?.slice(-1)[0];
					send(`❌ CodeBuild ${status}: ${lastPhase?.phaseStatus || "See logs above"}`, "build");
				} else {
					send("✅ Docker image built and pushed to ECR", "build");
				}
				return { success };
			}
		} catch {
			// Transient error
		}
	}
}
