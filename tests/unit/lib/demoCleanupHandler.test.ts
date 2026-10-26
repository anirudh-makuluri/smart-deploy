import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handler } from "@/lib/aws/demoCleanup";

const clients = vi.hoisted(() => {
	function client() {
		const options: unknown[] = []; const send = vi.fn(); const destroy = vi.fn();
		return { options, send, destroy, Client: class { constructor(config: unknown) { options.push(config); } send = send; destroy = destroy; } };
	}
	return { cfn: client(), ec2: client(), ecs: client(), ssm: client(), elb: client() };
});
vi.mock("@aws-sdk/client-cloudformation", async load => ({ ...await load<typeof import("@aws-sdk/client-cloudformation")>(), CloudFormationClient: clients.cfn.Client }));
vi.mock("@aws-sdk/client-ec2", async load => ({ ...await load<typeof import("@aws-sdk/client-ec2")>(), EC2Client: clients.ec2.Client }));
vi.mock("@aws-sdk/client-ecs", async load => ({ ...await load<typeof import("@aws-sdk/client-ecs")>(), ECSClient: clients.ecs.Client }));
vi.mock("@aws-sdk/client-ssm", async load => ({ ...await load<typeof import("@aws-sdk/client-ssm")>(), SSMClient: clients.ssm.Client }));
vi.mock("@aws-sdk/client-elastic-load-balancing-v2", async load => ({ ...await load<typeof import("@aws-sdk/client-elastic-load-balancing-v2")>(), ElasticLoadBalancingV2Client: clients.elb.Client }));

const DEMO = "8cef73997867400d9213";
const CONFIG = { accountId: "111122223333", region: "us-west-2", demoId: DEMO, appId: "9d888612-4141-4402-bbfd-23736a11bd46",
	expiresAt: 100000, clusterName: "pilot", workerInstanceId: "i-11111111", workerEniId: "eni-11111111", runtimes: [
		{ bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac", runtimeId: "997a2326-5b9b-4c08-aaef-45c618db01d3", environment: "published" },
		{ bindingId: "e0dbdb5e-bce7-4e6a-a122-c2c1734fe2ac", runtimeId: "91843492-f2ea-437c-a540-b144c3bc8ed2", environment: "published" },
		{ bindingId: "61502dbe-c33b-468c-8257-a904bc5b3653", runtimeId: "01567024-3f62-4ee3-bf6d-406896d1fa9b", environment: "preview" },
	] };
const CONTEXT = { invokedFunctionArn: "arn:aws:lambda:us-west-2:111122223333:function:demo" };
function missing(name: string) { return Object.assign(new Error("private AWS detail"), { name }); }
beforeEach(() => {
	vi.useFakeTimers(); vi.setSystemTime(CONFIG.expiresAt);
	vi.stubEnv("DEMO_CONFIG", JSON.stringify(CONFIG));
	for (const client of Object.values(clients)) { client.options.length = 0; client.send.mockReset(); client.destroy.mockReset(); }
	clients.cfn.send.mockRejectedValue(Object.assign(missing("ValidationError"), { message: "Stack does not exist" }));
	clients.ecs.send.mockResolvedValue({ services: [], failures: ["published-v1", "published-v2", "preview"].map(name => ({ arn: `sdp-${DEMO}-${name}`, reason: "MISSING" })) });
	clients.ssm.send.mockRejectedValue(missing("ParameterNotFound")); clients.elb.send.mockRejectedValue(missing("LoadBalancerNotFoundException"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("cleanup Lambda lifecycle", () => {
	it("arms without AWS requests and destroys every explicitly bounded regional client", async () => {
		vi.setSystemTime(CONFIG.expiresAt - 1);
		expect(await handler({ mode: "cleanup" }, CONTEXT)).toMatchObject({ status: "armed", requested: 0 });
		for (const [service, client] of Object.entries(clients)) {
			expect(client.options).toEqual([{ region: "us-west-2", endpoint: `https://${service === "cfn" ? "cloudformation" : service === "elb" ? "elasticloadbalancing" : service}.us-west-2.amazonaws.com`, maxAttempts: 2,
				requestHandler: { connectionTimeout: 1000, requestTimeout: 1800, throwOnRequestTimeout: true, httpsAgent: { keepAlive: true, maxSockets: 2 } } }]);
			expect(client.send).not.toHaveBeenCalled(); expect(client.destroy).toHaveBeenCalledOnce();
		}
		expect(vi.getTimerCount()).toBe(0);
	});
	it("rejects cross-account invocation and forced scope before constructing clients", async () => {
		await expect(handler({ mode: "cleanup" }, { invokedFunctionArn: CONTEXT.invokedFunctionArn.replace("111122223333", "444455556666") })).rejects.toThrow("Owned demo cleanup unavailable.");
		await expect(handler({ mode: "cleanup", force: true }, CONTEXT)).rejects.toThrow("Owned demo cleanup unavailable.");
		for (const client of Object.values(clients)) expect(client.options).toHaveLength(0);
	});
	it("enforces its deadline even when a transport ignores abort, and rejects late mutations", async () => {
		let finish = (_value: unknown) => {};
		clients.ec2.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		const result = handler({ mode: "cleanup" }, CONTEXT);
		const rejection = expect(result).rejects.toThrow("Owned demo cleanup unavailable.");
		await vi.advanceTimersByTimeAsync(45000); await rejection;
		for (const client of Object.values(clients)) expect(client.destroy).toHaveBeenCalledOnce();
		for (const client of Object.values(clients)) for (const [, options] of client.send.mock.calls) expect(options.abortSignal.aborted).toBe(true);
		finish({ Reservations: [{ OwnerId: CONFIG.accountId, Instances: [{ InstanceId: CONFIG.workerInstanceId, State: { Name: "running" }, Tags: [{ Key: "smartdeploy:demo-id", Value: DEMO }] }] }] });
		await vi.advanceTimersByTimeAsync(0);
		expect(clients.ec2.send.mock.calls.map(([command]) => command.constructor.name)).toEqual(["DescribeInstancesCommand"]);
		expect(vi.getTimerCount()).toBe(0);
	});
});
