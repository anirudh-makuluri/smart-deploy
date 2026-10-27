import { DescribeTaskDefinitionCommand, DescribeTasksCommand, ECSClient } from "@aws-sdk/client-ecs";
import { DescribeNetworkInterfacesCommand, DescribeSecurityGroupsCommand, DescribeSubnetsCommand, EC2Client } from "@aws-sdk/client-ec2";
import { getAwsClientConfig } from "./sdkClients";
import { ExpectedPilotRuntime, PilotRuntimeScope, PilotRuntimeVerificationError, pilotImageDigest, requirePilotEvidence,
	validatePilotExpectation, type PilotRuntimeObservation } from "./pilotRuntimeSchema";
import { verifyPilotTask, verifyPilotTaskDefinition } from "./pilotTaskEvidence";
import { verifyPilotNetwork } from "./pilotNetworkEvidence";

/** Read-only trusted controller component. Never accept these expectations from a browser.
 * This is a point-in-time consistency check, not provisioning, readiness or cost admission. */
export class PilotRuntimeVerifier {
	readonly #scope: PilotRuntimeScope;
	readonly #ecs: ECSClient;
	readonly #ec2: EC2Client;
	readonly #pending = new Set<AbortController>();
	#closed = false;
	constructor(scope: PilotRuntimeScope) {
		this.#scope = PilotRuntimeScope.parse(scope); pilotImageDigest(this.#scope, this.#scope.tlsImage);
		const configuration = { ...getAwsClientConfig(this.#scope.region), maxAttempts: 2,
			requestHandler: { connectionTimeout: 2000, requestTimeout: 5000, httpsAgent: { keepAlive: true, maxSockets: 4 } } };
		this.#ecs = new ECSClient(configuration); this.#ec2 = new EC2Client(configuration);
	}

	async #observe(input: ExpectedPilotRuntime, signal: AbortSignal): Promise<PilotRuntimeObservation> {
		const taskRequest = new DescribeTasksCommand({ cluster: this.#scope.clusterName, tasks: [input.taskArn], include: ["TAGS"] });
		const first = await this.#ecs.send(taskRequest, { abortSignal: signal }); signal.throwIfAborted();
		requirePilotEvidence(!first.failures?.length && first.tasks?.length === 1);
		const address = verifyPilotTask(first.tasks[0], this.#scope, input);
		const [definition, interfaces, subnets, groups, gatewayInterfaces] = await Promise.all([
			this.#ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: input.taskDefinitionArn, include: ["TAGS"] }), { abortSignal: signal }),
			this.#ec2.send(new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [address.networkInterfaceId] }), { abortSignal: signal }),
			this.#ec2.send(new DescribeSubnetsCommand({ SubnetIds: [address.subnetId] }), { abortSignal: signal }),
			this.#ec2.send(new DescribeSecurityGroupsCommand({ GroupIds: [input.appGroupId, this.#scope.gatewayGroupId] }), { abortSignal: signal }),
			this.#ec2.send(new DescribeNetworkInterfacesCommand({ Filters: [{ Name: "group-id", Values: [this.#scope.gatewayGroupId] }], MaxResults: 5 }), { abortSignal: signal }),
		]);
		signal.throwIfAborted();
		requirePilotEvidence(definition.taskDefinition && interfaces.NetworkInterfaces?.length === 1 && !interfaces.NextToken
			&& subnets.Subnets?.length === 1 && !subnets.NextToken && !groups.NextToken && !gatewayInterfaces.NextToken);
		verifyPilotTaskDefinition(definition.taskDefinition, definition.tags ?? [], this.#scope, input);
		verifyPilotNetwork(interfaces.NetworkInterfaces[0], subnets.Subnets[0], groups.SecurityGroups ?? [], gatewayInterfaces.NetworkInterfaces ?? [], this.#scope, input, address);
		// Tasks can disappear or enter shutdown while their metadata is being inspected.
		const last = await this.#ecs.send(taskRequest, { abortSignal: signal }); signal.throwIfAborted();
		requirePilotEvidence(!last.failures?.length && last.tasks?.length === 1);
		const current = verifyPilotTask(last.tasks[0], this.#scope, input);
		requirePilotEvidence(current.networkInterfaceId === address.networkInterfaceId && current.privateIp === address.privateIp && current.subnetId === address.subnetId);
		return { taskArn: input.taskArn, taskDefinitionArn: input.taskDefinitionArn, ...address, port: input.originPort,
			appImageDigest: pilotImageDigest(this.#scope, input.appImage), tlsImageDigest: pilotImageDigest(this.#scope, this.#scope.tlsImage), observedAt: new Date() };
	}

	async inspect(expected: ExpectedPilotRuntime, externalSignal: AbortSignal): Promise<PilotRuntimeObservation> {
		const parsed = ExpectedPilotRuntime.safeParse(expected);
		if (!parsed.success) throw new PilotRuntimeVerificationError(409);
		validatePilotExpectation(this.#scope, parsed.data);
		if (this.#closed || externalSignal.aborted || this.#pending.size >= this.#scope.maxPending) throw new PilotRuntimeVerificationError(503);
		const controller = new AbortController(); this.#pending.add(controller);
		const stop = () => controller.abort(); externalSignal.addEventListener("abort", stop, { once: true });
		let rejectAborted: () => void = () => {};
		const aborted = new Promise<never>((_, reject) => { rejectAborted = () => reject(new PilotRuntimeVerificationError(503)); });
		controller.signal.addEventListener("abort", rejectAborted, { once: true });
		const timer = setTimeout(stop, this.#scope.timeoutMs); timer.unref();
		const work = this.#observe(parsed.data, controller.signal);
		// Keep admission occupied until the SDK work settles, even if a transport ignores abort.
		void work.finally(() => this.#pending.delete(controller)).catch(() => {});
		try { return await Promise.race([work, aborted]); }
		catch (error) { if (error instanceof PilotRuntimeVerificationError) throw error; throw new PilotRuntimeVerificationError(503); }
		finally {
			clearTimeout(timer); externalSignal.removeEventListener("abort", stop); controller.signal.removeEventListener("abort", rejectAborted);
			controller.abort();
		}
	}
	close(): void {
		if (this.#closed) return;
		this.#closed = true; for (const controller of this.#pending) controller.abort(); this.#ecs.destroy(); this.#ec2.destroy();
	}
}
