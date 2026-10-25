import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DescribeTaskDefinitionCommand, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { DescribeNetworkInterfacesCommand, DescribeSecurityGroupsCommand, DescribeSubnetsCommand } from "@aws-sdk/client-ec2";
import { pilotRuntimeFixture, type PilotRuntimeFixture } from "../../helpers/pilotRuntimeFixture";
const mocks = vi.hoisted(() => ({ ecs: vi.fn(), ec2: vi.fn(), destroyEcs: vi.fn(), destroyEc2: vi.fn(), ecsOptions: [] as unknown[], ec2Options: [] as unknown[] }));
vi.mock("@aws-sdk/client-ecs", async (original) => ({ ...await original<typeof import("@aws-sdk/client-ecs")>(),
	ECSClient: class { constructor(options: unknown) { mocks.ecsOptions.push(options); } send = mocks.ecs; destroy = mocks.destroyEcs; } }));
vi.mock("@aws-sdk/client-ec2", async (original) => ({ ...await original<typeof import("@aws-sdk/client-ec2")>(),
	EC2Client: class { constructor(options: unknown) { mocks.ec2Options.push(options); } send = mocks.ec2; destroy = mocks.destroyEc2; } }));
vi.mock("@/lib/aws/sdkClients", () => ({ getAwsClientConfig: (region: string) => ({ region }) }));
import { PilotRuntimeVerifier } from "@/lib/aws/pilotRuntimeVerifier";

let fixture: PilotRuntimeFixture; const verifiers: PilotRuntimeVerifier[] = [];
function verifier() { const value = new PilotRuntimeVerifier(fixture.scope); verifiers.push(value); return value; }
function signal() { return new AbortController().signal; }
beforeEach(() => {
	vi.clearAllMocks(); mocks.ecsOptions.length = 0; mocks.ec2Options.length = 0; fixture = pilotRuntimeFixture();
	mocks.ecs.mockImplementation(async (command: unknown) => {
		if (command instanceof DescribeTasksCommand) return { $metadata: {}, tasks: [fixture.task] };
		if (command instanceof DescribeTaskDefinitionCommand) return { $metadata: {}, taskDefinition: fixture.definition, tags: fixture.tags };
		throw new Error("Unexpected ECS command");
	});
	mocks.ec2.mockImplementation(async (command: unknown) => {
		if (command instanceof DescribeNetworkInterfacesCommand) return { $metadata: {}, NetworkInterfaces: command.input.NetworkInterfaceIds ? [fixture.eni] : [fixture.gateway] };
		if (command instanceof DescribeSecurityGroupsCommand) return { $metadata: {}, SecurityGroups: fixture.groups };
		if (command instanceof DescribeSubnetsCommand) return { $metadata: {}, Subnets: [fixture.subnet] };
		throw new Error("Unexpected EC2 command");
	});
});
afterEach(() => { for (const value of verifiers.splice(0)) value.close(); vi.useRealTimers(); });

describe("read-only AWS private runtime evidence", () => {
	it("checks actual SDK task/definition/ENI/subnet/full group responses and rechecks the task", async () => {
		const result = await verifier().inspect(fixture.expected, signal());
		expect(result).toEqual({ taskArn: fixture.expected.taskArn, taskDefinitionArn: fixture.expected.taskDefinitionArn,
			networkInterfaceId: fixture.eni.NetworkInterfaceId, privateIp: "10.0.1.23", subnetId: fixture.subnet.SubnetId, port: 8443,
			appImageDigest: "sha256:" + "a".repeat(64), tlsImageDigest: "sha256:" + "b".repeat(64), observedAt: expect.any(Date) });
		expect(JSON.stringify(result)).not.toContain("must-not-appear"); expect(JSON.stringify(result)).not.toContain("document-token");
		expect(mocks.ecs).toHaveBeenCalledTimes(3); expect(mocks.ec2).toHaveBeenCalledTimes(4);
		for (const [command, options] of [...mocks.ecs.mock.calls, ...mocks.ec2.mock.calls]) { expect(options.abortSignal).toBeInstanceOf(AbortSignal); expect(command.constructor.name).toMatch(/^Describe/); }
		expect(mocks.ecs.mock.calls[0][0].input).toEqual({ cluster: "pilot", tasks: [fixture.expected.taskArn], include: ["TAGS"] });
		expect(mocks.ec2.mock.calls[0][0].input).toEqual({ NetworkInterfaceIds: ["eni-22222222"] });
		expect(mocks.ec2.mock.calls[3][0].input).toEqual({ Filters: [{ Name: "group-id", Values: [fixture.scope.gatewayGroupId] }], MaxResults: 5 });
		expect(mocks.ecsOptions[0]).toMatchObject({ region: "us-west-2", maxAttempts: 2, requestHandler: { connectionTimeout: 2000, requestTimeout: 5000, httpsAgent: { maxSockets: 4 } } });
		expect(mocks.ec2Options[0]).toEqual(mocks.ecsOptions[0]);
	});
	it("accepts reordered group responses, default name-only overrides and explicit Fargate provider", async () => {
		fixture.groups.reverse(); fixture.task.capacityProviderName = "FARGATE"; fixture.task.overrides = { containerOverrides: [{ name: "app" }, { name: "tls" }] };
		await expect(verifier().inspect(fixture.expected, signal())).resolves.toHaveProperty("privateIp", "10.0.1.23");
	});
	const mismatches: [string, (value: PilotRuntimeFixture) => void][] = [
		["foreign task", (f) => { f.task.taskArn += "b"; }], ["foreign cluster", (f) => { f.task.clusterArn += "other"; }],
		["different revision", (f) => { f.task.taskDefinitionArn += "0"; }], ["EC2 launch", (f) => { f.task.launchType = "EC2"; }],
		["stopped task", (f) => { f.task.lastStatus = "STOPPED"; }], ["shutdown requested", (f) => { f.task.desiredStatus = "STOPPED"; }],
		["disconnected task", (f) => { f.task.connectivity = "DISCONNECTED"; }], ["stop timestamp", (f) => { f.task.stoppingAt = new Date(); }],
		["ECS Exec", (f) => { f.task.enableExecuteCommand = true; }], ["unexpected platform", (f) => { f.task.platformVersion = "1.3.0"; }],
		["oversized task", (f) => { f.task.cpu = "1024"; }], ["spot provider", (f) => { f.task.capacityProviderName = "FARGATE_SPOT"; }],
		["expanded ephemeral storage", (f) => { f.task.fargateEphemeralStorage = { sizeInGiB: 200 }; }],
		["wrong app digest", (f) => { f.task.containers![0].imageDigest = "sha256:" + "c".repeat(64); }],
		["missing TLS digest", (f) => { delete f.task.containers![1].imageDigest; }], ["extra sidecar", (f) => { f.task.containers!.push({ name: "unknown" }); }],
		["duplicate container", (f) => { f.task.containers![1].name = "app"; }], ["unhealthy TLS", (f) => { f.task.containers![1].healthStatus = "UNHEALTHY"; }],
		["foreign task tag", (f) => { f.task.tags![0].value = "other-app"; }], ["duplicate task tag", (f) => { f.task.tags!.push(f.task.tags![0]); }],
		["command override", (f) => { f.task.overrides = { containerOverrides: [{ name: "tls", command: ["bypass"] }] }; }],
		["role override", (f) => { f.task.overrides = { taskRoleArn: "arn:aws:iam::111122223333:role/admin" }; }],
		["extra attachment", (f) => { f.task.attachments!.push(f.task.attachments![0]); }],
		["metadata IP", (f) => { f.task.attachments![0].details![1].value = "169.254.169.254"; }],
		["unapproved subnet", (f) => { f.task.attachments![0].details![2].value = "subnet-99999999"; }],
		["definition revision mismatch", (f) => { f.definition.taskDefinitionArn += "0"; }], ["inactive definition", (f) => { f.definition.status = "INACTIVE"; }],
		["host networking", (f) => { f.definition.networkMode = "host"; }], ["shared PID", (f) => { f.definition.pidMode = "task"; }],
		["task IAM credentials", (f) => { f.definition.taskRoleArn = "arn:aws:iam::111122223333:role/admin"; }],
		["unapproved execution role", (f) => { f.definition.executionRoleArn += "-other"; }],
		["wrong TLS image", (f) => { f.definition.containerDefinitions![1].image = f.expected.appImage; }],
		["shared volume", (f) => { f.definition.volumes = [{ name: "credentials" }]; }],
		["privileged container", (f) => { f.definition.containerDefinitions![0].privileged = true; }],
		["mounted credentials", (f) => { f.definition.containerDefinitions![0].mountPoints = [{ sourceVolume: "secret", containerPath: "/secret" }]; }],
		["external env file", (f) => { f.definition.containerDefinitions![0].environmentFiles = [{ value: "arn:aws:s3:::secrets/file", type: "s3" }]; }],
		["wrong app port", (f) => { f.definition.containerDefinitions![0].portMappings![0].containerPort = 8443; }],
		["UDP origin", (f) => { f.definition.containerDefinitions![1].portMappings![0].protocol = "udp"; }],
		["gateway environment", (f) => { f.definition.containerDefinitions![0].environment!.push({ name: "SMARTDEPLOY_GATEWAY_TOKEN", value: "no" }); }],
		["cloud credentials env", (f) => { f.definition.containerDefinitions![0].environment!.push({ name: "AWS_ACCESS_KEY_ID", value: "no" }); }],
		["preview secret in published", (f) => { f.definition.containerDefinitions![0].secrets![0].valueFrom = f.definition.containerDefinitions![0].secrets![0].valueFrom!.replace("/published/", "/preview/"); }],
		["gateway key in app", (f) => { f.definition.containerDefinitions![0].secrets![0].valueFrom = "arn:aws:ssm:us-west-2:111122223333:parameter/smartdeploy/pilot/gateways/token"; }],
		["wrong workload key", (f) => { f.definition.containerDefinitions![1].secrets![0].valueFrom += "-other"; }],
		["TLS entrypoint override", (f) => { f.definition.containerDefinitions![1].entryPoint = ["bypass"]; }],
		["root TLS process", (f) => { f.definition.containerDefinitions![1].user = "0"; }],
		["mutable TLS filesystem", (f) => { f.definition.containerDefinitions![1].readonlyRootFilesystem = false; }],
		["foreign ENI owner", (f) => { f.eni.OwnerId = "999999999999"; }], ["foreign VPC", (f) => { f.eni.VpcId = "vpc-99999999"; }],
		["wrong ENI IP", (f) => { f.eni.PrivateIpAddress = "10.0.1.24"; }], ["detached ENI", (f) => { f.eni.Status = "available"; }],
		["unmanaged ENI", (f) => { f.eni.RequesterManaged = false; }], ["IPv6 path", (f) => { f.eni.Ipv6Addresses = [{ Ipv6Address: "2001:db8::1" }]; }],
		["extra task group", (f) => { f.eni.Groups!.push({ GroupId: f.scope.gatewayGroupId }); }],
		["subnet VPC mismatch", (f) => { f.subnet.VpcId = "vpc-99999999"; }], ["foreign group owner", (f) => { f.groups[0].OwnerId = "999999999999"; }],
		["missing group", (f) => { f.groups.pop(); }], ["foreign group tag", (f) => { f.groups[0].Tags![0].Value = "other-app"; }],
		["public IPv4 ingress", (f) => { f.groups[0].IpPermissions![0].IpRanges = [{ CidrIp: "0.0.0.0/0" }]; }],
		["public IPv6 ingress", (f) => { f.groups[0].IpPermissions![0].Ipv6Ranges = [{ CidrIpv6: "::/0" }]; }],
		["prefix-list ingress", (f) => { f.groups[0].IpPermissions![0].PrefixListIds = [{ PrefixListId: "pl-11111111" }]; }],
		["extra ingress", (f) => { f.groups[0].IpPermissions!.push({ IpProtocol: "-1" }); }],
		["all protocols", (f) => { f.groups[0].IpPermissions![0].IpProtocol = "-1"; }],
		["port range", (f) => { f.groups[0].IpPermissions![0].FromPort = 1; }],
		["foreign source group", (f) => { f.groups[0].IpPermissions![0].UserIdGroupPairs![0].GroupId = "sg-99999999"; }],
		["foreign source account", (f) => { f.groups[0].IpPermissions![0].UserIdGroupPairs![0].UserId = "999999999999"; }],
		["peering ingress", (f) => { f.groups[0].IpPermissions![0].UserIdGroupPairs![0].VpcPeeringConnectionId = "pcx-11111111"; }],
		["wrong gateway instance", (f) => { f.gateway.Attachment!.InstanceId = "i-99999999"; }],
	];
	it.each(mismatches)("rejects %s evidence", async (_, mutate) => { mutate(fixture); await expect(verifier().inspect(fixture.expected, signal())).rejects.toMatchObject({ status: 409 }); });
	it.each(["foreign account", "mutable image", "gateway group", "shared port", "unknown expectation"])("rejects %s before AWS calls", async (kind) => {
		const expected = { ...fixture.expected };
		if (kind === "foreign account") expected.taskArn = expected.taskArn.replace(fixture.scope.accountId, "999999999999");
		if (kind === "mutable image") expected.appImage = expected.appImage.split("@")[0] + ":latest";
		if (kind === "gateway group") expected.appGroupId = fixture.scope.gatewayGroupId;
		if (kind === "shared port") expected.appPort = expected.originPort;
		const supplied = kind === "unknown expectation" ? { ...expected, privateIp: "10.0.1.23" } : expected;
		await expect(verifier().inspect(supplied, signal())).rejects.toMatchObject({ status: 409 }); expect(mocks.ecs).not.toHaveBeenCalled(); expect(mocks.ec2).not.toHaveBeenCalled();
	});
	it("denies task drift during inspection", async () => {
		let reads = 0; const original = mocks.ecs.getMockImplementation()!;
		mocks.ecs.mockImplementation(async (command: unknown) => { if (command instanceof DescribeTasksCommand && ++reads === 2) return { tasks: [{ ...fixture.task, desiredStatus: "STOPPED" }] }; return original(command); });
		await expect(verifier().inspect(fixture.expected, signal())).rejects.toMatchObject({ status: 409 });
	});
	it("rejects a second network interface carrying the gateway group", async () => {
		const original = mocks.ec2.getMockImplementation()!;
		mocks.ec2.mockImplementation(async (command: unknown) => command instanceof DescribeNetworkInterfacesCommand && !command.input.NetworkInterfaceIds
			? { NetworkInterfaces: [fixture.gateway, { ...fixture.eni, Groups: [{ GroupId: fixture.scope.gatewayGroupId }] }] } : original(command));
		await expect(verifier().inspect(fixture.expected, signal())).rejects.toMatchObject({ status: 409 });
	});
	it("rejects incomplete pagination instead of overlooking gateway attachments", async () => {
		const original = mocks.ec2.getMockImplementation()!;
		mocks.ec2.mockImplementation(async (command: unknown) => command instanceof DescribeNetworkInterfacesCommand && !command.input.NetworkInterfaceIds ? { NetworkInterfaces: [fixture.gateway], NextToken: "more" } : original(command));
		await expect(verifier().inspect(fixture.expected, signal())).rejects.toMatchObject({ status: 409 });
	});
	it("redacts AWS failures", async () => {
		mocks.ecs.mockRejectedValueOnce(new Error("AWS request secret must not escape"));
		await expect(verifier().inspect(fixture.expected, signal())).rejects.toMatchObject({ status: 503, message: "Private app runtime verification unavailable." });
	});
	it.each(["task failure", "missing task", "duplicate tasks", "missing definition", "missing ENI", "missing subnet"])("rejects partial %s results", async (kind) => {
		if (kind === "task failure") mocks.ecs.mockResolvedValueOnce({ tasks: [fixture.task], failures: [{ arn: fixture.expected.taskArn, reason: "MISSING" }] });
		if (kind === "missing task") mocks.ecs.mockResolvedValueOnce({});
		if (kind === "duplicate tasks") mocks.ecs.mockResolvedValueOnce({ tasks: [fixture.task, fixture.task] });
		if (kind === "missing definition") {
			const original = mocks.ecs.getMockImplementation()!;
			mocks.ecs.mockImplementation(async (command: unknown) => command instanceof DescribeTaskDefinitionCommand ? {} : original(command));
		}
		if (kind === "missing ENI" || kind === "missing subnet") {
			const original = mocks.ec2.getMockImplementation()!;
			mocks.ec2.mockImplementation(async (command: unknown) => (kind === "missing ENI" && command instanceof DescribeNetworkInterfacesCommand && command.input.NetworkInterfaceIds)
				|| (kind === "missing subnet" && command instanceof DescribeSubnetsCommand) ? {} : original(command));
		}
		await expect(verifier().inspect(fixture.expected, signal())).rejects.toMatchObject({ status: 409 });
	});
	it("does not start calls for an already-cancelled request", async () => {
		const controller = new AbortController(); controller.abort(); await expect(verifier().inspect(fixture.expected, controller.signal)).rejects.toMatchObject({ status: 503 }); expect(mocks.ecs).not.toHaveBeenCalled();
	});
	it("bounds timeout and keeps admission occupied until an abort-ignoring SDK call settles", async () => {
		vi.useFakeTimers(); fixture.scope.timeoutMs = 10;
		let settle: (value: unknown) => void = () => {}; mocks.ecs.mockReturnValueOnce(new Promise((resolve) => { settle = resolve; }));
		const value = verifier(); const pending = expect(value.inspect(fixture.expected, signal())).rejects.toMatchObject({ status: 503 });
		await vi.advanceTimersByTimeAsync(10); await pending;
		await expect(value.inspect(fixture.expected, signal())).rejects.toMatchObject({ status: 503 }); expect(mocks.ecs).toHaveBeenCalledTimes(1);
		settle({ tasks: [fixture.task] }); await vi.advanceTimersByTimeAsync(0);
		await expect(value.inspect(fixture.expected, signal())).resolves.toHaveProperty("privateIp", "10.0.1.23");
	});
	it("cancels inflight SDK work on close and rejects further requests", async () => {
		mocks.ecs.mockReturnValueOnce(new Promise(() => {})); const value = verifier(); const pending = expect(value.inspect(fixture.expected, signal())).rejects.toMatchObject({ status: 503 });
		const activeSignal = mocks.ecs.mock.calls[0][1].abortSignal; value.close(); await pending; expect(activeSignal.aborted).toBe(true);
		await expect(value.inspect(fixture.expected, signal())).rejects.toMatchObject({ status: 503 }); value.close(); expect(mocks.destroyEcs).toHaveBeenCalledTimes(1); expect(mocks.destroyEc2).toHaveBeenCalledTimes(1);
	});
	it("propagates caller cancellation and discards late task results", async () => {
		let settle: (value: unknown) => void = () => {}; mocks.ecs.mockReturnValueOnce(new Promise((resolve) => { settle = resolve; }));
		const controller = new AbortController(); const value = verifier(); const pending = expect(value.inspect(fixture.expected, controller.signal)).rejects.toMatchObject({ status: 503 });
		const activeSignal = mocks.ecs.mock.calls[0][1].abortSignal; controller.abort(); await pending; expect(activeSignal.aborted).toBe(true);
		settle({ tasks: [fixture.task] }); await new Promise<void>((resolve) => setImmediate(resolve)); expect(mocks.ecs).toHaveBeenCalledTimes(1); expect(mocks.ec2).not.toHaveBeenCalled();
	});
});
