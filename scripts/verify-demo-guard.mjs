import { spawnSync } from "node:child_process";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDemoGuardTemplate } from "./build-demo-guard.mjs";

if (process.argv.length < 3 || process.argv.length > 4) throw Error("Usage: node scripts/verify-demo-guard.mjs GUARD_BINARY [REPORT_JSON]");
const executable = process.argv[2];
const directory = await mkdtemp(path.join(tmpdir(), "smartdeploy-cfn-guard-")); const files = [];
const mutations = [
  ["concurrency", "bounded_cleanup", value => { value.Resources.CleanupFunction.Properties.ReservedConcurrentExecutions = 10; }],
  ["worker-lease", "worker_lease", value => { delete value.Resources.CleanupRole.Properties.Policies[0].PolicyDocument.Statement.find(row => row.Action === "ec2:StopInstances").Condition; }],
  ["interface-scope", "interface_lease", value => { value.Resources.CleanupRole.Properties.Policies[0].PolicyDocument.Statement.find(row => row.Action === "ec2:ModifyNetworkInterfaceAttribute").Resource = "*"; }],
  ["queue-encryption", "protected_audit", value => { value.Resources.CleanupDlq.Properties.SqsManagedSseEnabled = false; }],
  ["schedule-end", "bounded_cleanup", value => { delete value.Resources.CleanupSchedule.Properties.EndDate; }],
  ["schedule-trust", "scheduler_identity", value => { value.Resources.SchedulerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals["aws:SourceArn"] = { "Fn::GetAtt": ["CleanupSchedule", "Arn"] }; }],
  ["app-resource", "control_plane_only", value => { value.Resources.UnexpectedTable = { Type: "AWS::DynamoDB::Table" }; }],
  ["async-retry-age", "bounded_cleanup", value => { value.Resources.CleanupAsyncDelivery.Properties.MaximumEventAgeInSeconds = 21600; }],
];
const results = [];
async function validate(label, template) {
  const target = path.join(directory, label + ".json"); files.push(target); await writeFile(target, JSON.stringify(template));
  const result = spawnSync(executable, ["validate", "--rules", path.resolve("infra/demo/guard.rules"), "--data", target, "--output-format", "json", "--show-summary", "none"],
    { encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { exit: result.status, report: JSON.parse(result.stdout) };
}
try {
  const template = await buildDemoGuardTemplate(); const baseline = await validate("baseline", template);
  if (baseline.exit !== 0 || baseline.report.status !== "PASS" || baseline.report.not_applicable.length || baseline.report.compliant.length !== 6) throw Error("Demo guard baseline incomplete or failed");
  results.push({ scenario: "baseline", passed: true });
  for (const [label, expectedRule, mutate] of mutations) {
    const candidate = structuredClone(template); mutate(candidate); const result = await validate(label, candidate);
    if (result.exit === 0 || result.report.status !== "FAIL" || !JSON.stringify(result.report.not_compliant).includes(expectedRule)) throw Error("Guard did not detect mutation: " + label);
    results.push({ scenario: label, passed: true, expectedRule });
  }
  if (process.argv[3]) await writeFile(path.resolve(process.argv[3]), JSON.stringify(results, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ passed: results.length, negativeCases: mutations.length }) + "\n");
} finally { for (const file of files) await unlink(file); await rmdir(directory); }
