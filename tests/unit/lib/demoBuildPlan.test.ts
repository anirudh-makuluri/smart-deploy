import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoBuildPlan } from "@/lib/aws/demoBuildPlan";
import { demoWorkloadFixture } from "../../helpers/demoWorkloadPlan";
let fixture: Awaited<ReturnType<typeof demoWorkloadFixture>>;
beforeAll(async () => { fixture = await demoWorkloadFixture(); }); afterAll(async () => { await fixture?.dispose(); });
function input() { return { workload: { ...structuredClone(fixture.plan), phase: "build", certificateArn: "", images: { worker: "", tls: "", publishedV1: "", publishedV2: "", preview: "" } }, commitSha: "a".repeat(40), archiveSha256: "b".repeat(64) }; }
describe("bounded build CLI payload", () => {
  it("uses a separately scoped role, fixed existing project and finite one-attempt small build", () => {
    const result = demoBuildPlan(input()); expect(result).toMatchObject({ projectName: "smartdeploy-builder", sourceTypeOverride: "NO_SOURCE", serviceRoleOverride: "arn:aws:iam::123456789012:role/sdp-0123456789abcdef0123-build", computeTypeOverride: "BUILD_GENERAL1_SMALL", timeoutInMinutesOverride: 15, queuedTimeoutInMinutesOverride: 5, autoRetryLimitOverride: 0, debugSessionEnabled: false, reportBuildStatusOverride: false, artifactsOverride: { type: "NO_ARTIFACTS" }, cacheOverride: { type: "NO_CACHE" } });
    expect(result).not.toHaveProperty("sourceAuthOverride"); expect(result).not.toHaveProperty("environmentVariablesOverride"); expect(result.idempotencyToken!.length).toBeLessThanOrEqual(64);
  });
  it("pins the public commit/archive and builds exactly the five owned images without secret or provider changes", () => {
    const result = demoBuildPlan(input()); const spec = JSON.parse(result.buildspecOverride!); const all = JSON.stringify(spec);
    expect(all).toContain("codeload.github.com/anirudh-makuluri/smart-deploy/tar.gz/" + "a".repeat(40)); expect(all).toContain("b".repeat(64) + "  source.tar.gz"); expect(all).toContain("sha256sum --check");
    expect(spec.phases.build.commands.filter((command: string) => command.startsWith("docker build"))).toHaveLength(5); expect(spec.phases.post_build.commands.filter((command: string) => command.startsWith("docker push"))).toHaveLength(5);
    expect(all).toContain("npm ci --ignore-scripts"); expect(all).toContain("--password-stdin"); expect(all).not.toMatch(/secretsmanager|ssm get|sts assume|create-repository|git clone|terraform|cdk deploy/);
    expect(all).toContain("--target private-demo --build-arg WORKER_VERSION=");
    expect(demoBuildPlan(input()).idempotencyToken).toBe(result.idempotencyToken);
  });
  it.each([0, 1799000, 7201000])("rejects a missing/late/oversized build window with %ims remaining", remaining => {
    const value = input(); const now = Math.floor(Date.now() / 1000) * 1000; value.workload.cleanup.expiresAt = now + remaining;
    expect(() => demoBuildPlan(value, now)).toThrow();
  });
  it.each(["commit", "archive", "runtime-phase", "unknown-role"])('rejects unsupported input "%s" before constructing shell commands', variant => {
    const value = input(); if (variant === "commit") value.commitSha = "a".repeat(40) + "\ncommand"; if (variant === "archive") value.archiveSha256 = "$(secret)"; if (variant === "runtime-phase") value.workload = { ...fixture.plan };
    if (variant === "unknown-role") Object.assign(value, { serviceRoleOverride: "arn:aws:iam::123456789012:role/broad" }); expect(() => demoBuildPlan(value)).toThrow();
  });
});
