import jsonata from "jsonata";
import { demoCleanupWorkflow } from "../../scripts/demo-cleanup-workflow.mjs";

interface WorkflowState extends Record<string, unknown> { Type: string }
export interface CleanupWorkflow { StartAt: string; States: Record<string, WorkflowState> }
export class CleanupTaskError extends Error {
  constructor(public readonly code: string, public readonly detail: string = "AWS request failed") { super(code); }
}
export const CLEANUP_DEMO = "8cef73997867400d9213";
export const CLEANUP_EXPIRY = Date.parse("2026-10-28T12:00:00Z");
export const CLEANUP_VALUES: Record<string, string> = {
  "AWS::AccountId": "111122223333", "AWS::Region": "us-west-2", DemoId: CLEANUP_DEMO, AppId: "10000000-0000-4000-8000-000000000001",
  WorkerInstanceId: "i-11111111111111111", WorkerEniId: "eni-11111111111111111", ClusterName: "pilot",
  PublishedBinding: "20000000-0000-4000-8000-000000000001", PreviewBinding: "20000000-0000-4000-8000-000000000002",
  PublishedRuntimeV1: "30000000-0000-4000-8000-000000000001", PublishedRuntimeV2: "30000000-0000-4000-8000-000000000002", PreviewRuntime: "30000000-0000-4000-8000-000000000003",
  ExpiresAt: String(CLEANUP_EXPIRY), CleanupStartUtc: new Date(CLEANUP_EXPIRY).toISOString(), CleanupEndUtc: new Date(CLEANUP_EXPIRY + 1800000).toISOString(),
};
export function resolvedCleanupWorkflow(values: Record<string, string> = CLEANUP_VALUES): CleanupWorkflow {
  return JSON.parse(JSON.stringify(demoCleanupWorkflow()).replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw Error("Unknown fixture substitution"); return values[key];
  })) as CleanupWorkflow;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Expected workflow object");
  return value as Record<string, unknown>;
}
function string(value: unknown): string { if (typeof value !== "string") throw Error("Expected workflow string"); return value; }
type Transport = (resource: string, args: Record<string, unknown>) => Promise<unknown>;

/** Executes this graph's limited ASL subset with real JSONata; AWS transport and clock are controlled. */
export class CleanupWorkflowFixture {
  now = CLEANUP_EXPIRY - 60000;
  name = CLEANUP_DEMO;
  steps = 0;
  waits: number[] = [];
  pauseAtFirstWait = false;
  readonly expressions = new Map<string, ReturnType<typeof jsonata>>();
  constructor(private readonly transport: Transport) {}
  async #value(value: unknown, bindings: Record<string, unknown>): Promise<unknown> {
    if (typeof value === "string" && value.startsWith("{% ") && value.endsWith(" %}")) {
      let query = this.expressions.get(value); if (!query) { query = jsonata(value.slice(3, -3)); this.expressions.set(value, query); }
      return query.evaluate({}, bindings);
    }
    if (Array.isArray(value)) return Promise.all(value.map(entry => this.#value(entry, bindings)));
    if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, entry]) => [key, await this.#value(entry, bindings)])));
    return value;
  }
  async run(workflow: CleanupWorkflow = resolvedCleanupWorkflow(), initial: unknown = { mode: "cleanup" }): Promise<unknown> {
    let name = workflow.StartAt, input = initial;
    while (++this.steps < 15000) {
      const state = workflow.States[name]; if (!state) throw Error("Dangling state transition: " + name);
      const states: Record<string, unknown> = { input, context: { State: { EnteredTime: new Date(this.now).toISOString() }, Execution: { Name: this.name }, StateMachine: { Id: `arn:aws:states:us-west-2:111122223333:stateMachine:sdp-guard-${CLEANUP_DEMO}` } } };
      const evaluate = (value: unknown) => this.#value(value, { states });
      if (state.Type === "Fail") throw Error(string(state.Error));
      if (state.Type === "Choice") {
        const choices = state.Choices as Array<{ Condition: unknown; Next: string }>; let selected = string(state.Default);
        for (const choice of choices) if (await evaluate(choice.Condition) === true) { selected = choice.Next; break; }
        name = selected; continue;
      }
      if (state.Type === "Wait") {
        if (this.pauseAtFirstWait) throw Error("WaitingForExpiry");
        this.now = state.Timestamp ? Date.parse(string(await evaluate(state.Timestamp))) : this.now + Number(state.Seconds) * 1000;
        this.waits.push(this.now);
      } else if (state.Type === "Task") {
        try { states.result = await this.transport(string(state.Resource), object(await evaluate(state.Arguments))); }
        catch (error) {
          if (!(error instanceof CleanupTaskError)) throw error;
          const catcher = (state.Catch as Array<Record<string, unknown>>).find(row => (row.ErrorEquals as string[]).includes(error.code) || (row.ErrorEquals as string[]).includes("States.ALL"));
          if (!catcher) throw error; states.errorOutput = { Error: error.code, Cause: error.detail };
          input = await evaluate(catcher.Output); name = string(catcher.Next); continue;
        }
        input = await evaluate(state.Output);
      } else if (state.Type === "Parallel") {
        states.result = await Promise.all((state.Branches as CleanupWorkflow[]).map(branch => this.run(branch, structuredClone(input))));
        input = await evaluate(state.Output);
      } else if (state.Type === "Map") {
        const items = await evaluate(state.Items); if (!Array.isArray(items)) throw Error("Expected map items");
        const results: unknown[] = []; let index = 0;
        const consume = async () => { while (index < items.length) { const current = index++; results[current] = await this.run(state.ItemProcessor as CleanupWorkflow, items[current]); } };
        await Promise.all(Array.from({ length: Number(state.MaxConcurrency) }, consume)); states.result = results; input = await evaluate(state.Output);
      } else if (["Pass", "Succeed"].includes(state.Type)) { if (Object.hasOwn(state, "Output")) input = await evaluate(state.Output); }
      else throw Error("Unsupported fixture state: " + state.Type);
      if (state.End === true || state.Type === "Succeed") return input;
      name = string(state.Next);
    }
    throw Error("Fixture execution exceeded its state bound");
  }
}

export function cleanupAwsFixture() {
  const tags = [{ Key: "smartdeploy:demo-id", Value: CLEANUP_DEMO }];
  const prefix = "sdp-" + CLEANUP_DEMO, stackName = "sdp-demo-" + CLEANUP_DEMO;
  const albArn = `arn:aws:elasticloadbalancing:us-west-2:111122223333:loadbalancer/app/${prefix}-alb/1234567890123456`;
  const servicePrefix = "arn:aws:ecs:us-west-2:111122223333:service/pilot/";
  const calls: Array<{ resource: string; args: Record<string, unknown> }> = [];
  const model = { worker: "running", stack: true, alb: true, groups: ["sg-22222222222222222", "sg-11111111111111111", "sg-33333333333333333"],
    parameters: new Set<string>(), stoppedServices: new Set<string>(), foreignWorker: false, foreignEni: false, foreignAlb: false,
    paginatedStack: false, serviceRole: false, foreignService: "", stackDenied: false, parameterDenied: false };
  const transport: Transport = async (resource, args) => {
    calls.push({ resource, args }); const action = resource.split(":").at(-1);
    switch (action) {
      case "describeInstances": return { Reservations: [{ OwnerId: "111122223333", Instances: [{ InstanceId: CLEANUP_VALUES.WorkerInstanceId, State: { Name: model.worker }, Tags: model.foreignWorker ? [] : tags }] }] };
      case "stopInstances": model.worker = "stopped"; return {};
      case "describeServices": {
        const name = String((args.Services as string[])[0]); if (!model.stack) return { Services: [], Failures: [{ Arn: name, Reason: "MISSING" }] };
        const stopped = model.stoppedServices.has(name); return { Failures: [], Services: [{ ServiceArn: servicePrefix + name, ServiceName: name, Status: "ACTIVE", Tags: model.foreignService === name ? [] : tags, DesiredCount: stopped ? 0 : 1, RunningCount: stopped ? 0 : 1, PendingCount: 0 }] };
      }
      case "updateService": model.stoppedServices.add(String(args.Service).slice(servicePrefix.length)); return {};
      case "describeLoadBalancers": if (!model.alb) throw new CleanupTaskError("ElasticLoadBalancingV2.LoadBalancerNotFoundException"); return { LoadBalancers: [{ LoadBalancerName: prefix + "-alb", LoadBalancerArn: albArn }] };
      case "describeTags": return { TagDescriptions: [{ ResourceArn: albArn, Tags: model.foreignAlb ? [] : tags }] };
      case "deleteLoadBalancer": model.alb = false; return {};
      case "listTagsForResource": if (model.parameterDenied) throw new CleanupTaskError("Ssm.AccessDeniedException"); if (model.parameters.has(String(args.ResourceId))) throw new CleanupTaskError("Ssm.InvalidResourceIdException"); return { TagList: tags };
      case "deleteParameter": model.parameters.add(String(args.Name)); return {};
      case "describeStacks": if (model.stackDenied) throw new CleanupTaskError("CloudFormation.AccessDeniedException"); if (!model.stack) throw new CleanupTaskError("CloudFormation.CloudFormationException", "Stack with id " + stackName + " does not exist (Service: CloudFormation, Status Code: 400)"); return { Stacks: [{ StackName: stackName, StackId: `arn:aws:cloudformation:us-west-2:111122223333:stack/${stackName}/id`, StackStatus: "CREATE_COMPLETE", Tags: tags, ...(model.serviceRole ? { RoleARN: "arn:aws:iam::111122223333:role/unexpected" } : {}) }] };
      case "listStackResources": return { StackResourceSummaries: [{ LogicalResourceId: "GatewayGroup", ResourceType: "AWS::EC2::SecurityGroup", PhysicalResourceId: "sg-11111111111111111" }], ...(model.paginatedStack ? { NextToken: "more" } : {}) };
      case "describeSecurityGroups": return { SecurityGroups: [{ GroupId: "sg-11111111111111111", OwnerId: "111122223333", Tags: tags }] };
      case "describeNetworkInterfaces": return { NetworkInterfaces: [{ NetworkInterfaceId: CLEANUP_VALUES.WorkerEniId, OwnerId: "111122223333", Attachment: { InstanceId: CLEANUP_VALUES.WorkerInstanceId, DeviceIndex: 0 }, TagSet: model.foreignEni ? [] : tags, Groups: model.groups.map(GroupId => ({ GroupId })) }] };
      case "modifyNetworkInterfaceAttribute": model.groups = args.Groups as string[]; return {};
      case "deleteStack": model.stack = false; return {};
      default: throw Error("Unexpected AWS action: " + resource);
    }
  };
  return { model, transport, calls };
}
