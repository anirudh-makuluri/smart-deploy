import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DemoWorkloadPlan, demoWorkloadTemplate } from "@/lib/aws/demoWorkload";
import { demoWorkloadFixture } from "../../helpers/demoWorkloadPlan";
import { buildDemoGuardTemplate } from "../../../scripts/build-demo-guard.mjs";
let fixture: Awaited<ReturnType<typeof demoWorkloadFixture>>;
beforeAll(async () => { fixture = await demoWorkloadFixture(); }); afterAll(async () => { await fixture?.dispose(); });
const plan = () => structuredClone(fixture.plan);
function buildPlan() { return { ...plan(), phase: "build" as const, certificateArn: "", images: { worker: "", tls: "", publishedV1: "", publishedV2: "", preview: "" } }; }
describe("bounded curated AWS workload rendering", () => {
  it("renders a build foundation without starting any service, load balancer or instance", () => {
    const template = demoWorkloadTemplate(buildPlan()); const types = Object.values(template.Resources).map(row => row.Type);
    expect(types).toHaveLength(8); expect(types).not.toContain("AWS::ECS::Service"); expect(types).not.toContain("AWS::ElasticLoadBalancingV2::LoadBalancer"); expect(types).not.toContain("AWS::EC2::Instance");
    expect(Object.keys(template.Resources).filter(key => key.endsWith("Repository"))).toHaveLength(3);
  });
  it("keeps retained data/roles and immutable repositories identical when moving to runtime phase", () => {
    const before = demoWorkloadTemplate(buildPlan()); const after = demoWorkloadTemplate(plan());
    for (const key of Object.keys(before.Resources)) expect(after.Resources[key]).toEqual(before.Resources[key]);
    expect(after.Resources.Documents).toMatchObject({ DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain", Properties: { BillingMode: "PAY_PER_REQUEST", DeletionProtectionEnabled: true, OnDemandThroughput: { MaxReadRequestUnits: 25, MaxWriteRequestUnits: 25 }, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false } } });
    expect(after.Resources.DocumentRole.DeletionPolicy).toBe("Retain"); expect(after.Resources.DemoLogs.DeletionPolicy).toBe("Retain");
  });
  it("fits the guard's resource/inline bounds and adds only three fixed quarter-vCPU services", () => {
    const template = demoWorkloadTemplate(plan()); expect(Object.keys(template.Resources).length).toBeLessThanOrEqual(50); expect(Buffer.byteLength(JSON.stringify(template, null, 2))).toBeLessThanOrEqual(51200);
    const services = Object.values(template.Resources).filter(row => row.Type === "AWS::ECS::Service"); expect(services).toHaveLength(3);
    for (const row of services) expect(row.Properties).toMatchObject({ DesiredCount: 1, LaunchType: "FARGATE", PlatformVersion: "1.4.0", EnableExecuteCommand: false, DeploymentConfiguration: { MaximumPercent: 100, MinimumHealthyPercent: 0 } });
    for (const row of Object.values(template.Resources).filter(row => row.Type === "AWS::ECS::TaskDefinition")) {
      expect(row.Properties).toMatchObject({ Cpu: "256", Memory: "512", NetworkMode: "awsvpc" }); expect(row.Properties).not.toHaveProperty("TaskRoleArn"); expect(row.Properties).not.toHaveProperty("Volumes");
      const containers = row.Properties.ContainerDefinitions as Record<string, unknown>[]; expect(containers).toHaveLength(2); expect(containers[0]).not.toHaveProperty("Secrets");
      for (const container of containers) expect(container).toMatchObject({ User: "10001:10001", ReadonlyRootFilesystem: true, Privileged: false, LinuxParameters: { Capabilities: { Drop: ["ALL"] } } });
      expect(containers[1].Secrets).toEqual([{ Name: "SMARTDEPLOY_TLS_KEY", ValueFrom: expect.stringMatching(/^arn:aws:ssm:us-west-2:123456789012:parameter\/smartdeploy\/pilot\/workloads\/[a-f0-9-]+\/[a-f0-9-]+\/tls-key$/) }]);
    }
  });
  it("isolates preview and published task groups behind only the leased gateway group", () => {
    const resources = demoWorkloadTemplate(plan()).Resources;
    for (const group of [resources.PublishedGroup, resources.PreviewGroup]) expect(group.Properties.SecurityGroupIngress).toEqual([{ IpProtocol: "tcp", FromPort: 8443, ToPort: 8443, SourceSecurityGroupId: { Ref: "GatewayGroup" } }]);
    expect(resources.PublishedV1Service.Properties.NetworkConfiguration).toEqual(resources.PublishedV2Service.Properties.NetworkConfiguration);
    expect(resources.PreviewService.Properties.NetworkConfiguration).not.toEqual(resources.PublishedV1Service.Properties.NetworkConfiguration);
    expect(resources.GatewayGroup.Properties.SecurityGroupIngress).toEqual([8444, 8445].map(port => ({ IpProtocol: "tcp", FromPort: port, ToPort: port, SourceSecurityGroupId: { Ref: "LoadBalancerGroup" } })));
    expect(resources.PublishedOriginEgress.Properties.DestinationSecurityGroupId).toEqual({ Ref: "PublishedGroup" }); expect(resources.PreviewOriginEgress.Properties.DestinationSecurityGroupId).toEqual({ Ref: "PreviewGroup" });
  });
  it("supplies a retained no-ingress worker boot quarantine without modifying existing groups", () => {
    const template = demoWorkloadTemplate(plan());
    expect(template.Resources.WorkerQuarantineGroup).toMatchObject({ DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain", Properties: { SecurityGroupIngress: [], SecurityGroupEgress: [{ IpProtocol: "tcp", FromPort: 443, ToPort: 443, CidrIp: "0.0.0.0/0" }] } });
    expect(template.Outputs.WorkerQuarantineGroupId.Value).toEqual({ Ref: "WorkerQuarantineGroup" });
    expect(Object.values(template.Resources).some(row => row.Type === "AWS::EC2::NetworkInterfaceAttachment")).toBe(false);
  });
  it("uses ACM HTTPS, fixed host routes and a denying default; health is transport evidence only", () => {
    const template = demoWorkloadTemplate(plan()); expect(template.Resources.Listener.Properties).toMatchObject({ Protocol: "HTTPS", Port: 443, Certificates: [{ CertificateArn: fixture.plan.certificateArn }], DefaultActions: [{ Type: "fixed-response", FixedResponseConfig: { StatusCode: "404", ContentType: "text/plain", MessageBody: "Not found." } }] });
    for (const name of ["Published", "Preview"]) {
      expect(template.Resources[name + "Rule"].Properties.Conditions).toEqual([{ Field: "host-header", HostHeaderConfig: { Values: [expect.stringMatching(/^[a-f0-9-]{36}\.apps\.smart-deploy\.xyz$/)] } }]);
      expect(template.Resources[name + "Target"].Properties.Matcher).toEqual({ HttpCode: "403" });
    }
    expect(template.Metadata.TargetHealthIsTransportOnly).toBe(true); expect(template.Resources.AppDns.Properties).toMatchObject({ Name: "*.apps.smart-deploy.xyz", Type: "A" });
  });
  it("scopes build trust to the existing project, without source/secret/data/IAM or repository-creation access", () => {
    const properties = demoWorkloadTemplate(plan()).Resources.BuildRole.Properties;
    expect(properties.AssumeRolePolicyDocument).toMatchObject({ Statement: [{ Principal: { Service: "codebuild.amazonaws.com" }, Condition: { StringEquals: { "aws:SourceAccount": "123456789012", "aws:SourceArn": "arn:aws:codebuild:us-west-2:123456789012:project/smartdeploy-builder" } } }] });
    const text = JSON.stringify(properties); for (const forbidden of ["secretsmanager:", "ssm:", "dynamodb:", "iam:PassRole", "ecr:CreateRepository", "s3:"]) expect(text).not.toContain(forbidden);
    expect(text).toContain("sdp-0123456789abcdef0123-notes"); expect(text).toContain("ecr:GetAuthorizationToken");
  });
  it("retains the same one-app transaction permission ceiling as the broker", () => {
    const role = demoWorkloadTemplate(plan()).Resources.DocumentRole;
    const text = JSON.stringify(role.Properties); expect(text).toContain("APP#" + fixture.plan.cleanup.appId); expect(text).toContain("dynamodb:LeadingKeys"); expect(text).toContain("TransactWriteItems"); expect(text).not.toContain("dynamodb:Scan"); expect(text).not.toContain("dynamodb:Query"); expect(text).not.toContain("ssm:");
  });
  it("matches cleanup's exact target names and creates no NAT, RDS, new worker or cluster", async () => {
    const template = demoWorkloadTemplate(plan()); const guard = await buildDemoGuardTemplate(); const statement = guard.Resources.CleanupRole.Properties.Policies[0].PolicyDocument.Statement.find(row => row.Action === "elasticloadbalancing:DeleteTargetGroup");
    expect(JSON.stringify(statement)).toContain("-pub/*"); expect(JSON.stringify(statement)).toContain("-prev/*"); expect(template.Resources.PublishedTarget.Properties.Name).toBe("sdp-0123456789abcdef0123-pub"); expect(template.Resources.PreviewTarget.Properties.Name).toBe("sdp-0123456789abcdef0123-prev");
    for (const row of Object.values(template.Resources)) expect(["AWS::EC2::NatGateway", "AWS::RDS::DBInstance", "AWS::EC2::Instance", "AWS::ECS::Cluster", "AWS::KMS::Key"]).not.toContain(row.Type);
  });
  it.each(["tag", "foreign-account", "foreign-repository", "principal-root", "duplicate-subnet", "cross-environment-certificate", "extra-secret"])('rejects unsafe plan variation "%s" before rendering', variant => {
    const input = plan();
    if (variant === "tag") input.images.publishedV1 = input.images.publishedV1.replace(/@sha256:.+$/, ":latest");
    if (variant === "foreign-account") input.images.worker = input.images.worker.replace("123456789012", "222222222222");
    if (variant === "foreign-repository") input.images.preview = input.images.preview.replace("-notes@", "-other@");
    if (variant === "principal-root") input.documentPrincipalArn = "arn:aws:iam::123456789012:root";
    if (variant === "duplicate-subnet") input.subnetIds[1] = input.subnetIds[0];
    if (variant === "cross-environment-certificate") input.releases[2].certificatePem = input.releases[0].certificatePem;
    if (variant === "extra-secret") Object.assign(input, { gatewayToken: "must-never-be-a-template-input" });
    expect(() => DemoWorkloadPlan.parse(input)).toThrow();
  });
});
