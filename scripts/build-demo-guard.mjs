import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ref = name => ({ Ref: name });
const sub = value => ({ "Fn::Sub": value });
const attr = (name, field) => ({ "Fn::GetAtt": [name, field] });
const statement = (Action, Resource, Condition = undefined) => ({ Effect: "Allow", Action, Resource, ...(Condition ? { Condition } : {}) });
const ownerTags = [{ Key: "smartdeploy:demo-id", Value: ref("DemoId") }];
const uuid = description => ({ Type: "String", Description: description, AllowedPattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });

/** Render only; no AWS request, file parameter loading, provisioning or secret resolution. */
export async function buildDemoGuardTemplate() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = (await readFile(path.join(root, "src/lib/aws/demoCleanup.ts"), "utf8")).replaceAll("\r\n", "\n");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true, newLine: ts.NewLineKind.LineFeed }, reportDiagnostics: true });
  if (compiled.diagnostics?.some(row => row.category === ts.DiagnosticCategory.Error) || /require\(["']\./.test(compiled.outputText)) throw Error("Standalone cleanup compilation failed");
  const parameterArns = ["PublishedRuntimeV1", "PublishedRuntimeV2", "PreviewRuntime"].flatMap(runtime => {
    const binding = runtime === "PreviewRuntime" ? "PreviewBinding" : "PublishedBinding";
    return [sub(`arn:aws:ssm:\${AWS::Region}:\${AWS::AccountId}:parameter/smartdeploy/pilot/gateways/\${${binding}}/\${${runtime}}`),
      sub(`arn:aws:ssm:\${AWS::Region}:\${AWS::AccountId}:parameter/smartdeploy/pilot/workloads/\${${binding}}/\${${runtime}}/tls-key`)];
  });
  const config = '{"accountId":"${AWS::AccountId}","region":"${AWS::Region}","demoId":"${DemoId}","appId":"${AppId}","expiresAt":${ExpiresAt},"clusterName":"${ClusterName}","workerInstanceId":"${WorkerInstanceId}","workerEniId":"${WorkerEniId}","runtimes":[{"bindingId":"${PublishedBinding}","runtimeId":"${PublishedRuntimeV1}","environment":"published"},{"bindingId":"${PublishedBinding}","runtimeId":"${PublishedRuntimeV2}","environment":"published"},{"bindingId":"${PreviewBinding}","runtimeId":"${PreviewRuntime}","environment":"preview"}]}';
  const region = { StringEquals: { "aws:RequestedRegion": ref("AWS::Region") } };
  const lease = { StringEquals: { "ec2:ResourceTag/smartdeploy:demo-id": ref("DemoId") } };
  const prefix = "sdp-${DemoId}";
  const serviceArns = ["published-v1", "published-v2", "preview"].map(name => sub(`arn:aws:ecs:\${AWS::Region}:\${AWS::AccountId}:service/\${ClusterName}/${prefix}-${name}`));
  const template = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "Independent bounded SmartDeploy demo cleanup guard. Does not provision application runtimes.",
    Metadata: { CleanupSourceSha256: createHash("sha256").update(source).digest("hex"), BuildScript: "scripts/build-demo-guard.mjs" },
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
      CleanupGroup: { Type: "AWS::Scheduler::ScheduleGroup", Properties: { Tags: ownerTags } },
      CleanupDlq: { Type: "AWS::SQS::Queue", DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain", Properties: { SqsManagedSseEnabled: true, MessageRetentionPeriod: 604800, Tags: ownerTags } },
      CleanupLogs: { Type: "AWS::Logs::LogGroup", DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain", Properties: { LogGroupName: sub("/smartdeploy/demo-guard/${DemoId}"), RetentionInDays: 7, Tags: ownerTags } },
      CleanupRole: { Type: "AWS::IAM::Role", Properties: { Tags: ownerTags, AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }] }, Policies: [{ PolicyName: "OwnedDemoCleanup", PolicyDocument: { Version: "2012-10-17", Statement: [
        statement(["logs:CreateLogStream", "logs:PutLogEvents"], attr("CleanupLogs", "Arn")),
        statement(["ec2:DescribeInstances", "ec2:DescribeSecurityGroups", "ec2:DescribeNetworkInterfaces"], "*", region),
        statement("ec2:StopInstances", sub("arn:aws:ec2:${AWS::Region}:${AWS::AccountId}:instance/${WorkerInstanceId}"), lease),
        statement("ec2:ModifyNetworkInterfaceAttribute", sub("arn:aws:ec2:${AWS::Region}:${AWS::AccountId}:network-interface/${WorkerEniId}"), lease),
        statement(["ec2:DeleteSecurityGroup", "ec2:RevokeSecurityGroupIngress", "ec2:RevokeSecurityGroupEgress"], sub("arn:aws:ec2:${AWS::Region}:${AWS::AccountId}:security-group/*"), lease),
        statement(["ecs:DescribeServices", "ecs:UpdateService", "ecs:DeleteService"], serviceArns),
        statement(["ecs:DescribeTaskDefinition", "ecs:DeregisterTaskDefinition"], sub(`arn:aws:ecs:\${AWS::Region}:\${AWS::AccountId}:task-definition/${prefix}-*:*`)),
        statement(["elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeTags", "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeTargetGroups", "elasticloadbalancing:DescribeTargetHealth"], "*", region),
        statement("elasticloadbalancing:DeleteLoadBalancer", sub(`arn:aws:elasticloadbalancing:\${AWS::Region}:\${AWS::AccountId}:loadbalancer/app/${prefix}-alb/*`)),
        statement("elasticloadbalancing:DeleteListener", sub(`arn:aws:elasticloadbalancing:\${AWS::Region}:\${AWS::AccountId}:listener/app/${prefix}-alb/*/*`)),
        statement("elasticloadbalancing:DeleteTargetGroup", sub(`arn:aws:elasticloadbalancing:\${AWS::Region}:\${AWS::AccountId}:targetgroup/${prefix}-gateway/*`)),
        statement(["cloudformation:DescribeStacks", "cloudformation:ListStackResources", "cloudformation:DeleteStack"], sub("arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/sdp-demo-${DemoId}/*")),
        statement(["ssm:ListTagsForResource", "ssm:DeleteParameter"], parameterArns),
        statement(["iam:DeleteRole", "iam:DeleteRolePolicy", "iam:GetRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:DetachRolePolicy"], sub(`arn:aws:iam::\${AWS::AccountId}:role/${prefix}-*`)),
        statement(["ecr:DescribeRepositories", "ecr:DeleteRepository", "ecr:ListImages", "ecr:BatchDeleteImage"], sub(`arn:aws:ecr:\${AWS::Region}:\${AWS::AccountId}:repository/${prefix}*`)),
        statement(["route53:GetHostedZone", "route53:ListResourceRecordSets"], sub("arn:aws:route53:::hostedzone/${HostedZoneId}")),
        statement("route53:GetChange", "arn:aws:route53:::change/*"),
        statement("route53:ChangeResourceRecordSets", sub("arn:aws:route53:::hostedzone/${HostedZoneId}"), { "ForAllValues:StringEquals": {
          "route53:ChangeResourceRecordSetsNormalizedRecordNames": [sub("\\052.${AppDomain}")], "route53:ChangeResourceRecordSetsActions": ["DELETE"], "route53:ChangeResourceRecordSetsRecordTypes": ["A"],
        } }),
      ] } }] } },
      CleanupFunction: { Type: "AWS::Lambda::Function", Properties: { Runtime: "nodejs24.x", Handler: "index.handler", Role: attr("CleanupRole", "Arn"), MemorySize: 512, Timeout: 60,
        ReservedConcurrentExecutions: 1, Environment: { Variables: { DEMO_CONFIG: sub(config) } }, Code: { ZipFile: compiled.outputText },
        LoggingConfig: { LogGroup: ref("CleanupLogs"), LogFormat: "JSON" }, Tags: ownerTags,
        DeadLetterConfig: { TargetArn: attr("CleanupDlq", "Arn") },
      } },
      CleanupAsyncDelivery: { Type: "AWS::Lambda::EventInvokeConfig", Properties: { FunctionName: ref("CleanupFunction"), Qualifier: "$LATEST", MaximumEventAgeInSeconds: 300, MaximumRetryAttempts: 1 } },
      SchedulerRole: { Type: "AWS::IAM::Role", Properties: { Tags: ownerTags,
        AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "scheduler.amazonaws.com" }, Action: "sts:AssumeRole",
          Condition: { StringEquals: { "aws:SourceAccount": ref("AWS::AccountId"), "aws:SourceArn": attr("CleanupGroup", "Arn") } } }] },
        Policies: [{ PolicyName: "InvokeOnlyCleanup", PolicyDocument: { Version: "2012-10-17", Statement: [statement("lambda:InvokeFunction", attr("CleanupFunction", "Arn")), statement("sqs:SendMessage", attr("CleanupDlq", "Arn"))] } }],
      } },
      CleanupSchedule: { Type: "AWS::Scheduler::Schedule", Properties: { GroupName: ref("CleanupGroup"), State: "ENABLED", ScheduleExpression: "rate(1 minute)",
        StartDate: ref("CleanupStartUtc"), EndDate: ref("CleanupEndUtc"), ScheduleExpressionTimezone: "UTC", FlexibleTimeWindow: { Mode: "OFF" },
        Target: { Arn: attr("CleanupFunction", "Arn"), RoleArn: attr("SchedulerRole", "Arn"), Input: '{"mode":"cleanup"}',
          RetryPolicy: { MaximumEventAgeInSeconds: 300, MaximumRetryAttempts: 3 }, DeadLetterConfig: { Arn: attr("CleanupDlq", "Arn") } },
      } },
    },
    Outputs: { FunctionArn: { Description: "Cleanup function to verify before any runtime start.", Value: attr("CleanupFunction", "Arn") },
      ScheduleArn: { Description: "Independent recurring cleanup schedule.", Value: attr("CleanupSchedule", "Arn") },
      DeadLetterQueueUrl: { Description: "Inspect cleanup delivery failures; retained for seven days.", Value: ref("CleanupDlq") },
      SourceSha256: { Description: "Reviewed cleanup source hash.", Value: createHash("sha256").update(source).digest("hex") } },
  };
  // Async Lambda error delivery also needs its function role's permission.
  template.Resources.CleanupRole.Properties.Policies[0].PolicyDocument.Statement.push(statement("sqs:SendMessage", attr("CleanupDlq", "Arn")));
  const rendered = JSON.stringify(template, null, 2);
  if (Buffer.byteLength(rendered, "utf8") > 51200) throw Error("Cleanup template exceeds inline CloudFormation limit");
  return template;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error("Usage: node scripts/build-demo-guard.mjs OUTPUT_JSON");
  await writeFile(path.resolve(process.argv[2]), JSON.stringify(await buildDemoGuardTemplate(), null, 2) + "\n");
}
