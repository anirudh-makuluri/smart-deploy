import type { NetworkInterface, SecurityGroup, Subnet } from "@aws-sdk/client-ec2";
import type { Tag, Task, TaskDefinition } from "@aws-sdk/client-ecs";
import { pilotRuntimeTags, type ExpectedPilotRuntime, type PilotRuntimeScope } from "../../src/lib/aws/pilotRuntimeSchema";

export interface PilotRuntimeFixture {
	scope: PilotRuntimeScope; expected: ExpectedPilotRuntime; task: Task; definition: TaskDefinition; tags: Tag[];
	eni: NetworkInterface; subnet: Subnet; groups: SecurityGroup[]; gateway: NetworkInterface;
}
export function pilotRuntimeFixture(): PilotRuntimeFixture {
	const scope: PilotRuntimeScope = { accountId: "111122223333", region: "us-west-2", clusterName: "pilot", privateDomain: "apps.example.test",
		vpcId: "vpc-11111111", subnetIds: ["subnet-11111111"], gatewayGroupId: "sg-11111111", gatewayEniId: "eni-11111111",
		gatewayInstanceId: "i-11111111", tlsImage: "111122223333.dkr.ecr.us-west-2.amazonaws.com/pilot/tls@sha256:" + "b".repeat(64), timeoutMs: 5000, maxPending: 1 };
	const expected: ExpectedPilotRuntime = { appId: "11111111-1111-4111-8111-111111111111", bindingId: "22222222-2222-4222-8222-222222222222",
		releaseId: "33333333-3333-4333-8333-333333333333", runtimeId: "44444444-4444-4444-8444-444444444444", environment: "published",
		taskArn: "arn:aws:ecs:us-west-2:111122223333:task/pilot/" + "a".repeat(32), taskDefinitionArn: "arn:aws:ecs:us-west-2:111122223333:task-definition/pilot-web:1",
		executionRoleArn: "arn:aws:iam::111122223333:role/pilot-execution", appGroupId: "sg-22222222",
		appImage: "111122223333.dkr.ecr.us-west-2.amazonaws.com/pilot/app@sha256:" + "a".repeat(64), appPort: 3000, originPort: 8443 };
	const tags = Object.entries(pilotRuntimeTags(expected)).map(([key, value]) => ({ key, value }));
	const task: Task = { taskArn: expected.taskArn, taskDefinitionArn: expected.taskDefinitionArn, clusterArn: "arn:aws:ecs:us-west-2:111122223333:cluster/pilot",
		launchType: "FARGATE", lastStatus: "RUNNING", desiredStatus: "RUNNING", connectivity: "CONNECTED", platformFamily: "Linux", platformVersion: "1.4.0",
		cpu: "256", memory: "512", enableExecuteCommand: false, tags,
		containers: [{ name: "app", image: expected.appImage, imageDigest: "sha256:" + "a".repeat(64), lastStatus: "RUNNING" },
			{ name: "tls", image: scope.tlsImage, imageDigest: "sha256:" + "b".repeat(64), lastStatus: "RUNNING" }],
		attachments: [{ type: "ElasticNetworkInterface", status: "ATTACHED", details: [{ name: "networkInterfaceId", value: "eni-22222222" },
			{ name: "privateIPv4Address", value: "10.0.1.23" }, { name: "subnetId", value: scope.subnetIds[0] }] }] };
	const definition: TaskDefinition = { taskDefinitionArn: expected.taskDefinitionArn, status: "ACTIVE", networkMode: "awsvpc", executionRoleArn: expected.executionRoleArn,
		cpu: "256", memory: "512", requiresCompatibilities: ["FARGATE"], runtimePlatform: { cpuArchitecture: "X86_64", operatingSystemFamily: "LINUX" },
		containerDefinitions: [{ name: "app", image: expected.appImage, essential: true, portMappings: [{ containerPort: expected.appPort, protocol: "tcp" }],
			environment: [{ name: "APP_VALUE", value: "must-not-appear-in-observation" }],
			secrets: [{ name: "DOCUMENT_TOKEN", valueFrom: `arn:aws:ssm:${scope.region}:${scope.accountId}:parameter/smartdeploy/pilot/apps/${expected.appId}/published/document-token` }] },
			{ name: "tls", image: scope.tlsImage, essential: true, user: "10001", readonlyRootFilesystem: true, portMappings: [{ containerPort: expected.originPort, protocol: "tcp" }],
				secrets: [{ name: "SMARTDEPLOY_TLS_KEY", valueFrom: `arn:aws:ssm:${scope.region}:${scope.accountId}:parameter/smartdeploy/pilot/workloads/${expected.bindingId}/${expected.runtimeId}/tls-key` }] }] };
	const eni: NetworkInterface = { NetworkInterfaceId: "eni-22222222", OwnerId: scope.accountId, VpcId: scope.vpcId, SubnetId: scope.subnetIds[0],
		PrivateIpAddress: "10.0.1.23", Status: "in-use", RequesterManaged: true, InterfaceType: "interface", Groups: [{ GroupId: expected.appGroupId }] };
	const subnet: Subnet = { SubnetId: scope.subnetIds[0], VpcId: scope.vpcId, OwnerId: scope.accountId, State: "available" };
	const groups: SecurityGroup[] = [{ GroupId: expected.appGroupId, OwnerId: scope.accountId, VpcId: scope.vpcId,
		Tags: tags.filter((tag) => !["smartdeploy:release-id", "smartdeploy:runtime-id"].includes(tag.key)).map((tag) => ({ Key: tag.key, Value: tag.value })),
		IpPermissions: [{ IpProtocol: "tcp", FromPort: expected.originPort, ToPort: expected.originPort, UserIdGroupPairs: [{ GroupId: scope.gatewayGroupId, UserId: scope.accountId }] }] },
		{ GroupId: scope.gatewayGroupId, OwnerId: scope.accountId, VpcId: scope.vpcId }];
	const gateway: NetworkInterface = { NetworkInterfaceId: scope.gatewayEniId, OwnerId: scope.accountId, VpcId: scope.vpcId, Status: "in-use",
		Groups: [{ GroupId: scope.gatewayGroupId }], Attachment: { InstanceId: scope.gatewayInstanceId, Status: "attached", DeviceIndex: 0 } };
	return { scope, expected, task, definition, tags, eni, subnet, groups, gateway };
}
