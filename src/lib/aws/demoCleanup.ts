import { CloudFormationClient, DeleteStackCommand, DescribeStacksCommand, ListStackResourcesCommand } from "@aws-sdk/client-cloudformation";
import { DescribeInstancesCommand, DescribeNetworkInterfacesCommand, DescribeSecurityGroupsCommand, EC2Client, ModifyNetworkInterfaceAttributeCommand, StopInstancesCommand } from "@aws-sdk/client-ec2";
import { DescribeServicesCommand, ECSClient, UpdateServiceCommand } from "@aws-sdk/client-ecs";
import { DeleteLoadBalancerCommand, DescribeLoadBalancersCommand, DescribeTagsCommand, ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { DeleteParameterCommand, ListTagsForResourceCommand, SSMClient } from "@aws-sdk/client-ssm";

interface DemoRuntime { bindingId: string; runtimeId: string; environment: "published" | "preview" }
export interface DemoCleanupConfig {
	accountId: string; region: string; demoId: string; appId: string; expiresAt: number; clusterName: string;
	workerInstanceId: string; workerEniId: string; runtimes: DemoRuntime[];
}
export interface DemoCleanupResult { status: "armed" | "pending" | "complete"; worker: string; stack: string; loadBalancer: string; requested: number }
interface CleanupClients { cfn: CloudFormationClient; ec2: EC2Client; ecs: ECSClient; ssm: SSMClient; elb: ElasticLoadBalancingV2Client }
interface StackResource { LogicalResourceId: string | undefined; ResourceType: string | undefined; PhysicalResourceId: string | undefined }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OWNER = "smartdeploy:demo-id";
export class DemoCleanupError extends Error { constructor() { super("Owned demo cleanup unavailable."); } }
function requireOwned(value: unknown): asserts value { if (!value) throw new DemoCleanupError(); }
function record(value: unknown): Record<string, unknown> { requireOwned(value && typeof value === "object" && !Array.isArray(value)); return value as Record<string, unknown>; }
function exactKeys(value: Record<string, unknown>, keys: string[]): void { requireOwned(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))); }
function token(value: unknown, pattern: RegExp): value is string { return typeof value === "string" && value.trim() === value && pattern.test(value); }
function uuid(value: unknown): asserts value is string { requireOwned(token(value, UUID)); }
function ownedTags(tags: { Key: string | undefined; Value: string | undefined }[], id: string): boolean { const owner = tags.filter(tag => tag.Key === OWNER); return owner.length === 1 && owner[0].Value === id; }

export function parseDemoCleanupConfig(raw: string): DemoCleanupConfig {
	try {
		requireOwned(Buffer.byteLength(raw, "utf8") <= 3000); const value = record(JSON.parse(raw));
		exactKeys(value, ["accountId", "region", "demoId", "appId", "expiresAt", "clusterName", "workerInstanceId", "workerEniId", "runtimes"]);
		requireOwned(token(value.demoId, /^[a-f0-9]{20}$/)); uuid(value.appId);
		requireOwned(token(value.accountId, /^\d{12}$/) && value.region === "us-west-2"
			&& Number.isSafeInteger(value.expiresAt) && Number(value.expiresAt) > 0
			&& token(value.clusterName, /^[A-Za-z0-9_-]{1,255}$/)
			&& token(value.workerInstanceId, /^i-[a-f0-9]{8}(?:[a-f0-9]{9})?$/)
			&& token(value.workerEniId, /^eni-[a-f0-9]{8}(?:[a-f0-9]{9})?$/)
			&& Array.isArray(value.runtimes) && value.runtimes.length === 3);
		const runtimes = value.runtimes.map((input): DemoRuntime => {
			const row = record(input); exactKeys(row, ["bindingId", "runtimeId", "environment"]); uuid(row.bindingId); uuid(row.runtimeId);
			requireOwned(row.environment === "published" || row.environment === "preview");
			return { bindingId: row.bindingId, runtimeId: row.runtimeId, environment: row.environment };
		});
		requireOwned(new Set(runtimes.map(row => row.runtimeId)).size === 3 && runtimes.filter(row => row.environment === "published").length === 2
			&& runtimes.filter(row => row.environment === "preview").length === 1);
		const published = runtimes.filter(row => row.environment === "published");
		requireOwned(published[0].bindingId === published[1].bindingId && runtimes.find(row => row.environment === "preview")?.bindingId !== published[0].bindingId);
		return { accountId: value.accountId, region: value.region, demoId: value.demoId, appId: value.appId,
			expiresAt: Number(value.expiresAt), clusterName: value.clusterName, workerInstanceId: value.workerInstanceId,
			workerEniId: value.workerEniId, runtimes };
	} catch { throw new DemoCleanupError(); }
}

/** No broad account enumeration or app-data deletion. Caller IAM must match these owned boundaries. */
export class DemoCleanup {
	readonly #stackName: string;
	readonly #prefix: string;
	readonly #names: string[];
	#requested = 0;
	constructor(private readonly config: DemoCleanupConfig, private readonly clients: CleanupClients) {
		this.config = parseDemoCleanupConfig(JSON.stringify(config));
		this.#stackName = "sdp-demo-" + this.config.demoId; this.#prefix = "sdp-" + this.config.demoId;
		this.#names = ["published-v1", "published-v2", "preview"].map(name => this.#prefix + "-" + name);
	}
	async #stack(signal: AbortSignal): Promise<{ state: string; resources: StackResource[] }> {
		try {
			const result = await this.clients.cfn.send(new DescribeStacksCommand({ StackName: this.#stackName }), { abortSignal: signal });
			signal.throwIfAborted();
			requireOwned(result.Stacks?.length === 1); const stack = result.Stacks[0];
			requireOwned(stack.StackName === this.#stackName && stack.StackId?.startsWith(`arn:aws:cloudformation:${this.config.region}:${this.config.accountId}:stack/${this.#stackName}/`)
				&& ownedTags((stack.Tags ?? []).map(tag => ({ Key: tag.Key, Value: tag.Value })), this.config.demoId) && !stack.RoleARN);
			const resources = await this.clients.cfn.send(new ListStackResourcesCommand({ StackName: this.#stackName }), { abortSignal: signal });
			requireOwned(!resources.NextToken && resources.StackResourceSummaries && resources.StackResourceSummaries.length <= 50);
			return { state: stack.StackStatus ?? "unknown", resources: resources.StackResourceSummaries.map(row => ({ LogicalResourceId: row.LogicalResourceId, ResourceType: row.ResourceType, PhysicalResourceId: row.PhysicalResourceId })) };
		} catch (error) {
			if (error instanceof Error && error.name === "ValidationError" && /does not exist$/.test(error.message)) return { state: "absent", resources: [] };
			throw new DemoCleanupError();
		}
	}
	async #worker(resourceLookup: Promise<StackResource[]>, signal: AbortSignal): Promise<string> {
		const result = await this.clients.ec2.send(new DescribeInstancesCommand({ InstanceIds: [this.config.workerInstanceId] }), { abortSignal: signal });
		requireOwned(result.Reservations?.length === 1 && result.Reservations[0].OwnerId === this.config.accountId && result.Reservations[0].Instances?.length === 1);
		const worker = result.Reservations[0].Instances[0]; requireOwned(worker.InstanceId === this.config.workerInstanceId);
		signal.throwIfAborted();
		const state = worker.State?.Name;
		if (state === "stopped" && !ownedTags((worker.Tags ?? []).map(tag => ({ Key: tag.Key, Value: tag.Value })), this.config.demoId)) return "stopped";
		requireOwned(ownedTags((worker.Tags ?? []).map(tag => ({ Key: tag.Key, Value: tag.Value })), this.config.demoId));
		if (state === "running" || state === "pending") {
			await this.clients.ec2.send(new StopInstancesCommand({ InstanceIds: [this.config.workerInstanceId] }), { abortSignal: signal }); this.#requested++;
		} else requireOwned(state === "stopped" || state === "stopping");
		const gateway = (await resourceLookup).filter(row => row.LogicalResourceId === "GatewayGroup" && row.ResourceType === "AWS::EC2::SecurityGroup"); requireOwned(gateway.length <= 1);
		signal.throwIfAborted();
		if (gateway[0]?.PhysicalResourceId) {
			const id = gateway[0].PhysicalResourceId; const groups = await this.clients.ec2.send(new DescribeSecurityGroupsCommand({ GroupIds: [id] }), { abortSignal: signal });
			requireOwned(groups.SecurityGroups?.length === 1 && groups.SecurityGroups[0].GroupId === id && groups.SecurityGroups[0].OwnerId === this.config.accountId
				&& ownedTags((groups.SecurityGroups[0].Tags ?? []).map(tag => ({ Key: tag.Key, Value: tag.Value })), this.config.demoId));
			const primary = (worker.NetworkInterfaces ?? []).filter(eni => eni.Attachment?.DeviceIndex === 0);
			requireOwned(primary.length === 1 && primary[0].NetworkInterfaceId === this.config.workerEniId);
			const interfaces = await this.clients.ec2.send(new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [this.config.workerEniId] }), { abortSignal: signal });
			signal.throwIfAborted();
			requireOwned(!interfaces.NextToken && interfaces.NetworkInterfaces?.length === 1); const current = interfaces.NetworkInterfaces[0];
			requireOwned(current.NetworkInterfaceId === this.config.workerEniId && current.OwnerId === this.config.accountId
				&& current.Attachment?.InstanceId === this.config.workerInstanceId && current.Attachment.DeviceIndex === 0
				&& ownedTags((current.TagSet ?? []).map(tag => ({ Key: tag.Key, Value: tag.Value })), this.config.demoId));
			const attached = current.Groups ?? []; const retained = attached.filter(group => group.GroupId !== id).map(group => {
				requireOwned(typeof group.GroupId === "string" && /^sg-[a-f0-9]{8}(?:[a-f0-9]{9})?$/.test(group.GroupId)); return group.GroupId;
			});
			if (retained.length !== attached.length) {
				requireOwned(retained.length > 0);
				await this.clients.ec2.send(new ModifyNetworkInterfaceAttributeCommand({ NetworkInterfaceId: this.config.workerEniId, Groups: retained }), { abortSignal: signal }); this.#requested++;
			}
		}
		return state === "stopped" ? "stopped" : "stop_requested";
	}
	async #services(signal: AbortSignal): Promise<boolean> {
		const prefix = `arn:aws:ecs:${this.config.region}:${this.config.accountId}:service/${this.config.clusterName}/`;
		const arns = this.#names.map(name => prefix + name);
		const allowedArns = new Set(arns); const allowedNames = new Set(this.#names);
		const result = await this.clients.ecs.send(new DescribeServicesCommand({ cluster: this.config.clusterName, services: this.#names, include: ["TAGS"] }), { abortSignal: signal });
		signal.throwIfAborted();
		const services = result.services ?? []; const failures = result.failures ?? [];
		requireOwned(services.length + failures.length === 3 && failures.every(failure => failure.reason === "MISSING" && failure.arn
			&& (allowedArns.has(failure.arn) || allowedNames.has(failure.arn))));
		const observed = [...services.map(service => service.serviceArn), ...failures.map(failure => failure.arn && (failure.arn.startsWith(prefix) ? failure.arn : prefix + failure.arn))];
		requireOwned(new Set(observed).size === 3 && observed.every(arn => arn && allowedArns.has(arn)));
		const outcomes = await Promise.allSettled(services.map(async service => {
			signal.throwIfAborted();
			requireOwned(service.serviceArn && allowedArns.has(service.serviceArn) && service.serviceName && service.serviceArn === prefix + service.serviceName);
			// Deleted service records can outlive their tags; observe only, never mutate them.
			if (service.status === "INACTIVE" && service.desiredCount === 0 && service.runningCount === 0 && service.pendingCount === 0) return true;
			requireOwned(ownedTags((service.tags ?? []).map(tag => ({ Key: tag.key, Value: tag.value })), this.config.demoId));
			if (service.desiredCount !== 0) { await this.clients.ecs.send(new UpdateServiceCommand({ cluster: this.config.clusterName, service: service.serviceArn, desiredCount: 0 }), { abortSignal: signal }); this.#requested++; }
			return service.runningCount === 0 && service.pendingCount === 0;
		}));
		if (outcomes.some(outcome => outcome.status === "rejected")) throw new DemoCleanupError();
		return outcomes.every(outcome => outcome.status === "fulfilled" && outcome.value);
	}
	async #loadBalancer(signal: AbortSignal): Promise<string> {
		try {
			const name = this.#prefix + "-alb";
			const result = await this.clients.elb.send(new DescribeLoadBalancersCommand({ Names: [name] }), { abortSignal: signal });
			signal.throwIfAborted();
			requireOwned(result.LoadBalancers?.length === 1); const loadBalancer = result.LoadBalancers[0];
			const arn = loadBalancer.LoadBalancerArn;
			requireOwned(loadBalancer.LoadBalancerName === name && typeof arn === "string" && arn.startsWith(`arn:aws:elasticloadbalancing:${this.config.region}:${this.config.accountId}:loadbalancer/app/${name}/`));
			const tags = await this.clients.elb.send(new DescribeTagsCommand({ ResourceArns: [arn] }), { abortSignal: signal });
			signal.throwIfAborted();
			requireOwned(tags.TagDescriptions?.length === 1 && tags.TagDescriptions[0].ResourceArn === arn
				&& ownedTags((tags.TagDescriptions[0].Tags ?? []).map(tag => ({ Key: tag.Key, Value: tag.Value })), this.config.demoId));
			await this.clients.elb.send(new DeleteLoadBalancerCommand({ LoadBalancerArn: arn }), { abortSignal: signal }); this.#requested++;
			return "delete_requested";
		} catch (error) { if (error instanceof Error && error.name === "LoadBalancerNotFoundException") return "absent"; throw new DemoCleanupError(); }
	}
	async #parameters(signal: AbortSignal): Promise<void> {
		const names = this.config.runtimes.flatMap(runtime => [`/smartdeploy/pilot/gateways/${runtime.bindingId}/${runtime.runtimeId}`, `/smartdeploy/pilot/workloads/${runtime.bindingId}/${runtime.runtimeId}/tls-key`]);
		const outcomes = await Promise.allSettled(names.map(async name => {
				try {
					signal.throwIfAborted();
					const tags = await this.clients.ssm.send(new ListTagsForResourceCommand({ ResourceType: "Parameter", ResourceId: name }), { abortSignal: signal });
					signal.throwIfAborted();
					requireOwned(ownedTags((tags.TagList ?? []).map(tag => ({ Key: tag.Key, Value: tag.Value })), this.config.demoId));
					await this.clients.ssm.send(new DeleteParameterCommand({ Name: name }), { abortSignal: signal }); this.#requested++;
				} catch (error) { if (!(error instanceof Error && ["ParameterNotFound", "InvalidResourceId"].includes(error.name))) throw new DemoCleanupError(); }
		}));
		if (outcomes.some(outcome => outcome.status === "rejected")) throw new DemoCleanupError();
	}
	async run(now: number, signal: AbortSignal): Promise<DemoCleanupResult> {
		requireOwned(Number.isSafeInteger(now) && !signal.aborted && this.config.expiresAt <= now + 7200000); this.#requested = 0;
		if (now < this.config.expiresAt) return { status: "armed", worker: "not_inspected", stack: "not_inspected", loadBalancer: "not_inspected", requested: 0 };
		const failures: string[] = [];
		const stackLookup = this.#stack(signal).catch(() => { failures.push("stack_inspection"); return { state: "unknown", resources: [] as StackResource[] }; });
		const [worker, stopped, loadBalancer, parameters] = await Promise.allSettled([
			this.#worker(stackLookup.then(stack => stack.resources), signal), this.#services(signal), this.#loadBalancer(signal), this.#parameters(signal),
		]);
		for (const [index, outcome] of [worker, stopped, loadBalancer, parameters].entries()) if (outcome.status === "rejected") failures.push(["worker", "services", "load_balancer", "parameters"][index]);
		const stack = await stackLookup;
		signal.throwIfAborted();
		if (!["unknown", "absent", "DELETE_IN_PROGRESS"].includes(stack.state)) {
			try { await this.clients.cfn.send(new DeleteStackCommand({ StackName: this.#stackName }), { abortSignal: signal }); this.#requested++; }
			catch { failures.push("stack_delete"); }
		}
		signal.throwIfAborted(); if (failures.length) throw new DemoCleanupError();
		requireOwned(worker.status === "fulfilled" && stopped.status === "fulfilled" && loadBalancer.status === "fulfilled");
		return { status: worker.value === "stopped" && stopped.value && stack.state === "absent" && loadBalancer.value === "absent" ? "complete" : "pending", worker: worker.value, stack: stack.state, loadBalancer: loadBalancer.value, requested: this.#requested };
	}
}

export async function handler(event: unknown, context: { invokedFunctionArn: string }): Promise<DemoCleanupResult> {
	const input = record(event); exactKeys(input, ["mode"]); requireOwned(input.mode === "cleanup");
	const config = parseDemoCleanupConfig(process.env.DEMO_CONFIG ?? ""); const arn = context.invokedFunctionArn.split(":");
	requireOwned(arn[3] === config.region && arn[4] === config.accountId);
	const options = { region: config.region, maxAttempts: 2, requestHandler: { connectionTimeout: 1000, requestTimeout: 1800, throwOnRequestTimeout: true, httpsAgent: { keepAlive: true, maxSockets: 2 } } };
	const clients = { cfn: new CloudFormationClient({ ...options, endpoint: `https://cloudformation.${config.region}.amazonaws.com` }),
		ec2: new EC2Client({ ...options, endpoint: `https://ec2.${config.region}.amazonaws.com` }), ecs: new ECSClient({ ...options, endpoint: `https://ecs.${config.region}.amazonaws.com` }),
		ssm: new SSMClient({ ...options, endpoint: `https://ssm.${config.region}.amazonaws.com` }), elb: new ElasticLoadBalancingV2Client({ ...options, endpoint: `https://elasticloadbalancing.${config.region}.amazonaws.com` }) };
	const controller = new AbortController(); let expire = () => {};
	const deadline = new Promise<never>((_, reject) => { expire = () => { controller.abort(); reject(new DemoCleanupError()); }; });
	const timer = setTimeout(expire, 45000);
	try { return await Promise.race([new DemoCleanup(config, clients).run(Date.now(), controller.signal), deadline]); }
	finally { clearTimeout(timer); controller.abort(); for (const client of Object.values(clients)) client.destroy(); }
}
