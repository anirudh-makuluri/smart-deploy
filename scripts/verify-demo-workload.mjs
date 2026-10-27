import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
if (process.argv.length !== 5) throw Error("Usage: node scripts/verify-demo-workload.mjs GUARD_BINARY FIXTURE_DIRECTORY REPORT_JSON");
const executable = process.argv[2], fixtureDirectory = path.resolve(process.argv[3]);
const directory = await mkdtemp(path.join(tmpdir(), "smartdeploy-workload-guard-")); const files = [], results = [];
const mutations = [
  ["unknown-phase", "owned_types_and_size", value => { value.Metadata.Phase = "unknown"; }],
  ["quarantine-exposure", "private_origins", value => { value.Resources.WorkerQuarantineGroup.Properties.SecurityGroupIngress = [{ IpProtocol: "tcp", FromPort: 443, ToPort: 443, CidrIp: "0.0.0.0/0" }]; }],
  ["task-role", "bounded_runtime", value => { value.Resources.PublishedV1Task.Properties.TaskRoleArn = "arn:aws:iam::123456789012:role/unexpected"; }],
  ["writable-root", "bounded_runtime", value => { value.Resources.PreviewTask.Properties.ContainerDefinitions[0].ReadonlyRootFilesystem = false; }],
  ["service-scale", "bounded_runtime", value => { value.Resources.PublishedV2Service.Properties.DesiredCount = 2; }],
  ["public-origin", "private_origins", value => { value.Resources.PublishedGroup.Properties.SecurityGroupIngress = [{ IpProtocol: "tcp", FromPort: 8443, ToPort: 8443, CidrIp: "0.0.0.0/0" }]; }],
  ["public-gateway", "private_origins", value => { value.Resources.GatewayGroup.Properties.SecurityGroupIngress[0] = { IpProtocol: "tcp", FromPort: 8444, ToPort: 8444, CidrIp: "0.0.0.0/0" }; }],
  ["tagged-image", "bounded_runtime", value => { value.Resources.PublishedV1Task.Properties.ContainerDefinitions[0].Image = "123456789012.dkr.ecr.us-west-2.amazonaws.com/notes:latest"; }],
  ["deleted-data", "protected_data", value => { delete value.Resources.Documents.DeletionPolicy; }],
  ["unlimited-data-requests", "protected_data", value => { value.Resources.Documents.Properties.OnDemandThroughput.MaxWriteRequestUnits = -1; }],
  ["extra-backup-recovery", "protected_data", value => { value.Resources.Documents.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled = true; }],
  ["mutable-image", "immutable_images", value => { value.Resources.NotesRepository.Properties.ImageTagMutability = "MUTABLE"; }],
  ["broad-build-trust", "scoped_build_trust", value => { delete value.Resources.BuildRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition; }],
  ["unexpected-instance", "owned_types_and_size", value => { value.Resources.Unexpected = { Type: "AWS::EC2::Instance", Properties: {} }; }],
];
async function validate(name, template) {
  const target = path.join(directory, name + ".json"); files.push(target); await writeFile(target, JSON.stringify(template));
  const result = spawnSync(executable, ["validate", "--rules", path.resolve("infra/demo/workload.rules"), "--data", target, "--output-format", "json", "--show-summary", "none"], { encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error) throw result.error; return { exit: result.status, report: JSON.parse(result.stdout) };
}
try {
  const build = JSON.parse(await readFile(path.join(fixtureDirectory, "build-template.json"), "utf8"));
  const runtime = JSON.parse(await readFile(path.join(fixtureDirectory, "runtime-template.json"), "utf8"));
  for (const [name, template, applicable, conditional] of [["build", build, 5, 2], ["runtime", runtime, 6, 1]]) {
    const result = await validate(name, template); if (result.exit !== 0 || result.report.status !== "PASS" || result.report.compliant.length !== applicable || result.report.not_applicable.length !== conditional) throw Error("Incomplete workload guard baseline: " + name);
    results.push({ scenario: name, passed: true, applicableRules: applicable, phaseExcludedRules: conditional });
  }
  for (const [name, rule, mutate] of mutations) {
    const candidate = structuredClone(runtime); mutate(candidate); const result = await validate(name, candidate);
    if (result.exit === 0 || result.report.status !== "FAIL" || !JSON.stringify(result.report.not_compliant).includes(rule)) throw Error("Workload guard missed mutation: " + name);
    results.push({ scenario: name, passed: true, expectedRule: rule });
  }
  const wrongPhase = structuredClone(runtime); wrongPhase.Metadata.Phase = "build"; const result = await validate("runtime-during-build", wrongPhase);
  if (result.exit === 0 || !JSON.stringify(result.report.not_compliant).includes("no_runtime_during_build")) throw Error("Build phase could create runtime resources."); results.push({ scenario: "runtime-during-build", passed: true });
  await writeFile(path.resolve(process.argv[4]), JSON.stringify(results, null, 2) + "\n"); process.stdout.write(JSON.stringify({ passed: results.length, negativeCases: mutations.length + 1 }) + "\n");
} finally { for (const file of files) await unlink(file); await rmdir(directory); }
