import type { StartBuildCommandInput } from "@aws-sdk/client-codebuild";
import { z } from "zod";
import { DemoWorkloadPlan } from "./demoWorkload";
const Input = z.strictObject({ workload: DemoWorkloadPlan, commitSha: z.string().regex(/^[a-f0-9]{40}$/), archiveSha256: z.string().regex(/^[a-f0-9]{64}$/) });

/** Pure CLI payload only. Fresh guard/lease/project/budget checks must precede actual StartBuild. */
export function demoBuildPlan(value: unknown, now: number = Date.now()): StartBuildCommandInput {
  const input = Input.parse(value); const c = input.workload.cleanup;
  if (input.workload.phase !== "build" || !Number.isSafeInteger(now) || c.expiresAt - now < 1800000 || c.expiresAt - now > 7200000) throw Error("A fresh bounded build window is required.");
  const registry = `${c.accountId}.dkr.ecr.${c.region}.amazonaws.com`; const prefix = "sdp-" + c.demoId;
  const repository = (name: string) => `${registry}/${prefix}-${name}`;
  const tag = (name: string) => name + "-" + input.commitSha;
  const archive = new URL(encodeURIComponent(input.commitSha), "https://codeload.github.com/anirudh-makuluri/smart-deploy/tar.gz/");
  const remaining = (milliseconds: number) => `node -e 'if(Date.now() >= ${c.expiresAt} - ${milliseconds}) process.exit(1)'`;
  const commands = [
    remaining(600000),
    `docker build --platform linux/amd64 --target private-demo --build-arg WORKER_VERSION=${input.commitSha} -f Dockerfile.websocket -t ${repository("worker")}:${tag("worker")} .`,
    remaining(600000), "npm ci --ignore-scripts --no-audit --no-fund", "npm run workload:build",
    `docker build --platform linux/amd64 -f infra/workload-tls.Dockerfile -t ${repository("tls")}:${tag("tls")} dist/workload-tls`,
  ];
  for (const release of ["v1", "v2", "preview"]) commands.push(remaining(300000), `docker build --platform linux/amd64 --build-arg NOTES_RELEASE=${release} -f demo/notes/Dockerfile -t ${repository("notes")}:${tag(release)} demo/notes`);
  const pushes = [["worker", "worker"], ["tls", "tls"], ["notes", "v1"], ["notes", "v2"], ["notes", "preview"]].flatMap(([repo, label]) => [remaining(300000), `docker push ${repository(repo)}:${tag(label)}`]);
  const buildspec = { version: 0.2, phases: {
    install: { "runtime-versions": { nodejs: 22 }, commands: [remaining(1200000), "test \"$(uname -m)\" = x86_64",
      `curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 5 --max-time 60 ${archive.href} --output source.tar.gz`,
      `echo '${input.archiveSha256}  source.tar.gz' | sha256sum --check`, "mkdir source", "tar --extract --gzip --file source.tar.gz --directory source --strip-components=1 --no-same-owner --no-same-permissions"] },
    pre_build: { commands: [remaining(1200000), `aws ecr get-login-password --region ${c.region} | docker login --username AWS --password-stdin ${registry}`] },
    build: { commands: ['cd "$CODEBUILD_SRC_DIR/source"', ...commands] },
    post_build: { commands: ["test \"$CODEBUILD_BUILD_SUCCEEDING\" = 1", ...pushes, `docker logout ${registry}`] },
  } };
  return { projectName: "smartdeploy-builder", sourceTypeOverride: "NO_SOURCE", serviceRoleOverride: `arn:aws:iam::${c.accountId}:role/${prefix}-build`,
    buildspecOverride: JSON.stringify(buildspec), environmentTypeOverride: "LINUX_CONTAINER", computeTypeOverride: "BUILD_GENERAL1_SMALL", imageOverride: "aws/codebuild/amazonlinux-x86_64-standard:5.0", privilegedModeOverride: true,
    timeoutInMinutesOverride: 15, queuedTimeoutInMinutesOverride: 5, autoRetryLimitOverride: 0, debugSessionEnabled: false, reportBuildStatusOverride: false,
    artifactsOverride: { type: "NO_ARTIFACTS" }, cacheOverride: { type: "NO_CACHE" }, idempotencyToken: `sdp-${c.demoId}-${input.commitSha.slice(0, 32)}`,
    logsConfigOverride: { cloudWatchLogs: { status: "ENABLED", groupName: `/smartdeploy/demo/${c.demoId}`, streamName: "build-" + input.commitSha.slice(0, 12) }, s3Logs: { status: "DISABLED" } } };
}
