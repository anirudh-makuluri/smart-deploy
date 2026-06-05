import {
	ECSClient,
	RegisterTaskDefinitionCommand,
	CreateServiceCommand,
	UpdateServiceCommand,
	DescribeServicesCommand,
} from "@aws-sdk/client-ecs";
import type { DeployConfig } from "../../app/types";
import config from "../../config";
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

type SendFn = (msg: string, stepId: string) => void;

function hostFromLiveUrl(liveUrl: string | undefined | null): string | undefined {
	if (!liveUrl?.trim()) return undefined;
	const h = liveUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
	return h || undefined;
}

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
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
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

	for (const sg of securityGroups) {
		await allowAlbToReachService(sg, alb.albSgId, containerPort, ws);
	}

	const tgName = awsNameChunk(`sd-${repoName}-${unitName}-tg`, 32);
	const tgArn = await ensureTargetGroup(tgName, vpcId, containerPort, region, ws, {
		targetType: "ip",
		healthCheckPath: "/",
	});

	const serviceLabel = deployConfig.serviceName?.trim() || repoName;
	const hostname =
		buildServiceHostname(serviceLabel, hostFromLiveUrl(deployConfig.liveUrl)) ||
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
					environment: containerEnvFromDeploy(deployConfig.envVars),
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
	};
}
