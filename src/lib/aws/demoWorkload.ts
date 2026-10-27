import { z } from "zod";
import { parseDemoCleanupConfig } from "./demoCleanup";
import { documentRolePolicy } from "./documentRole";
import { GatewayUpstreamTls } from "../gateway/upstreamTls";

const Release = z.strictObject({ runtimeId: z.uuid(), bindingId: z.uuid(), releaseId: z.uuid(), environment: z.enum(["published", "preview"]), certificatePem: z.string().min(1).max(8192) });
const Images = z.strictObject({ worker: z.string(), tls: z.string(), publishedV1: z.string(), publishedV2: z.string(), preview: z.string() });
export const DemoWorkloadPlan = z.strictObject({
  cleanup: z.unknown().transform(value => parseDemoCleanupConfig(JSON.stringify(value))),
  phase: z.enum(["build", "runtime"]), vpcId: z.string().regex(/^vpc-[a-f0-9]{17}$/),
  subnetIds: z.tuple([z.string().regex(/^subnet-[a-f0-9]{17}$/), z.string().regex(/^subnet-[a-f0-9]{17}$/)]),
  hostedZoneId: z.string().regex(/^Z[A-Z0-9]{6,32}$/), certificateArn: z.string(),
  documentPrincipalArn: z.string(), releases: z.array(Release).length(3), images: Images,
}).superRefine((plan, context) => {
  const fail = () => context.addIssue({ code: "custom", message: "Exact isolated demo workload inputs required." });
  const { cleanup } = plan; const prefix = "sdp-" + cleanup.demoId;
  if (plan.subnetIds[0] === plan.subnetIds[1] || cleanup.expiresAt % 1000 !== 0
    || !new RegExp(`^arn:aws:iam::${cleanup.accountId}:(?:user|role)/[A-Za-z0-9_+=,.@/-]{1,128}$`).test(plan.documentPrincipalArn)
    || new Set(plan.releases.map(row => row.releaseId)).size !== 3 || new Set(plan.releases.map(row => row.runtimeId)).size !== 3) fail();
  for (const row of plan.releases) {
    if (!cleanup.runtimes.some(owned => owned.runtimeId === row.runtimeId && owned.bindingId === row.bindingId && owned.environment === row.environment)) fail();
    try { new GatewayUpstreamTls({ bindingId: row.bindingId, environment: row.environment, releaseId: row.releaseId, certificatePem: row.certificatePem, privateIp: "10.0.0.1", port: 8443, timeoutMs: 1000, maxConnections: 1 }); } catch { fail(); }
  }
  if (plan.phase === "runtime") {
    if (!new RegExp(`^arn:aws:acm:${cleanup.region}:${cleanup.accountId}:certificate/[a-f0-9-]{36}$`).test(plan.certificateArn)) fail();
    for (const [key, image] of Object.entries(plan.images)) {
      const repository = key === "worker" ? "worker" : key === "tls" ? "tls" : "notes";
      if (!new RegExp(`^${cleanup.accountId}\\.dkr\\.ecr\\.${cleanup.region}\\.amazonaws\\.com/${prefix}-${repository}@sha256:[a-f0-9]{64}$`).test(image)) fail();
    }
  } else if (plan.certificateArn !== "" || Object.values(plan.images).some(value => value !== "")) fail();
});
export type DemoWorkloadPlan = z.infer<typeof DemoWorkloadPlan>;
interface CfnResource extends Record<string, unknown> { Type: string; Properties: Record<string, unknown> }
export interface DemoWorkloadTemplate {
  AWSTemplateFormatVersion: string; Description: string; Metadata: Record<string, unknown>;
  Resources: Record<string, CfnResource>; Outputs: Record<string, { Description: string; Value: unknown }>;
}
const ref = (name: string) => ({ Ref: name });
const attr = (name: string, field: string) => ({ "Fn::GetAtt": [name, field] });
const resource = (Type: string, Properties: Record<string, unknown>, retain = false): CfnResource => ({ Type, Properties, ...(retain ? { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" } : {}) });
const permission = (Action: string[], Resource: string[]) => ({ Effect: "Allow", Action, Resource });

function foundation(plan: DemoWorkloadPlan): Record<string, CfnResource> {
  const config = plan.cleanup; const prefix = "sdp-" + config.demoId; const aws = `arn:aws:`; const regionAccount = `${config.region}:${config.accountId}`;
  const tags = [{ Key: "smartdeploy:demo-id", Value: config.demoId }];
  const repositories = ["worker", "tls", "notes"].map(name => `${aws}ecr:${regionAccount}:repository/${prefix}-${name}`);
  const logArn = `${aws}logs:${regionAccount}:log-group:/smartdeploy/demo/${config.demoId}:*`;
  const tableArn = `${aws}dynamodb:${regionAccount}:table/${prefix}-documents`; const roleArn = `${aws}iam::${config.accountId}:role/${prefix}-documents`;
  const trust = (service: string, condition: Record<string, unknown>) => ({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: service }, Action: "sts:AssumeRole", Condition: condition }] });
  const role = (name: string, principal: unknown, statements: unknown[], retain = false) => resource("AWS::IAM::Role", { RoleName: `${prefix}-${name}`, Tags: tags, AssumeRolePolicyDocument: principal,
    Policies: [{ PolicyName: "DemoOnly", PolicyDocument: { Version: "2012-10-17", Statement: statements } }] }, retain);
  const ecrToken = permission(["ecr:GetAuthorizationToken"], ["*"]);
  const logs = permission(["logs:CreateLogStream", "logs:PutLogEvents"], [logArn]);
  const resources: Record<string, CfnResource> = {
    DemoLogs: resource("AWS::Logs::LogGroup", { LogGroupName: `/smartdeploy/demo/${config.demoId}`, RetentionInDays: 7, Tags: tags }, true),
    Documents: resource("AWS::DynamoDB::Table", { TableName: `${prefix}-documents`, BillingMode: "PAY_PER_REQUEST", AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }, { AttributeName: "sk", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }], SSESpecification: { SSEEnabled: true }, DeletionProtectionEnabled: true,
      OnDemandThroughput: { MaxReadRequestUnits: 25, MaxWriteRequestUnits: 25 }, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false }, Tags: tags }, true),
    DocumentRole: resource("AWS::IAM::Role", { RoleName: `${prefix}-documents`, Tags: tags, MaxSessionDuration: 3600,
      AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { AWS: plan.documentPrincipalArn }, Action: "sts:AssumeRole" }] },
      Policies: [{ PolicyName: "OneAppTransactions", PolicyDocument: documentRolePolicy({ appId: config.appId, tableArn, roleArn, region: config.region }) }] }, true),
    BuildRole: role("build", trust("codebuild.amazonaws.com", { StringEquals: { "aws:SourceAccount": config.accountId, "aws:SourceArn": `${aws}codebuild:${regionAccount}:project/smartdeploy-builder` } }),
      [ecrToken, logs, permission(["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:DescribeImages"], repositories)]),
    ExecutionRole: role("execution", trust("ecs-tasks.amazonaws.com", { StringEquals: { "aws:SourceAccount": config.accountId }, ArnLike: { "aws:SourceArn": `${aws}ecs:${regionAccount}:*` } }),
      [ecrToken, logs, permission(["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], repositories),
        permission(["ssm:GetParameters"], config.runtimes.map(row => `${aws}ssm:${regionAccount}:parameter/smartdeploy/pilot/workloads/${row.bindingId}/${row.runtimeId}/tls-key`))]),
  };
  for (const name of ["worker", "tls", "notes"]) resources[name[0].toUpperCase() + name.slice(1) + "Repository"] = resource("AWS::ECR::Repository", { RepositoryName: `${prefix}-${name}`, ImageTagMutability: "IMMUTABLE", EmptyOnDelete: true, EncryptionConfiguration: { EncryptionType: "AES256" }, Tags: tags,
    LifecyclePolicy: { LifecyclePolicyText: JSON.stringify({ rules: [{ rulePriority: 1, description: "Only five curated build images retained", selection: { tagStatus: "any", countType: "imageCountMoreThan", countNumber: 5 }, action: { type: "expire" } }] }) } });
  return resources;
}

function network(plan: DemoWorkloadPlan): Record<string, CfnResource> {
  const c = plan.cleanup; const tags = [{ Key: "smartdeploy:demo-id", Value: c.demoId }];
  const group = (description: string, ingress: unknown[], egress: unknown[], extra: unknown[] = []) => resource("AWS::EC2::SecurityGroup", { VpcId: plan.vpcId, GroupDescription: description, SecurityGroupIngress: ingress, SecurityGroupEgress: egress, Tags: [...tags, ...extra] });
  const tcp = (port: number, destination: Record<string, unknown>) => ({ IpProtocol: "tcp", FromPort: port, ToPort: port, ...destination });
  const published = c.runtimes.find(row => row.environment === "published")!; const preview = c.runtimes.find(row => row.environment === "preview")!;
  const appTags = (bindingId: string, environment: string) => [{ Key: "smartdeploy:app-id", Value: c.appId }, { Key: "smartdeploy:binding-id", Value: bindingId }, { Key: "smartdeploy:environment", Value: environment }];
  return {
    WorkerQuarantineGroup: { ...group("Temporary worker boot quarantine: outbound HTTPS for SSM, no public ingress", [], [tcp(443, { CidrIp: "0.0.0.0/0" })]), DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" },
    LoadBalancerGroup: group("Public HTTPS only; two fixed worker target ports", [tcp(443, { CidrIp: "0.0.0.0/0" })], [tcp(8444, { CidrIp: "0.0.0.0/0" }), tcp(8445, { CidrIp: "0.0.0.0/0" })]),
    GatewayGroup: group("Existing worker private gateway ports from this ALB only", [tcp(8444, { SourceSecurityGroupId: ref("LoadBalancerGroup") }), tcp(8445, { SourceSecurityGroupId: ref("LoadBalancerGroup") })], [tcp(443, { CidrIp: "0.0.0.0/0" })]),
    PublishedGroup: group("Published workload TLS from exclusively leased gateway ENI", [tcp(8443, { SourceSecurityGroupId: ref("GatewayGroup") })], [tcp(443, { CidrIp: "0.0.0.0/0" })], appTags(published.bindingId, "published")),
    PreviewGroup: group("Separate preview workload TLS from exclusively leased gateway ENI", [tcp(8443, { SourceSecurityGroupId: ref("GatewayGroup") })], [tcp(443, { CidrIp: "0.0.0.0/0" })], appTags(preview.bindingId, "preview")),
    PublishedOriginEgress: resource("AWS::EC2::SecurityGroupEgress", { GroupId: ref("GatewayGroup"), IpProtocol: "tcp", FromPort: 8443, ToPort: 8443, DestinationSecurityGroupId: ref("PublishedGroup") }),
    PreviewOriginEgress: resource("AWS::EC2::SecurityGroupEgress", { GroupId: ref("GatewayGroup"), IpProtocol: "tcp", FromPort: 8443, ToPort: 8443, DestinationSecurityGroupId: ref("PreviewGroup") }),
  };
}

function tasks(plan: DemoWorkloadPlan): Record<string, CfnResource> {
  const c = plan.cleanup; const prefix = "sdp-" + c.demoId; const resources: Record<string, CfnResource> = {};
  const releases = new Map(plan.releases.map(row => [row.runtimeId, row]));
  const published = c.runtimes.filter(row => row.environment === "published"); const preview = c.runtimes.find(row => row.environment === "preview")!;
  for (const [logical, name, runtimeId, image] of [["PublishedV1", "published-v1", published[0].runtimeId, plan.images.publishedV1], ["PublishedV2", "published-v2", published[1].runtimeId, plan.images.publishedV2], ["Preview", "preview", preview.runtimeId, plan.images.preview]]) {
    const release = releases.get(runtimeId)!;
    const tags = Object.entries({ "smartdeploy:demo-id": c.demoId, "smartdeploy:app-id": c.appId, "smartdeploy:binding-id": release.bindingId, "smartdeploy:environment": release.environment, "smartdeploy:release-id": release.releaseId, "smartdeploy:runtime-id": runtimeId }).map(([Key, Value]) => ({ Key, Value }));
    const logging = { LogDriver: "awslogs", Options: { "awslogs-group": ref("DemoLogs"), "awslogs-region": c.region, "awslogs-stream-prefix": name } };
    const environment = Object.entries({ SMARTDEPLOY_BINDING_ID: release.bindingId, SMARTDEPLOY_APP_ENVIRONMENT: release.environment, SMARTDEPLOY_RELEASE_ID: release.releaseId, SMARTDEPLOY_TLS_CERTIFICATE: release.certificatePem, SMARTDEPLOY_APP_PORT: "3000", SMARTDEPLOY_TLS_PORT: "8443", SMARTDEPLOY_MAX_CONNECTIONS: "8", SMARTDEPLOY_TIMEOUT_MS: "10000", SMARTDEPLOY_IDLE_MS: "3000", SMARTDEPLOY_HANDSHAKE_MS: "1000", SMARTDEPLOY_SHUTDOWN_MS: "1000", SMARTDEPLOY_MAX_INBOUND_BYTES: "65536", SMARTDEPLOY_MAX_OUTBOUND_BYTES: "65536" }).map(([Name, Value]) => ({ Name, Value }));
    const container = (Name: string, Image: string, port: number) => ({ Name, Image, Essential: true, User: "10001:10001", ReadonlyRootFilesystem: true, Privileged: false, LinuxParameters: { Capabilities: { Drop: ["ALL"] } }, PortMappings: [{ ContainerPort: port, HostPort: port, Protocol: "tcp" }], LogConfiguration: logging });
    resources[logical + "Task"] = resource("AWS::ECS::TaskDefinition", { Family: `${prefix}-${name}`, Cpu: "256", Memory: "512", NetworkMode: "awsvpc", RequiresCompatibilities: ["FARGATE"], RuntimePlatform: { CpuArchitecture: "X86_64", OperatingSystemFamily: "LINUX" }, ExecutionRoleArn: attr("ExecutionRole", "Arn"), Tags: tags,
      ContainerDefinitions: [container("app", image, 3000), { ...container("tls", plan.images.tls, 8443), DependsOn: [{ ContainerName: "app", Condition: "START" }], Environment: environment,
        Secrets: [{ Name: "SMARTDEPLOY_TLS_KEY", ValueFrom: `arn:aws:ssm:${c.region}:${c.accountId}:parameter/smartdeploy/pilot/workloads/${release.bindingId}/${runtimeId}/tls-key` }] }] });
    resources[logical + "Service"] = resource("AWS::ECS::Service", { ServiceName: `${prefix}-${name}`, Cluster: c.clusterName, TaskDefinition: ref(logical + "Task"), LaunchType: "FARGATE", PlatformVersion: "1.4.0", DesiredCount: 1, EnableExecuteCommand: false, EnableECSManagedTags: true, PropagateTags: "TASK_DEFINITION", Tags: tags,
      DeploymentConfiguration: { MaximumPercent: 100, MinimumHealthyPercent: 0, DeploymentCircuitBreaker: { Enable: true, Rollback: true } }, NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: "ENABLED", Subnets: plan.subnetIds, SecurityGroups: [ref(release.environment === "preview" ? "PreviewGroup" : "PublishedGroup")] } } });
  }
  return resources;
}

function ingress(plan: DemoWorkloadPlan): Record<string, CfnResource> {
  const c = plan.cleanup; const prefix = "sdp-" + c.demoId; const tags = [{ Key: "smartdeploy:demo-id", Value: c.demoId }];
  const bindings = new Map(c.runtimes.map(row => [row.environment, row.bindingId]));
  const resources: Record<string, CfnResource> = {
    LoadBalancer: resource("AWS::ElasticLoadBalancingV2::LoadBalancer", { Name: prefix + "-alb", Type: "application", Scheme: "internet-facing", IpAddressType: "ipv4", Subnets: plan.subnetIds, SecurityGroups: [ref("LoadBalancerGroup")], Tags: tags, LoadBalancerAttributes: [{ Key: "routing.http.drop_invalid_header_fields.enabled", Value: "true" }, { Key: "idle_timeout.timeout_seconds", Value: "30" }] }),
    Listener: resource("AWS::ElasticLoadBalancingV2::Listener", { LoadBalancerArn: ref("LoadBalancer"), Port: 443, Protocol: "HTTPS", SslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06", Certificates: [{ CertificateArn: plan.certificateArn }], DefaultActions: [{ Type: "fixed-response", FixedResponseConfig: { StatusCode: "404", ContentType: "text/plain", MessageBody: "Not found." } }] }),
    AppDns: resource("AWS::Route53::RecordSet", { HostedZoneId: plan.hostedZoneId, Name: "*.apps.smart-deploy.xyz", Type: "A", AliasTarget: { DNSName: attr("LoadBalancer", "DNSName"), HostedZoneId: attr("LoadBalancer", "CanonicalHostedZoneID"), EvaluateTargetHealth: false } }),
  };
  for (const [name, environment, port, priority] of [["Published", "published", 8444, 10], ["Preview", "preview", 8445, 20]] as const) {
    const bindingId = bindings.get(environment)!;
    resources[name + "Target"] = resource("AWS::ElasticLoadBalancingV2::TargetGroup", { Name: `${prefix}-${environment === "published" ? "pub" : "prev"}`, TargetType: "instance", VpcId: plan.vpcId, Protocol: "HTTPS", Port: port, Targets: [{ Id: c.workerInstanceId, Port: port }], HealthCheckProtocol: "HTTPS", HealthCheckPath: "/", HealthCheckIntervalSeconds: 15, Matcher: { HttpCode: "403" }, Tags: tags });
    resources[name + "Rule"] = resource("AWS::ElasticLoadBalancingV2::ListenerRule", { ListenerArn: ref("Listener"), Priority: priority, Conditions: [{ Field: "host-header", HostHeaderConfig: { Values: [`${bindingId}.apps.smart-deploy.xyz`] } }], Actions: [{ Type: "forward", TargetGroupArn: ref(name + "Target") }] });
  }
  return resources;
}

/** Pure rendering only. Guard/lease/cost/certificate/subnet evidence must be verified before AWS execution. */
export function demoWorkloadTemplate(input: DemoWorkloadPlan): DemoWorkloadTemplate {
  const plan = DemoWorkloadPlan.parse(input); const c = plan.cleanup;
  const resources = { ...foundation(plan), ...(plan.phase === "runtime" ? { ...network(plan), ...tasks(plan), ...ingress(plan) } : {}) };
  const template: DemoWorkloadTemplate = { AWSTemplateFormatVersion: "2010-09-09", Description: "Single curated SmartDeploy demo. Independent cleanup guard required before any build/runtime start.",
    Metadata: { DemoId: c.demoId, AppId: c.appId, ExpiresAt: c.expiresAt, Phase: plan.phase, TargetHealthIsTransportOnly: true, RetainedDataIsNotAppDeletion: true }, Resources: resources,
    Outputs: { BuildRoleArn: { Description: "Exact serviceRoleOverride for the existing NO_SOURCE project", Value: attr("BuildRole", "Arn") }, DocumentRoleArn: { Description: "Retained one-app document transaction role", Value: attr("DocumentRole", "Arn") }, DocumentTableArn: { Description: "Retained app/environment document data", Value: attr("Documents", "Arn") }, LogGroup: { Description: "Seven-day retained demo build/runtime logs", Value: ref("DemoLogs") } } };
  if (plan.phase === "runtime") {
    template.Outputs.GatewayGroupId = { Description: "Attach only to the explicitly leased existing worker primary ENI", Value: ref("GatewayGroup") };
    template.Outputs.WorkerQuarantineGroupId = { Description: "Keep public worker ingress closed during boot; retain if bootstrap fails", Value: ref("WorkerQuarantineGroup") };
  }
  if (Object.keys(resources).length > 50 || Buffer.byteLength(JSON.stringify(template, null, 2)) > 51200) throw Error("Demo workload template exceeds reviewed bounds.");
  return template;
}
