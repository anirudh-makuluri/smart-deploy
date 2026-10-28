// Native AWS SDK integrations only. Inputs never choose resources, credentials or expiry.
const expr = value => `{% ${value} %}`;
const cfg = "$states.input.config";
const response = "$states.input.response";
const now = "$toMillis($states.context.State.EnteredTime)";
const starts = (value, prefix) => `$substring(${value}, 0, $length(${prefix})) = ${prefix}`;
const owned = tags => `$count((${tags})[Key='smartdeploy:demo-id']) = 1 and (${tags})[Key='smartdeploy:demo-id'].Value = ${cfg}.demoId`;
const merge = fields => expr(`$merge([$states.input, {${fields}}])`);
const check = (condition, next, fallback = "Pending") => ({ Type: "Choice", Choices: [{ Condition: expr(condition), Next: next }], Default: fallback });
const pass = (Output, next) => ({ Type: "Pass", Output, ...(next ? { Next: next } : { End: true }) });
function task(service, action, Arguments, next, fields = `"response": $states.result`, failure = "Pending") {
  return { Type: "Task", Resource: `arn:aws:states:::aws-sdk:${service}:${action}`, Arguments, TimeoutSeconds: 10,
    Output: merge(fields), Catch: [{ ErrorEquals: ["States.ALL"], Output: merge('"error": $states.errorOutput'), Next: failure }], Next: next };
}
function graph(start, states) {
  const all = { ...states, Done: pass(true), Pending: pass(false) };
  const rename = name => start + "-" + name;
  const entries = Object.entries(all).map(([name, state]) => [rename(name), { ...state,
    ...(state.Next ? { Next: rename(state.Next) } : {}), ...(state.Default ? { Default: rename(state.Default) } : {}),
    ...(state.Choices ? { Choices: state.Choices.map(choice => ({ ...choice, Next: rename(choice.Next) })) } : {}),
    ...(state.Catch ? { Catch: state.Catch.map(catcher => ({ ...catcher, Next: rename(catcher.Next) })) } : {}),
  }]);
  return { StartAt: rename(start), States: Object.fromEntries(entries) };
}
function mutation(states, name, service, action, args, next = "Pending") {
  states["Admit" + name] = check(`${now} >= ${cfg}.expiresAt and ${now} < ${cfg}.expiresAt + 1800000`, name);
  states[name] = task(service, action, args, next);
  return "Admit" + name;
}
function worker() {
  const instance = `${response}.Reservations[0].Instances[0]`;
  const states = {
    ReadWorker: task("ec2", "describeInstances", { InstanceIds: [expr(cfg + ".workerInstanceId")] }, "WorkerIdentity"),
    WorkerIdentity: check(`$count(${response}.Reservations) = 1 and ${response}.Reservations[0].OwnerId = ${cfg}.accountId and $count(${response}.Reservations[0].Instances) = 1 and ${instance}.InstanceId = ${cfg}.workerInstanceId`, "AlreadyStopped"),
    AlreadyStopped: check(`${instance}.State.Name = 'stopped'`, "Done", "WorkerLease"),
    WorkerLease: check(owned(instance + ".Tags"), "WorkerState"),
    WorkerState: { Type: "Choice", Choices: [{ Condition: expr(`${instance}.State.Name in ['running','pending']`), Next: "AdmitStopWorker" }], Default: "Pending" },
  };
  mutation(states, "StopWorker", "ec2", "stopInstances", { InstanceIds: [expr(cfg + ".workerInstanceId")] });
  return graph("ReadWorker", states);
}
function services() {
  const service = `${response}.Services[0]`, name = "$states.input.serviceName";
  const arn = `${cfg}.servicePrefix & ${name}`;
  const states = {
    ReadService: task("ecs", "describeServices", { Cluster: expr(cfg + ".clusterName"), Services: [expr(name)], Include: ["TAGS"] }, "MissingService"),
    MissingService: check(`$count(${response}.Services) = 0 and $count(${response}.Failures) = 1 and ${response}.Failures[0].Reason = 'MISSING' and ${response}.Failures[0].Arn in [${name}, ${arn}]`, "Done", "ServiceIdentity"),
    ServiceIdentity: check(`$count(${response}.Services) = 1 and $count(${response}.Failures) = 0 and ${service}.ServiceArn = ${arn} and ${service}.ServiceName = ${name}`, "InactiveService"),
    InactiveService: check(`${service}.Status = 'INACTIVE' and ${service}.DesiredCount = 0 and ${service}.RunningCount = 0 and ${service}.PendingCount = 0`, "Done", "ServiceLease"),
    ServiceLease: check(owned(service + ".Tags"), "ServiceCount"),
    ServiceCount: check(`${service}.DesiredCount = 0`, "ServiceStopped", "AdmitStopService"),
    ServiceStopped: check(`${service}.RunningCount = 0 and ${service}.PendingCount = 0`, "Done"),
  };
  mutation(states, "StopService", "ecs", "updateService", { Cluster: expr(cfg + ".clusterName"), Service: expr(arn), DesiredCount: 0 });
  return { StartAt: "Services", States: { Services: { Type: "Map", MaxConcurrency: 2,
    Items: expr(`$map(${cfg}.services, function($name){{'config': ${cfg}, 'serviceName': $name}})`),
    ItemProcessor: { ProcessorConfig: { Mode: "INLINE" }, ...graph("ReadService", states) }, Output: expr("$count($states.result[$ = true]) = 3"), End: true } } };
}
function loadBalancer() {
  const alb = `${response}.LoadBalancers[0]`;
  const states = {
    ReadAlb: task("elasticloadbalancingv2", "describeLoadBalancers", { Names: [expr(cfg + ".albName")] }, "AlbIdentity", `"response": $states.result, "albArn": $states.result.LoadBalancers[0].LoadBalancerArn`, "AlbError"),
    AlbError: check("$states.input.error.Error = 'ElasticLoadBalancingV2.LoadBalancerNotFoundException'", "Done"),
    AlbIdentity: check(`$count(${response}.LoadBalancers) = 1 and ${alb}.LoadBalancerName = ${cfg}.albName and ${starts('$states.input.albArn', cfg + '.albPrefix')}`, "ReadAlbTags"),
    ReadAlbTags: task("elasticloadbalancingv2", "describeTags", { ResourceArns: [expr("$states.input.albArn")] }, "AlbLease"),
    AlbLease: check(`$count(${response}.TagDescriptions) = 1 and ${response}.TagDescriptions[0].ResourceArn = $states.input.albArn and ${owned(response + ".TagDescriptions[0].Tags")}`, "AdmitDeleteAlb"),
  };
  mutation(states, "DeleteAlb", "elasticloadbalancingv2", "deleteLoadBalancer", { LoadBalancerArn: expr("$states.input.albArn") });
  return graph("ReadAlb", states);
}
function parameters() {
  const name = "$states.input.parameterName";
  const states = {
    ReadParameterTags: task("ssm", "listTagsForResource", { ResourceType: "Parameter", ResourceId: expr(name) }, "ParameterLease", '"response": $states.result', "ParameterError"),
    ParameterError: check("$states.input.error.Error in ['Ssm.ParameterNotFoundException','Ssm.InvalidResourceIdException']", "Done"),
    ParameterLease: check(owned(response + ".TagList"), "AdmitDeleteParameter"),
  };
  mutation(states, "DeleteParameter", "ssm", "deleteParameter", { Name: expr(name) });
  return { StartAt: "Parameters", States: { Parameters: { Type: "Map", MaxConcurrency: 2,
    Items: expr(`$map(${cfg}.parameters, function($name){{'config': ${cfg}, 'parameterName': $name}})`),
    ItemProcessor: { ProcessorConfig: { Mode: "INLINE" }, ...graph("ReadParameterTags", states) }, Output: expr("$count($states.result[$ = true]) = 6"), End: true } } };
}
function stack() {
  const stored = "$states.input.stack", group = "$states.input.gatewayGroup", eni = `${response}.NetworkInterfaces[0]`;
  const states = {
    ReadStack: task("cloudformation", "describeStacks", { StackName: expr(cfg + ".stackName") }, "StackIdentity", '"stack": $states.result.Stacks[0], "response": $states.result', "StackError"),
    StackError: check(`$states.input.error.Error in ['CloudFormation.CloudFormationException','CloudFormation.ValidationException','CloudFormation.ValidationErrorException'] and $contains($states.input.error.Cause, 'Stack with id ' & ${cfg}.stackName & ' does not exist')`, "Done"),
    StackIdentity: check(`$count(${response}.Stacks) = 1 and ${stored}.StackName = ${cfg}.stackName and ${starts(stored + '.StackId', cfg + '.stackPrefix')} and ($not($exists(${stored}.RoleARN)) or ${stored}.RoleARN = '') and ${owned(stored + ".Tags")}`, "ReadResources"),
    ReadResources: task("cloudformation", "listStackResources", { StackName: expr(cfg + ".stackName") }, "ResourceBounds", `"response": $states.result, "gatewayGroups": [$states.result.StackResourceSummaries[LogicalResourceId='GatewayGroup' and ResourceType='AWS::EC2::SecurityGroup'].PhysicalResourceId]`),
    ResourceBounds: check(`$not($exists(${response}.NextToken)) and $exists(${response}.StackResourceSummaries) and $count(${response}.StackResourceSummaries) <= 50 and $count($states.input.gatewayGroups) <= 1`, "HasGatewayGroup"),
    HasGatewayGroup: check("$count($states.input.gatewayGroups) = 1", "ChooseGatewayGroup", "StackDeleting"),
    ChooseGatewayGroup: pass(merge('"gatewayGroup": $states.input.gatewayGroups[0]'), "ReadGroup"),
    ReadGroup: task("ec2", "describeSecurityGroups", { GroupIds: [expr(group)] }, "GroupLease"),
    GroupLease: check(`$count(${response}.SecurityGroups) = 1 and ${response}.SecurityGroups[0].GroupId = ${group} and ${response}.SecurityGroups[0].OwnerId = ${cfg}.accountId and ${owned(response + ".SecurityGroups[0].Tags")}`, "ReadInterface"),
    ReadInterface: task("ec2", "describeNetworkInterfaces", { NetworkInterfaceIds: [expr(cfg + ".workerEniId")] }, "InterfaceLease"),
    InterfaceLease: check(`$not($exists(${response}.NextToken)) and $count(${response}.NetworkInterfaces) = 1 and ${eni}.NetworkInterfaceId = ${cfg}.workerEniId and ${eni}.OwnerId = ${cfg}.accountId and ${eni}.Attachment.InstanceId = ${cfg}.workerInstanceId and ${eni}.Attachment.DeviceIndex = 0 and ${owned(eni + ".TagSet")} and $count(${eni}.Groups) > 0 and $count(${eni}.Groups[$not($exists(GroupId)) or $not($contains(GroupId, /^sg-[a-f0-9]{8}([a-f0-9]{9})?$/))]) = 0`, "GroupAttached"),
    GroupAttached: check(`$count(${eni}.Groups[GroupId = ${group}]) > 0`, "RetainGroups", "StackDeleting"),
    RetainGroups: pass(merge(`"retainedGroups": [${eni}.Groups[GroupId != ${group}].GroupId]`), "HasRetainedGroups"),
    HasRetainedGroups: check("$count($states.input.retainedGroups) > 0", "AdmitDetachGateway"),
    StackDeleting: check(`${stored}.StackStatus = 'DELETE_IN_PROGRESS'`, "Pending", "AdmitDeleteStack"),
  };
  mutation(states, "DetachGateway", "ec2", "modifyNetworkInterfaceAttribute", { NetworkInterfaceId: expr(cfg + ".workerEniId"), Groups: expr("$states.input.retainedGroups") }, "StackDeleting");
  mutation(states, "DeleteStack", "cloudformation", "deleteStack", { StackName: expr(cfg + ".stackName") });
  return graph("ReadStack", states);
}

/** CloudFormation substitutions are operator parameters with constrained formats, never request input. */
export function demoCleanupWorkflow() {
  const regionAccount = "${AWS::Region}:${AWS::AccountId}", prefix = "sdp-${DemoId}";
  const runtimes = [["${PublishedBinding}", "${PublishedRuntimeV1}"], ["${PublishedBinding}", "${PublishedRuntimeV2}"], ["${PreviewBinding}", "${PreviewRuntime}"]];
  const config = { demoId: "${DemoId}", accountId: "${AWS::AccountId}", workerInstanceId: "${WorkerInstanceId}", workerEniId: "${WorkerEniId}", clusterName: "${ClusterName}",
    expiresAt: expr("$number('${ExpiresAt}')"), stackName: "sdp-demo-${DemoId}", stackPrefix: `arn:aws:cloudformation:${regionAccount}:stack/sdp-demo-\${DemoId}/`,
    albName: prefix + "-alb", albPrefix: `arn:aws:elasticloadbalancing:${regionAccount}:loadbalancer/app/${prefix}-alb/`,
    services: ["published-v1", "published-v2", "preview"].map(name => prefix + "-" + name), servicePrefix: `arn:aws:ecs:${regionAccount}:service/\${ClusterName}/`,
    parameters: runtimes.flatMap(([binding, runtime]) => [`/smartdeploy/pilot/gateways/${binding}/${runtime}`, `/smartdeploy/pilot/workloads/${binding}/${runtime}/tls-key`]) };
  const valid = "$type($states.input) = 'object' and $count($keys($states.input)) = 1 and $states.input.mode = 'cleanup' and $states.context.Execution.Name = '${DemoId}' and $states.context.StateMachine.Id = 'arn:aws:states:${AWS::Region}:${AWS::AccountId}:stateMachine:sdp-guard-${DemoId}' and $number('${ExpiresAt}') > " + now + " and $number('${ExpiresAt}') <= " + now + " + 7200000 and $toMillis('${CleanupStartUtc}') = $number('${ExpiresAt}') and $toMillis('${CleanupEndUtc}') = $number('${ExpiresAt}') + 1800000";
  return { Comment: "One create-only execution per fresh demo. No Lambda, provisioning or app-data deletion.", QueryLanguage: "JSONata", StartAt: "ValidateExecution", TimeoutSeconds: 9300,
    States: {
      ValidateExecution: check(valid, "Initialize", "InvalidExecution"),
      InvalidExecution: { Type: "Fail", Error: "InvalidCleanupExecution", Cause: "Exact fresh operator execution required." },
      Initialize: pass({ config, round: 0 }, "ExpiryTimer"),
      ExpiryTimer: { Type: "Wait", Timestamp: "${CleanupStartUtc}", Next: "CleanupWindow" },
      CleanupWindow: check(`${now} < ${cfg}.expiresAt + 1800000 and $states.input.round < 30`, "Cleanup", "CleanupIncomplete"),
      Cleanup: { Type: "Parallel", Branches: [worker(), services(), loadBalancer(), parameters(), stack()],
        Output: merge('"complete": $count($states.result[$ = true]) = 5, "round": $states.input.round + 1'), Next: "ObservedComplete" },
      ObservedComplete: check("$states.input.complete = true", "Complete", "RetryDelay"),
      RetryDelay: { Type: "Wait", Seconds: 60, Next: "CleanupWindow" },
      Complete: { Type: "Succeed", Output: { status: "complete" } },
      CleanupIncomplete: { Type: "Fail", Error: "CleanupIncomplete", Cause: "Cleanup window exhausted. Inspect actual owned AWS state." },
    } };
}
