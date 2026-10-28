import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { demoCleanupWorkflow } from "./demo-cleanup-workflow.mjs";

const ref = name => ({ Ref: name });
const sub = value => ({ "Fn::Sub": value });
const attr = (name, field) => ({ "Fn::GetAtt": [name, field] });
const statement = (Action, Resource, Condition = undefined) => ({ Effect: "Allow", Action, Resource, ...(Condition ? { Condition } : {}) });
const ownerTags = [{ Key: "smartdeploy:demo-id", Value: ref("DemoId") }];
const uuid = description => ({ Type: "String", Description: description, AllowedPattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });
function interpolate(value) {
  if (typeof value === "string") return value.includes("${") ? sub(value) : value;
  if (Array.isArray(value)) return value.map(interpolate);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, interpolate(entry)]));
  return value;
}

/** Render only; no AWS request, file parameter loading, provisioning or secret resolution. */
export async function buildDemoGuardTemplate() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = (await readFile(path.join(root, "scripts/demo-cleanup-workflow.mjs"), "utf8")).replaceAll("\r\n", "\n");
  const workflow = demoCleanupWorkflow();
  const parameterArns = ["PublishedRuntimeV1", "PublishedRuntimeV2", "PreviewRuntime"].flatMap(runtime => {
    const binding = runtime === "PreviewRuntime" ? "PreviewBinding" : "PublishedBinding";
    return [sub(`arn:aws:ssm:\${AWS::Region}:\${AWS::AccountId}:parameter/smartdeploy/pilot/gateways/\${${binding}}/\${${runtime}}`),
      sub(`arn:aws:ssm:\${AWS::Region}:\${AWS::AccountId}:parameter/smartdeploy/pilot/workloads/\${${binding}}/\${${runtime}}/tls-key`)];
  });
  const region = { StringEquals: { "aws:RequestedRegion": ref("AWS::Region") } };
  const lease = { StringEquals: { "ec2:ResourceTag/smartdeploy:demo-id": ref("DemoId") } };
  const prefix = "sdp-${DemoId}";
  const serviceArns = ["published-v1", "published-v2", "preview"].map(name => sub(`arn:aws:ecs:\${AWS::Region}:\${AWS::AccountId}:service/\${ClusterName}/${prefix}-${name}`));
  const template = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "Independent bounded SmartDeploy demo cleanup guard. Does not provision application runtimes.",
    Metadata: { CleanupSourceSha256: createHash("sha256").update(source).digest("hex"), BuildScript: "scripts/build-demo-guard.mjs", GuardKind: "STEP_FUNCTIONS_STANDARD", AppId: ref("AppId") },
    Parameters: {
      DemoId: { Type: "String", AllowedPattern: "^[a-f0-9]{20}$", Description: "Fresh 80-bit demo namespace; never reuse an earlier lease." },
      AppId: uuid("The one pilot app UUID."), PublishedBinding: uuid("Published binding UUID."), PreviewBinding: uuid("Separate preview binding UUID."),
      PublishedRuntimeV1: uuid("First published runtime UUID."), PublishedRuntimeV2: uuid("Update runtime UUID."), PreviewRuntime: uuid("Preview runtime UUID."),
      WorkerInstanceId: { Type: "AWS::EC2::Instance::Id", Description: "Existing stopped worker; caller must hold its explicit demo lease." },
      WorkerEniId: { Type: "String", AllowedPattern: "^eni-[a-f0-9]{8}([a-f0-9]{9})?$", Description: "That worker's primary ENI." },
      ClusterName: { Type: "String", AllowedPattern: "^[A-Za-z0-9_-]{1,255}$", Description: "Existing ECS cluster." },
      HostedZoneId: { Type: "AWS::Route53::HostedZone::Id", Description: "Existing smart-deploy.xyz public hosted zone." },
      AppDomain: { Type: "String", AllowedValues: ["apps.smart-deploy.xyz"], Description: "Reserved private-app namespace under the existing domain." },
      ExpiresAt: { Type: "Number", MinValue: 1, MaxValue: 9007199254740991, Description: "Shared absolute demo expiry in epoch milliseconds, within two hours before arming." },
      CleanupStartUtc: { Type: "String", AllowedPattern: "^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$", Description: "ISO UTC equivalent of ExpiresAt." },
      CleanupEndUtc: { Type: "String", AllowedPattern: "^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$", Description: "Thirty minutes after cleanup start; delivery retries remain bounded." },
    },
    Rules: { SeparateDataEnvironments: { Assertions: [{ Assert: { "Fn::Not": [{ "Fn::Equals": [ref("PublishedBinding"), ref("PreviewBinding")] }] }, AssertDescription: "Preview and published bindings must differ." }] } },
    Resources: {
      CleanupDlq: { Type: "AWS::SQS::Queue", DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain", Properties: { SqsManagedSseEnabled: true, MessageRetentionPeriod: 604800, Tags: ownerTags } },
      CleanupLogs: { Type: "AWS::Logs::LogGroup", DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain", Properties: { LogGroupName: sub("/smartdeploy/demo-guard/${DemoId}"), RetentionInDays: 7, Tags: ownerTags } },
      CleanupRole: { Type: "AWS::IAM::Role", Properties: { Tags: ownerTags, AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "states.amazonaws.com" }, Action: "sts:AssumeRole", Condition: { StringEquals: { "aws:SourceAccount": ref("AWS::AccountId"), "aws:SourceArn": sub("arn:aws:states:${AWS::Region}:${AWS::AccountId}:stateMachine:sdp-guard-${DemoId}") } } }] }, Policies: [{ PolicyName: "OwnedDemoCleanup", PolicyDocument: { Version: "2012-10-17", Statement: [
        statement(["logs:CreateLogDelivery", "logs:GetLogDelivery", "logs:UpdateLogDelivery", "logs:DeleteLogDelivery", "logs:ListLogDeliveries", "logs:PutResourcePolicy", "logs:DescribeResourcePolicies", "logs:DescribeLogGroups"], "*", region),
        statement(["ec2:DescribeInstances", "ec2:DescribeSecurityGroups", "ec2:DescribeSecurityGroupRules", "ec2:DescribeNetworkInterfaces"], "*", region),
        statement("ec2:StopInstances", sub("arn:aws:ec2:${AWS::Region}:${AWS::AccountId}:instance/${WorkerInstanceId}"), lease),
        statement("ec2:ModifyNetworkInterfaceAttribute", sub("arn:aws:ec2:${AWS::Region}:${AWS::AccountId}:network-interface/${WorkerEniId}"), lease),
        statement(["ec2:DeleteSecurityGroup", "ec2:RevokeSecurityGroupIngress", "ec2:RevokeSecurityGroupEgress"], sub("arn:aws:ec2:${AWS::Region}:${AWS::AccountId}:security-group/*"), lease),
        statement(["ecs:DescribeServices", "ecs:ListTagsForResource", "ecs:UpdateService", "ecs:DeleteService"], serviceArns),
        statement(["ecs:DescribeTaskDefinition", "ecs:DeregisterTaskDefinition"], sub(`arn:aws:ecs:\${AWS::Region}:\${AWS::AccountId}:task-definition/${prefix}-*:*`)),
        statement(["elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeTags", "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeRules", "elasticloadbalancing:DescribeTargetGroups", "elasticloadbalancing:DescribeTargetHealth"], "*", region),
        statement("elasticloadbalancing:DeleteLoadBalancer", sub(`arn:aws:elasticloadbalancing:\${AWS::Region}:\${AWS::AccountId}:loadbalancer/app/${prefix}-alb/*`)),
        statement("elasticloadbalancing:DeleteListener", sub(`arn:aws:elasticloadbalancing:\${AWS::Region}:\${AWS::AccountId}:listener/app/${prefix}-alb/*/*`)),
        statement("elasticloadbalancing:DeleteTargetGroup", ["pub", "prev"].map(environment => sub(`arn:aws:elasticloadbalancing:\${AWS::Region}:\${AWS::AccountId}:targetgroup/${prefix}-${environment}/*`))),
        statement("elasticloadbalancing:DeleteRule", sub(`arn:aws:elasticloadbalancing:\${AWS::Region}:\${AWS::AccountId}:listener-rule/app/${prefix}-alb/*/*/*`)),
        statement(["cloudformation:DescribeStacks", "cloudformation:ListStackResources", "cloudformation:DeleteStack"], sub("arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/sdp-demo-${DemoId}/*")),
        statement(["ssm:ListTagsForResource", "ssm:DeleteParameter"], parameterArns),
        statement(["iam:DeleteRole", "iam:DeleteRolePolicy", "iam:GetRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:DetachRolePolicy", "iam:TagRole", "iam:UntagRole"], sub(`arn:aws:iam::\${AWS::AccountId}:role/${prefix}-*`)),
        statement("iam:PassRole", sub(`arn:aws:iam::\${AWS::AccountId}:role/${prefix}-execution`), { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } }),
        statement(["ecr:DescribeRepositories", "ecr:DeleteRepository", "ecr:ListImages", "ecr:BatchDeleteImage"], sub(`arn:aws:ecr:\${AWS::Region}:\${AWS::AccountId}:repository/${prefix}*`)),
        statement(["route53:GetHostedZone", "route53:ListResourceRecordSets"], sub("arn:aws:route53:::hostedzone/${HostedZoneId}")),
        statement("route53:ListHostedZones", "*"),
        statement("route53:GetChange", "arn:aws:route53:::change/*"),
        statement("route53:ChangeResourceRecordSets", sub("arn:aws:route53:::hostedzone/${HostedZoneId}"), { "ForAllValues:StringEquals": {
          "route53:ChangeResourceRecordSetsNormalizedRecordNames": [sub("\\052.${AppDomain}")], "route53:ChangeResourceRecordSetsActions": ["DELETE"], "route53:ChangeResourceRecordSetsRecordTypes": ["A"],
        } }),
      ] } }] } },
      CleanupWorkflow: { Type: "AWS::StepFunctions::StateMachine", Properties: { StateMachineName: sub("sdp-guard-${DemoId}"), StateMachineType: "STANDARD", RoleArn: attr("CleanupRole", "Arn"),
        Definition: interpolate(workflow), EncryptionConfiguration: { Type: "AWS_OWNED_KEY" }, Tags: ownerTags,
        LoggingConfiguration: { Level: "ERROR", IncludeExecutionData: false, Destinations: [{ CloudWatchLogsLogGroup: { LogGroupArn: attr("CleanupLogs", "Arn") } }] } } },
      CleanupFailureRule: { Type: "AWS::Events::Rule", Properties: { State: "ENABLED", EventPattern: { source: ["aws.states"], "detail-type": ["Step Functions Execution Status Change"], detail: { stateMachineArn: [attr("CleanupWorkflow", "Arn")], status: ["FAILED", "TIMED_OUT", "ABORTED"] } },
        Targets: [{ Id: "OwnedCleanupFailure", Arn: attr("CleanupDlq", "Arn"), InputTransformer: { InputPathsMap: { execution: "$.detail.executionArn", status: "$.detail.status" }, InputTemplate: '{"execution":<execution>,"status":<status>}' }, RetryPolicy: { MaximumEventAgeInSeconds: 300, MaximumRetryAttempts: 3 } }], Tags: ownerTags } },
      CleanupFailureDelivery: { Type: "AWS::SQS::QueuePolicy", Properties: { Queues: [ref("CleanupDlq")], PolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "events.amazonaws.com" }, Action: "sqs:SendMessage", Resource: attr("CleanupDlq", "Arn"), Condition: { ArnEquals: { "aws:SourceArn": attr("CleanupFailureRule", "Arn") }, StringEquals: { "aws:SourceAccount": ref("AWS::AccountId") } } }] } } },
    },
    Outputs: { StateMachineArn: { Description: "Verify definition/role, then start exactly one named Standard execution and observe its expiry timer before workloads.", Value: ref("CleanupWorkflow") },
      ExecutionName: { Description: "Create-only execution name; input must be exactly mode cleanup.", Value: ref("DemoId") },
      DeadLetterQueueUrl: { Description: "Inspect cleanup delivery failures; retained for seven days.", Value: ref("CleanupDlq") },
      SourceSha256: { Description: "Reviewed cleanup source hash.", Value: createHash("sha256").update(source).digest("hex") } },
  };
  const rendered = JSON.stringify(template);
  if (Buffer.byteLength(rendered, "utf8") > 51200) throw Error("Cleanup template exceeds inline CloudFormation limit");
  return template;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error("Usage: node scripts/build-demo-guard.mjs OUTPUT_JSON");
  await writeFile(path.resolve(process.argv[2]), JSON.stringify(await buildDemoGuardTemplate()) + "\n");
}
