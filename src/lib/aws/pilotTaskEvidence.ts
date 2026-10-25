import type { ContainerDefinition, Tag, Task, TaskDefinition } from "@aws-sdk/client-ecs";
import { pilotImageDigest, pilotRuntimeTags, requirePilotEvidence, requirePilotPrivateIp, requirePilotTags,
	type ExpectedPilotRuntime, type PilotRuntimeScope } from "./pilotRuntimeSchema";

export interface PilotTaskAddress { networkInterfaceId: string; privateIp: string; subnetId: string }

function attachmentValue(details: { name: string | undefined; value: string | undefined }[], name: string): string {
	const values = details.filter((item) => item.name === name); requirePilotEvidence(values.length === 1 && values[0].value); return values[0].value;
}
export function verifyPilotTask(task: Task, scope: PilotRuntimeScope, input: ExpectedPilotRuntime): PilotTaskAddress {
	requirePilotEvidence(task.taskArn === input.taskArn && task.taskDefinitionArn === input.taskDefinitionArn
		&& task.clusterArn === `arn:aws:ecs:${scope.region}:${scope.accountId}:cluster/${scope.clusterName}`
		&& task.launchType === "FARGATE" && task.lastStatus === "RUNNING" && task.desiredStatus === "RUNNING"
		&& task.connectivity === "CONNECTED" && !task.stoppedAt && !task.stoppingAt && !task.stopCode
		&& task.platformFamily === "Linux" && task.platformVersion === "1.4.0" && task.cpu === "256" && task.memory === "512"
		&& task.enableExecuteCommand === false && !task.containerInstanceArn && (!task.capacityProviderName || task.capacityProviderName === "FARGATE")
		&& (!task.ephemeralStorage || task.ephemeralStorage.sizeInGiB === 20)
		&& (!task.fargateEphemeralStorage || task.fargateEphemeralStorage.sizeInGiB === 20));
	requirePilotTags((task.tags ?? []).map((tag) => ({ key: tag.key, value: tag.value })), pilotRuntimeTags(input));
	const containers = task.containers ?? []; requirePilotEvidence(containers.length === 2);
	for (const [name, image] of [["app", input.appImage], ["tls", scope.tlsImage]]) {
		const matches = containers.filter((container) => container.name === name); const container = matches[0];
		requirePilotEvidence(matches.length === 1 && container.lastStatus === "RUNNING" && container.healthStatus !== "UNHEALTHY"
			&& container.exitCode === undefined && container.image === image && container.imageDigest === pilotImageDigest(scope, image)
			&& !container.managedAgents?.length);
	}
	const overrides = task.overrides ?? {};
	requirePilotEvidence(Object.entries(overrides).every(([key, value]) => key === "containerOverrides" || value === undefined));
	const seen = new Set<string>();
	for (const override of overrides.containerOverrides ?? []) {
		requirePilotEvidence(override.name && ["app", "tls"].includes(override.name) && !seen.has(override.name)
			&& Object.entries(override).every(([key, value]) => key === "name" || value === undefined)); seen.add(override.name);
	}
	const attachments = task.attachments ?? []; const attachment = attachments[0];
	requirePilotEvidence(attachments.length === 1 && attachment.type === "ElasticNetworkInterface" && attachment.status === "ATTACHED");
	const details = (attachment.details ?? []).map((item) => ({ name: item.name, value: item.value }));
	const networkInterfaceId = attachmentValue(details, "networkInterfaceId"); const privateIp = attachmentValue(details, "privateIPv4Address");
	const subnetId = attachmentValue(details, "subnetId");
	requirePilotEvidence(/^eni-[a-f0-9]{8}(?:[a-f0-9]{9})?$/.test(networkInterfaceId) && scope.subnetIds.includes(subnetId));
	requirePilotPrivateIp(privateIp); return { networkInterfaceId, privateIp, subnetId };
}

function verifyContainer(container: ContainerDefinition, scope: PilotRuntimeScope, input: ExpectedPilotRuntime): void {
	const isTls = container.name === "tls";
	requirePilotEvidence(container.name === "app" || isTls);
	requirePilotEvidence(container.image === (isTls ? scope.tlsImage : input.appImage) && container.essential === true
		&& !container.privileged && !container.mountPoints?.length && !container.volumesFrom?.length
		&& !container.environmentFiles?.length && !container.repositoryCredentials && !container.dockerSecurityOptions?.length
		&& !container.linuxParameters?.capabilities?.add?.length && !container.linuxParameters?.devices?.length
		&& !container.firelensConfiguration && !container.credentialSpecs?.length);
	const ports = container.portMappings ?? []; const port = ports[0]; const expectedPort = isTls ? input.originPort : input.appPort;
	requirePilotEvidence(ports.length === 1 && port.containerPort === expectedPort
		&& (port.hostPort === undefined || port.hostPort === expectedPort) && (port.protocol === undefined || port.protocol === "tcp")
		&& !port.containerPortRange);
	const environment = container.environment ?? [];
	requirePilotEvidence(new Set(environment.map((item) => item.name)).size === environment.length
		&& environment.every((item) => item.name && item.value !== undefined && !/^(AWS_|SMARTDEPLOY_GATEWAY_)/i.test(item.name)));
	const secretNames = new Set<string>();
	const appPrefix = `arn:aws:ssm:${scope.region}:${scope.accountId}:parameter/smartdeploy/pilot/apps/${input.appId}/${input.environment}/`;
	const tlsKey = `arn:aws:ssm:${scope.region}:${scope.accountId}:parameter/smartdeploy/pilot/workloads/${input.bindingId}/${input.runtimeId}/tls-key`;
	for (const secret of container.secrets ?? []) {
		requirePilotEvidence(secret.name && !secretNames.has(secret.name) && !environment.some((item) => item.name === secret.name)
			&& !/^(AWS_|SMARTDEPLOY_GATEWAY_)/i.test(secret.name) && secret.valueFrom);
		secretNames.add(secret.name);
		if (isTls) requirePilotEvidence(secret.name === "SMARTDEPLOY_TLS_KEY" && secret.valueFrom === tlsKey);
		else {
			const suffix = secret.valueFrom.slice(appPrefix.length);
			requirePilotEvidence(secret.valueFrom.startsWith(appPrefix) && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(suffix));
		}
	}
	if (isTls) requirePilotEvidence(secretNames.size === 1 && !container.entryPoint?.length && !container.command?.length
		&& container.readonlyRootFilesystem === true && /^[1-9]\d{0,8}(?::[1-9]\d{0,8})?$/.test(container.user ?? ""));
}

export function verifyPilotTaskDefinition(definition: TaskDefinition, tags: Tag[], scope: PilotRuntimeScope, input: ExpectedPilotRuntime): void {
	requirePilotEvidence(definition.taskDefinitionArn === input.taskDefinitionArn && definition.status === "ACTIVE"
		&& definition.networkMode === "awsvpc" && definition.executionRoleArn === input.executionRoleArn && !definition.taskRoleArn
		&& definition.cpu === "256" && definition.memory === "512" && definition.requiresCompatibilities?.length === 1
		&& definition.requiresCompatibilities[0] === "FARGATE" && definition.runtimePlatform?.cpuArchitecture === "X86_64"
		&& definition.runtimePlatform.operatingSystemFamily === "LINUX" && !definition.pidMode && !definition.ipcMode
		&& !definition.proxyConfiguration && !definition.volumes?.length && !definition.inferenceAccelerators?.length
		&& (!definition.ephemeralStorage || definition.ephemeralStorage.sizeInGiB === 20));
	requirePilotTags(tags.map((tag) => ({ key: tag.key, value: tag.value })), pilotRuntimeTags(input));
	const containers = definition.containerDefinitions ?? [];
	requirePilotEvidence(containers.length === 2 && new Set(containers.map((container) => container.name)).size === 2);
	for (const container of containers) verifyContainer(container, scope, input);
}
