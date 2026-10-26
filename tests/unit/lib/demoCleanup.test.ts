import { beforeEach, describe, expect, it, vi } from "vitest";
import { DemoCleanup, parseDemoCleanupConfig, type DemoCleanupConfig } from "@/lib/aws/demoCleanup";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { EC2Client } from "@aws-sdk/client-ec2";
import { ECSClient } from "@aws-sdk/client-ecs";
import { SSMClient } from "@aws-sdk/client-ssm";
import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";

const mocks = vi.hoisted(() => ({ cfn: vi.fn(), ec2: vi.fn(), ecs: vi.fn(), ssm: vi.fn(), elb: vi.fn() }));
vi.mock("@aws-sdk/client-cloudformation", async load => { const original = await load<typeof import("@aws-sdk/client-cloudformation")>(); return { ...original, CloudFormationClient: class { send = mocks.cfn; } }; });
vi.mock("@aws-sdk/client-ec2", async load => { const original = await load<typeof import("@aws-sdk/client-ec2")>(); return { ...original, EC2Client: class { send = mocks.ec2; } }; });
vi.mock("@aws-sdk/client-ecs", async load => { const original = await load<typeof import("@aws-sdk/client-ecs")>(); return { ...original, ECSClient: class { send = mocks.ecs; } }; });
vi.mock("@aws-sdk/client-ssm", async load => { const original = await load<typeof import("@aws-sdk/client-ssm")>(); return { ...original, SSMClient: class { send = mocks.ssm; } }; });
vi.mock("@aws-sdk/client-elastic-load-balancing-v2", async load => { const original = await load<typeof import("@aws-sdk/client-elastic-load-balancing-v2")>(); return { ...original, ElasticLoadBalancingV2Client: class { send = mocks.elb; } }; });
const DEMO = "8cef73997867400d9213";
const CONFIG: DemoCleanupConfig = { accountId: "111122223333", region: "us-west-2", demoId: DEMO, appId: "9d888612-4141-4402-bbfd-23736a11bd46",
	expiresAt: 100000, clusterName: "pilot", workerInstanceId: "i-11111111", workerEniId: "eni-11111111", runtimes: [
		{ bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac", runtimeId: "997a2326-5b9b-4c08-aaef-45c618db01d3", environment: "published" },
		{ bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac", runtimeId: "91843492-f2ea-437c-a540-b144c3bc8ed2", environment: "published" },
		{ bindingId: "61502dbe-c33b-468c-8257-a904bc5b3653", runtimeId: "01567024-3f62-4ee3-bf6d-406896d1fa9b", environment: "preview" },
	] };
const PREFIX = "sdp-" + DEMO; const STACK = "sdp-demo-" + DEMO;
const names = ["published-v1", "published-v2", "preview"].map(name => PREFIX + "-" + name);
const arns = names.map(name => `arn:aws:ecs:us-west-2:111122223333:service/pilot/${name}`);
const tags = [{ Key: "smartdeploy:demo-id", Value: DEMO }];
const arn = `arn:aws:elasticloadbalancing:us-west-2:111122223333:loadbalancer/app/${PREFIX}-alb/1234`;
function fail(name: string, message = "private detail") { return Object.assign(new Error(message), { name }); }
function cleanup(config = CONFIG) { return new DemoCleanup(config, { cfn: new CloudFormationClient({}), ec2: new EC2Client({}), ecs: new ECSClient({}), ssm: new SSMClient({}), elb: new ElasticLoadBalancingV2Client({}) }); }
let stackTags = tags; let workerTags = tags; let gatewayTags = tags; let parameterTags = tags; let loadBalancerTags = tags;
let workerState = "running"; let stackState = "CREATE_COMPLETE"; let services: { serviceName: string; serviceArn: string; status: string; tags: { key: string; value: string }[]; desiredCount: number; runningCount: number; pendingCount: number }[];
beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	stackTags = tags; workerTags = tags; gatewayTags = tags; parameterTags = tags; loadBalancerTags = tags; workerState = "running"; stackState = "CREATE_COMPLETE";
	services = names.map((serviceName, index) => ({ serviceName, serviceArn: arns[index], status: "ACTIVE", tags: [{ key: tags[0].Key, value: DEMO }], desiredCount: 1, runningCount: 1, pendingCount: 0 }));
	mocks.cfn.mockImplementation(async command => {
		if (command.constructor.name === "DescribeStacksCommand") return { Stacks: [{ StackName: STACK, StackId: `arn:aws:cloudformation:us-west-2:111122223333:stack/${STACK}/uuid`, Tags: stackTags, StackStatus: stackState }] };
		if (command.constructor.name === "ListStackResourcesCommand") return { StackResourceSummaries: [{ LogicalResourceId: "GatewayGroup", ResourceType: "AWS::EC2::SecurityGroup", PhysicalResourceId: "sg-22222222" }] };
		return {};
	});
	mocks.ec2.mockImplementation(async command => {
		if (command.constructor.name === "DescribeInstancesCommand") return { Reservations: [{ OwnerId: CONFIG.accountId, Instances: [{ InstanceId: CONFIG.workerInstanceId, State: { Name: workerState }, Tags: workerTags,
			NetworkInterfaces: [{ NetworkInterfaceId: CONFIG.workerEniId, Attachment: { DeviceIndex: 0 }, Groups: [{ GroupId: "sg-11111111" }, { GroupId: "sg-22222222" }, { GroupId: "sg-33333333" }] }] }] }] };
		if (command.constructor.name === "DescribeSecurityGroupsCommand") return { SecurityGroups: [{ GroupId: "sg-22222222", OwnerId: CONFIG.accountId, Tags: gatewayTags }] };
		if (command.constructor.name === "DescribeNetworkInterfacesCommand") return { NetworkInterfaces: [{ NetworkInterfaceId: CONFIG.workerEniId, OwnerId: CONFIG.accountId,
			Attachment: { InstanceId: CONFIG.workerInstanceId, DeviceIndex: 0 }, TagSet: tags, Groups: [{ GroupId: "sg-11111111" }, { GroupId: "sg-22222222" }, { GroupId: "sg-33333333" }] }] };
		return {};
	});
	mocks.ecs.mockImplementation(async command => command.constructor.name === "DescribeServicesCommand" ? { services, failures: [] } : {});
	mocks.ssm.mockImplementation(async command => command.constructor.name === "ListTagsForResourceCommand" ? { TagList: parameterTags } : {});
	mocks.elb.mockImplementation(async command => {
		if (command.constructor.name === "DescribeLoadBalancersCommand") return { LoadBalancers: [{ LoadBalancerName: PREFIX + "-alb", LoadBalancerArn: arn }] };
		if (command.constructor.name === "DescribeTagsCommand") return { TagDescriptions: [{ ResourceArn: arn, Tags: loadBalancerTags }] };
		return {};
	});
});
function mutations(mock: typeof mocks.ec2, name: string) { return mock.mock.calls.filter(([command]) => command.constructor.name === name).map(([command]) => command.input); }
describe("bounded owned-demo cleanup", () => {
	it.each(["accountId", "demoId", "appId", "clusterName", "workerInstanceId", "workerEniId"] as const)("rejects a trailing line terminator in %s", key => {
		expect(() => parseDemoCleanupConfig(JSON.stringify({ ...CONFIG, [key]: CONFIG[key] + "\n" }))).toThrow();
	});
	it.each(["bindingId", "runtimeId"] as const)("rejects a trailing line terminator in runtime %s", key => {
		const config = structuredClone(CONFIG); config.runtimes[2][key] += "\n";
		expect(() => parseDemoCleanupConfig(JSON.stringify(config))).toThrow();
	});
	it("does no AWS work before the explicit expiry", async () => {
		expect(await cleanup().run(CONFIG.expiresAt - 1, new AbortController().signal)).toMatchObject({ status: "armed", requested: 0 });
		for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
	});
	it("stops only tagged owned resources and preserves all other attached security groups", async () => {
		const result = await cleanup().run(CONFIG.expiresAt, new AbortController().signal); expect(result.status).toBe("pending"); expect(result.worker).toBe("stop_requested"); expect(result.loadBalancer).toBe("delete_requested");
		expect(mutations(mocks.ec2, "StopInstancesCommand")).toEqual([{ InstanceIds: [CONFIG.workerInstanceId] }]);
		expect(mutations(mocks.ec2, "ModifyNetworkInterfaceAttributeCommand")).toEqual([{ NetworkInterfaceId: CONFIG.workerEniId, Groups: ["sg-11111111", "sg-33333333"] }]);
		expect(mutations(mocks.ecs, "UpdateServiceCommand")).toEqual(arns.map(service => ({ cluster: "pilot", service, desiredCount: 0 })));
		expect(mutations(mocks.elb, "DeleteLoadBalancerCommand")).toEqual([{ LoadBalancerArn: arn }]);
		expect(mutations(mocks.cfn, "DeleteStackCommand")).toEqual([{ StackName: STACK }]); expect(mutations(mocks.ssm, "DeleteParameterCommand")).toHaveLength(6);
		for (const mock of Object.values(mocks)) for (const [command, options] of mock.mock.calls) { expect(options.abortSignal).toBeInstanceOf(AbortSignal); expect(command.constructor.name).not.toMatch(/Terminate|DeleteTable|DeleteBucket|GetParameter/); }
	});
	it("never stops an instance whose ownership lease changed", async () => {
		workerTags = [{ ...tags[0], Value: "other-demo" }]; await expect(cleanup().run(CONFIG.expiresAt, new AbortController().signal)).rejects.toThrow("Owned demo cleanup unavailable.");
		expect(mutations(mocks.ec2, "StopInstancesCommand")).toEqual([]); expect(mutations(mocks.ec2, "ModifyNetworkInterfaceAttributeCommand")).toEqual([]);
		expect(mutations(mocks.elb, "DeleteLoadBalancerCommand")).toHaveLength(1);
	});
	it("preserves a foreign-tagged stack while independently stopping owned runtime and load balancer", async () => {
		stackTags = [{ ...tags[0], Value: "other-demo" }]; await expect(cleanup().run(CONFIG.expiresAt, new AbortController().signal)).rejects.toThrow();
		expect(mutations(mocks.cfn, "DeleteStackCommand")).toEqual([]); expect(mutations(mocks.ec2, "StopInstancesCommand")).toHaveLength(1); expect(mutations(mocks.elb, "DeleteLoadBalancerCommand")).toHaveLength(1);
	});
	it("does not alter a foreign gateway group, service or load balancer", async () => {
		gatewayTags = [{ ...tags[0], Value: "other-demo" }]; services[1].tags[0].value = "other-demo"; loadBalancerTags = [{ ...tags[0], Value: "other-demo" }];
		await expect(cleanup().run(CONFIG.expiresAt, new AbortController().signal)).rejects.toThrow();
		expect(mutations(mocks.ec2, "ModifyNetworkInterfaceAttributeCommand")).toEqual([]); expect(mutations(mocks.elb, "DeleteLoadBalancerCommand")).toEqual([]);
		expect(mutations(mocks.ecs, "UpdateServiceCommand").map(row => row.service)).toEqual([arns[0], arns[2]]);
	});
	it("retains foreign parameters and still attempts all other keys and independent cleanup", async () => {
		let calls = 0; mocks.ssm.mockImplementation(async command => command.constructor.name === "ListTagsForResourceCommand" ? { TagList: ++calls === 1 ? [] : tags } : {});
		await expect(cleanup().run(CONFIG.expiresAt, new AbortController().signal)).rejects.toThrow();
		expect(mutations(mocks.ssm, "DeleteParameterCommand")).toHaveLength(5); expect(mutations(mocks.cfn, "DeleteStackCommand")).toHaveLength(1);
	});
	it("is idempotent only after actual terminal cloud states are observed", async () => {
		workerState = "stopped"; workerTags = [];
		mocks.cfn.mockRejectedValue(fail("ValidationError", `Stack with id ${STACK} does not exist`));
		mocks.ecs.mockResolvedValue({ services: [], failures: names.map(name => ({ arn: name, reason: "MISSING" })) });
		mocks.elb.mockRejectedValue(fail("LoadBalancerNotFoundException")); mocks.ssm.mockRejectedValue(fail("InvalidResourceId"));
		expect(await cleanup().run(CONFIG.expiresAt, new AbortController().signal)).toEqual({ status: "complete", worker: "stopped", stack: "absent", loadBalancer: "absent", requested: 0 });
	});
	it.each([{ status: "INACTIVE", runningCount: 0, complete: true }, { status: "ACTIVE", runningCount: 0, complete: false }, { status: "INACTIVE", runningCount: 1, complete: false }])("observes a deleted service record only when terminal: %j", async row => {
		workerState = "stopped"; workerTags = [];
		mocks.cfn.mockRejectedValue(fail("ValidationError", `Stack with id ${STACK} does not exist`));
		mocks.elb.mockRejectedValue(fail("LoadBalancerNotFoundException")); mocks.ssm.mockRejectedValue(fail("InvalidResourceId"));
		services = services.map(service => ({ ...service, status: row.status, tags: [], desiredCount: 0, runningCount: row.runningCount, pendingCount: 0 }));
		if (row.complete) expect(await cleanup().run(CONFIG.expiresAt, new AbortController().signal)).toMatchObject({ status: "complete", requested: 0 });
		else await expect(cleanup().run(CONFIG.expiresAt, new AbortController().signal)).rejects.toThrow("Owned demo cleanup unavailable.");
		expect(mutations(mocks.ecs, "UpdateServiceCommand")).toEqual([]);
	});
	it("does not treat stack permission errors as absence or skip the other stop paths", async () => {
		mocks.cfn.mockRejectedValue(fail("AccessDeniedException", "private credential detail")); await expect(cleanup().run(CONFIG.expiresAt, new AbortController().signal)).rejects.toThrow("Owned demo cleanup unavailable.");
		expect(mutations(mocks.ec2, "StopInstancesCommand")).toHaveLength(1); expect(mutations(mocks.ecs, "UpdateServiceCommand")).toHaveLength(3); expect(mutations(mocks.elb, "DeleteLoadBalancerCommand")).toHaveLength(1);
	});
	it("rejects malformed input, cross-environment binding reuse and mutable caller configuration", async () => {
		for (const value of [{ ...CONFIG, region: "us-east-1" }, { ...CONFIG, force: true }, { ...CONFIG, runtimes: CONFIG.runtimes.map(row => ({ ...row, bindingId: CONFIG.runtimes[0].bindingId })) }]) expect(() => parseDemoCleanupConfig(JSON.stringify(value))).toThrow();
		const config = structuredClone(CONFIG); const instance = cleanup(config); config.workerInstanceId = "i-99999999";
		await instance.run(CONFIG.expiresAt, new AbortController().signal); expect(mutations(mocks.ec2, "StopInstancesCommand")).toEqual([{ InstanceIds: [CONFIG.workerInstanceId] }]);
	});
	it("rejects cancelled and invalid clocks before AWS access", async () => {
		await expect(cleanup().run(CONFIG.expiresAt, AbortSignal.abort())).rejects.toThrow(); await expect(cleanup().run(NaN, new AbortController().signal)).rejects.toThrow();
		for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
	});
});
