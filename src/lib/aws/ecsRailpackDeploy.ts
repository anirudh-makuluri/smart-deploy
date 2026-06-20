import {
	ECSClient,
	RegisterTaskDefinitionCommand,
	CreateServiceCommand,
	UpdateServiceCommand,
	DescribeServicesCommand,
	ListTasksCommand,
	DescribeTasksCommand,
	type Service,
	type Task,
} from "@aws-sdk/client-ecs";
import type { DeployConfig } from "../../app/types";
import { hostedUrlFromSubdomain } from "@/lib/hostedUrl";
import config from "../../config";
import {
	buildEcsContainerSecrets,
	ensureEcsExecutionRoleSecretsAccess,
	getDeploymentEnvSecretObject,
} from "./deploymentSecrets";
import { getAwsClientConfig } from "./sdkClients";
import type { EC2Result } from "./handleEC2";
import {
	allowAlbToReachService,
	buildServiceHostname,
	ensureHostRule,
	ensureSharedAlb,
	ensureTargetGroup,
	runAWSCommand,
} from "./awsHelpers";
import { getEcsServiceLogs } from "./ecsCloudWatchLogs";

type SendFn = (msg: string, stepId: string) => void;
type EcsRolloutResult = { success: true } | { success: false; message: string };

function awsNameChunk(s: string, max: number): string {
	const out = s
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, max);
	return out || "app";
}

function parseCommaList(raw: string | undefined): string[] {
	if (!raw?.trim()) return [];
	return raw.split(",").flatMap((s) => {
		const trimmed = s.trim();
		return trimmed ? [trimmed] : [];
	});
}

function containerEnvFromDeploy(envVars?: string | null): { name: string; value: string }[] {
	if (!envVars?.trim()) return [];
	const out: { name: string; value: string }[] = [];
	for (const line of envVars.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith("#")) continue;
		const eq = t.indexOf("=");
		if (eq <= 0) continue;
		const name = t.slice(0, eq).trim();
		const value = t.slice(eq + 1).trim();
		if (name) out.push({ name, value });
	}
	return out.slice(0, 50);
}

function shortArn(arn?: string): string {
	if (!arn) return "unknown";
	const parts = arn.split("/");
	return parts[parts.length - 1] || arn;
}

function trimReason(reason?: string | null, max = 220): string | null {
	const trimmed = reason?.trim();
	if (!trimmed) return null;
	return trimmed.length > max ? `${trimmed.slice(0, max - 3)}...` : trimmed;
}

function pickPrimaryDeployment(service: Service | undefined, taskDefinitionArn: string) {
	const deployments = service?.deployments ?? [];
	return (
		deployments.find((deployment) => deployment.taskDefinition === taskDefinitionArn) ??
		deployments.find((deployment) => deployment.status === "PRIMARY") ??
		null
	);
}

function buildServiceRolloutSummary(service: Service | undefined, taskDefinitionArn: string): string {
	if (!service) return "ECS rollout: service details unavailable.";
	const desired = service.desiredCount ?? 0;
	const running = service.runningCount ?? 0;
	const pending = service.pendingCount ?? 0;
	const primary = pickPrimaryDeployment(service, taskDefinitionArn);
	const rolloutState = primary?.rolloutState ?? "UNKNOWN";
	const rolloutReason = trimReason(primary?.rolloutStateReason);
	return [
		`ECS rollout status: desired=${desired} running=${running} pending=${pending} state=${rolloutState}`,
		...(rolloutReason ? [`reason=${rolloutReason}`] : []),
	].join(" | ");
}

function buildTaskFingerprint(task: Task): string {
	const containerState = (task.containers ?? [])
		.map((container) =>
			[
				container.name ?? "app",
				container.lastStatus ?? "UNKNOWN",
				container.healthStatus ?? "UNKNOWN",
				container.exitCode != null ? `exit=${container.exitCode}` : "",
				trimReason(container.reason) ?? "",
			]
				.filter(Boolean)
				.join(":")
		)
		.join("|");
	return [
		task.lastStatus ?? "UNKNOWN",
		task.desiredStatus ?? "UNKNOWN",
		task.healthStatus ?? "UNKNOWN",
		task.stopCode ?? "",
		trimReason(task.stoppedReason) ?? "",
		containerState,
	].join("|");
}

function buildTaskTransitionLines(task: Task): string[] {
	const taskId = shortArn(task.taskArn);
	const lines = [
		`[task ${taskId}] desired=${task.desiredStatus ?? "UNKNOWN"} last=${task.lastStatus ?? "UNKNOWN"} health=${task.healthStatus ?? "UNKNOWN"}`,
	];
	const stopReason = trimReason(task.stoppedReason);
	if (stopReason) {
		lines.push(`[task ${taskId}] stoppedReason=${stopReason}`);
	}
	for (const container of task.containers ?? []) {
		const containerReason = trimReason(container.reason);
		const details = [
			`[task ${taskId}] container=${container.name ?? "app"}`,
			`last=${container.lastStatus ?? "UNKNOWN"}`,
			container.healthStatus ? `health=${container.healthStatus}` : "",
			container.exitCode != null ? `exit=${container.exitCode}` : "",
			containerReason ? `reason=${containerReason}` : "",
		]
			.filter(Boolean)
			.join(" ");
		lines.push(details);
	}
	return lines;
}

function isServiceRolloutComplete(service: Service | undefined, taskDefinitionArn: string): boolean {
	if (!service) return false;
	const desired = service.desiredCount ?? 0;
	if (desired <= 0) return false;
	const primary = pickPrimaryDeployment(service, taskDefinitionArn);
	if (!primary) return false;
	if (primary.taskDefinition !== taskDefinitionArn) return false;
	if (primary.rolloutState && primary.rolloutState !== "COMPLETED") return false;
	return (service.runningCount ?? 0) >= desired && (service.pendingCount ?? 0) === 0;
}

export async function waitForEcsServiceRollout(params: {
	region: string;
	cluster: string;
	serviceName: string;
	taskDefinitionArn: string;
	logGroup: string;
	send: SendFn;
	timeoutMs?: number;
	pollMs?: number;
}): Promise<EcsRolloutResult> {
	const ecs = new ECSClient(getAwsClientConfig(params.region));
	const timeoutMs = params.timeoutMs ?? 4 * 60_000;
	const pollMs = params.pollMs ?? 8_000;
	const deadlineAt = Date.now() + timeoutMs;
	const rolloutStartedAt = Date.now() - 15_000;
	const seenEvents = new Set<string>();
	const seenTaskStates = new Map<string, string>();
	const seenLogs = new Set<string>();
	let lastSummary = "";

	params.send(`Waiting for ECS rollout to stabilize for ${params.serviceName}...`, "rollout");

	while (Date.now() < deadlineAt) {
		const serviceResponse = await ecs.send(
			new DescribeServicesCommand({
				cluster: params.cluster,
				services: [params.serviceName],
			})
		);
		const service = serviceResponse.services?.[0];
		if (!service) {
			const message = `ECS rollout could not find service ${params.cluster}/${params.serviceName}.`;
			params.send(`ERROR: ${message}`, "rollout");
			return { success: false, message };
		}

		for (const event of [...(service.events ?? [])].reverse()) {
			const key = `${event.createdAt?.toISOString?.() ?? ""}|${event.message ?? ""}`;
			if (!event.message || seenEvents.has(key)) continue;
			seenEvents.add(key);
			const timePrefix = event.createdAt ? `[${new Date(event.createdAt).toISOString()}] ` : "";
			params.send(`[service] ${timePrefix}${event.message}`.trim(), "rollout");
		}

		const summary = buildServiceRolloutSummary(service, params.taskDefinitionArn);
		if (summary !== lastSummary) {
			lastSummary = summary;
			params.send(summary, "rollout");
		}

		const taskArnSet = new Set<string>();
		for (const desiredStatus of ["RUNNING", "STOPPED"] as const) {
			const listed = await ecs.send(
				new ListTasksCommand({
					cluster: params.cluster,
					serviceName: params.serviceName,
					desiredStatus,
					maxResults: 10,
				})
			);
			for (const taskArn of listed.taskArns ?? []) {
				taskArnSet.add(taskArn);
			}
		}

		const taskArns = [...taskArnSet];
		let tasks: Task[] = [];
		if (taskArns.length > 0) {
			const described = await ecs.send(
				new DescribeTasksCommand({
					cluster: params.cluster,
					tasks: taskArns,
				})
			);
			tasks = described.tasks ?? [];
			for (const task of tasks) {
				const fingerprint = buildTaskFingerprint(task);
				const taskArn = task.taskArn ?? "";
				if (seenTaskStates.get(taskArn) === fingerprint) continue;
				seenTaskStates.set(taskArn, fingerprint);
				for (const line of buildTaskTransitionLines(task)) {
					params.send(line, "rollout");
				}
			}
		}

		try {
			const logs = await getEcsServiceLogs({
				ecs: {
					target: "ecs",
					region: params.region,
					cluster: params.cluster,
					service: params.serviceName,
					baseUrl: "",
					logGroup: params.logGroup,
				},
				limit: 120,
				startTimeMs: rolloutStartedAt,
			});
			for (const entry of logs) {
				const message = entry.message?.trim();
				if (!message) continue;
				const key = `${entry.timestamp ?? ""}|${message}`;
				if (seenLogs.has(key)) continue;
				seenLogs.add(key);
				const timePrefix = entry.timestamp ? `[${entry.timestamp}] ` : "";
				params.send(`[app] ${timePrefix}${message}`.trim(), "rollout");
			}
		} catch {
			// CloudWatch streams can lag behind task creation; rollout should continue.
		}

		const primary = pickPrimaryDeployment(service, params.taskDefinitionArn);
		if (primary?.rolloutState === "FAILED") {
			const message =
				trimReason(primary.rolloutStateReason) ||
				`ECS reported rollout failure for ${params.serviceName}.`;
			params.send(`ERROR: ECS rollout failed: ${message}`, "rollout");
			return { success: false, message };
		}

		if (isServiceRolloutComplete(service, params.taskDefinitionArn)) {
			params.send(
				`SUCCESS: ECS rollout completed for ${params.cluster}/${params.serviceName}.`,
				"rollout"
			);
			return { success: true };
		}

		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}

	const message = `ECS rollout timed out before ${params.cluster}/${params.serviceName} became stable.`;
	params.send(`ERROR: ${message}`, "rollout");
	return { success: false, message };
}

export function ecsRailpackFromEcrConfigured(): boolean {
	return Boolean(
		config.ECS_CLUSTER_NAME?.trim() &&
			config.ECS_SUBNET_IDS?.trim() &&
			config.ECS_SECURITY_GROUP_IDS?.trim() &&
			config.ECS_EXECUTION_ROLE_ARN?.trim()
	);
}

async function describeSubnetVpcId(subnetId: string, region: string, ws: any): Promise<string> {
	const out = (
		await runAWSCommand(
			[
				"ec2",
				"describe-subnets",
				"--subnet-ids",
				subnetId,
				"--query",
				"Subnets[0].VpcId",
				"--output",
				"text",
				"--region",
				region,
			],
			ws,
			"setup"
		)
	).trim();
	if (!out || out === "None") throw new Error(`Could not resolve VPC for subnet ${subnetId}`);
	return out;
}

/**
 * Deploy a single Railpack-built image to Fargate behind the shared ALB (host rule → IP target group).
 */
export async function deployRailpackServerToEcs(params: {
	deployConfig: DeployConfig;
	region: string;
	repoName: string;
	imageUri: string;
	containerPort: number;
	unitName: string;
	ws: any;
	send: SendFn;
}): Promise<EC2Result> {
	const { deployConfig, region, repoName, imageUri, containerPort, unitName, ws, send } = params;

	if (!ecsRailpackFromEcrConfigured()) {
		return {
			success: false,
			baseUrl: "",
			serviceUrls: new Map(),
			instanceId: "",
			publicIp: "",
			vpcId: "",
			subnetId: "",
			securityGroupId: "",
			amiId: "",
		};
	}

	const cluster = config.ECS_CLUSTER_NAME!.trim();
	const subnets = parseCommaList(config.ECS_SUBNET_IDS);
	const securityGroups = parseCommaList(config.ECS_SECURITY_GROUP_IDS);
	const executionRoleArn = config.ECS_EXECUTION_ROLE_ARN!.trim();
	const assignPublicIp = (config.ECS_ASSIGN_PUBLIC_IP || "DISABLED").toUpperCase() === "ENABLED";
	const logGroup = (config.ECS_LOG_GROUP || "/ecs/smartdeploy-railpack").trim();
	const cpu = (config.ECS_TASK_CPU || "512").trim();
	const memory = (config.ECS_TASK_MEMORY || "1024").trim();

	if (!subnets.length || !securityGroups.length) {
		throw new Error("ECS_SUBNET_IDS and ECS_SECURITY_GROUP_IDS must list at least one id each.");
	}

	const vpcId = await describeSubnetVpcId(subnets[0]!, region, ws);
	const certificateArn = config.EC2_ACM_CERTIFICATE_ARN?.trim() || "";

	send("Ensuring shared ALB for ECS service...", "setup");
	const alb = await ensureSharedAlb({
		vpcId,
		subnetIds: subnets,
		region,
		ws,
		certificateArn: certificateArn || undefined,
	});

	await Promise.all(
		securityGroups.map((sg) => allowAlbToReachService(sg, alb.albSgId, containerPort, ws))
	);

	const tgName = awsNameChunk(`sd-${repoName}-${unitName}-tg`, 32);
	const tgArn = await ensureTargetGroup(tgName, vpcId, containerPort, region, ws, {
		targetType: "ip",
		healthCheckPath: "/",
	});

	const serviceLabel = deployConfig.serviceName?.trim() || repoName;
	const hostedUrl = hostedUrlFromSubdomain(deployConfig.hostedSubdomain);
	const hostedHost = hostedUrl?.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
	const hostname =
		buildServiceHostname(serviceLabel, hostedHost || undefined) ||
		buildServiceHostname(serviceLabel, undefined);
	const listenerArn = alb.httpsListenerArn || alb.httpListenerArn;
	if (hostname) {
		await ensureHostRule(listenerArn, hostname, tgArn, region, ws);
	} else {
		send("⚠️ Could not derive hostname for ALB rule; traffic may only match default listener behavior.", "setup");
	}

	const scheme = alb.httpsListenerArn ? "https" : "http";
	const baseUrl = hostname ? `${scheme}://${hostname}` : `${scheme}://${alb.dnsName}`;
	const serviceUrls = new Map<string, string>();
	serviceUrls.set(unitName, baseUrl);

	const ecs = new ECSClient(getAwsClientConfig(region));
	const serviceName = awsNameChunk(`sd-${repoName}-${unitName}`, 255);
	const family = awsNameChunk(`sd-${repoName}-${unitName}`, 200);

	const secretsArn = deployConfig.secretsArn?.trim() || "";
	let containerSecrets: { name: string; valueFrom: string }[] = [];
	let containerEnvironment = containerEnvFromDeploy(deployConfig.envVars);

	if (secretsArn) {
		send("Loading runtime environment from Secrets Manager...", "deploy");
		await ensureEcsExecutionRoleSecretsAccess(region);
		const secretObject = await getDeploymentEnvSecretObject({ region, secretsArn });
		const secretKeys = Object.keys(secretObject);
		containerSecrets = buildEcsContainerSecrets(secretsArn, secretKeys);
		containerEnvironment = [];
		send(`Injecting ${containerSecrets.length} secret(s) into the ECS task definition.`, "deploy");
	} else if (containerEnvironment.length > 0) {
		send(`Injecting ${containerEnvironment.length} environment variable(s) into the ECS task.`, "deploy");
	}

	send(`Registering Fargate task definition (${family})...`, "deploy");
	const registerOut = await ecs.send(
		new RegisterTaskDefinitionCommand({
			family,
			networkMode: "awsvpc",
			requiresCompatibilities: ["FARGATE"],
			cpu,
			memory,
			executionRoleArn,
			containerDefinitions: [
				{
					name: "app",
					image: imageUri,
					essential: true,
					portMappings: [{ containerPort, hostPort: containerPort, protocol: "tcp" }],
					environment: containerEnvironment,
					...(containerSecrets.length > 0 ? { secrets: containerSecrets } : {}),
					logConfiguration: {
						logDriver: "awslogs",
						options: {
							"awslogs-group": logGroup,
							"awslogs-region": region,
							"awslogs-stream-prefix": serviceName,
							"awslogs-create-group": "true",
						},
					},
				},
			],
		})
	);
	const taskDefinition = registerOut.taskDefinition?.taskDefinitionArn;
	if (!taskDefinition) throw new Error("ECS RegisterTaskDefinition did not return a task definition ARN");

	const describe = await ecs.send(
		new DescribeServicesCommand({
			cluster,
			services: [serviceName],
		})
	);
	const existing = describe.services?.find((s) => s.serviceName === serviceName && s.status !== "INACTIVE");

	if (existing?.serviceArn) {
		send(`Updating ECS service ${serviceName}...`, "deploy");
		await ecs.send(
			new UpdateServiceCommand({
				cluster,
				service: serviceName,
				taskDefinition,
				forceNewDeployment: true,
				desiredCount: 1,
			})
		);
	} else {
		send(`Creating ECS service ${serviceName}...`, "deploy");
		await ecs.send(
			new CreateServiceCommand({
				cluster,
				serviceName,
				taskDefinition,
				desiredCount: 1,
				launchType: "FARGATE",
				networkConfiguration: {
					awsvpcConfiguration: {
						subnets,
						securityGroups,
						assignPublicIp: assignPublicIp ? "ENABLED" : "DISABLED",
					},
				},
				loadBalancers: [
					{
						targetGroupArn: tgArn,
						containerName: "app",
						containerPort,
					},
				],
				deploymentConfiguration: {
					minimumHealthyPercent: 0,
					maximumPercent: 200,
				},
				healthCheckGracePeriodSeconds: 90,
			})
		);
	}

	send(`✅ ECS service updated. URL: ${baseUrl}`, "deploy");

	return {
		success: true,
		baseUrl,
		serviceUrls,
		instanceId: `ecs:${cluster}/${serviceName}`,
		publicIp: "",
		vpcId,
		subnetId: subnets[0] || "",
		securityGroupId: securityGroups[0] || "",
		amiId: "fargate",
		sharedAlbDns: alb.dnsName,
		albListenerArn: listenerArn,
		targetGroupArn: tgArn,
		taskDefinitionArn: taskDefinition,
	};
}

export const __testing = {
	pickPrimaryDeployment,
	buildServiceRolloutSummary,
	buildTaskFingerprint,
	buildTaskTransitionLines,
	isServiceRolloutComplete,
};
