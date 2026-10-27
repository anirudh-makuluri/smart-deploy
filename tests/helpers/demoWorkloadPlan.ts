import type { DemoWorkloadPlan } from "../../src/lib/aws/demoWorkload";
import { gatewayCertificate } from "./gatewayCertificate";
const APP = "10000000-0000-4000-8000-000000000001";
const PUBLISHED = "20000000-0000-4000-8000-000000000001";
const PREVIEW = "20000000-0000-4000-8000-000000000002";
export async function demoWorkloadFixture() {
  const runtimes = [
    { runtimeId: "30000000-0000-4000-8000-000000000001", bindingId: PUBLISHED, environment: "published" as const },
    { runtimeId: "30000000-0000-4000-8000-000000000002", bindingId: PUBLISHED, environment: "published" as const },
    { runtimeId: "30000000-0000-4000-8000-000000000003", bindingId: PREVIEW, environment: "preview" as const },
  ];
  const certificates: Awaited<ReturnType<typeof gatewayCertificate>>[] = [];
  try {
    const releases: DemoWorkloadPlan["releases"] = [];
    for (const [index, runtime] of runtimes.entries()) {
      const releaseId = `40000000-0000-4000-8000-00000000000${index + 1}`;
      const material = await gatewayCertificate({ bindingId: runtime.bindingId, environment: runtime.environment, releaseId }); certificates.push(material);
      releases.push({ ...runtime, releaseId, certificatePem: material.cert });
    }
    const registry = "123456789012.dkr.ecr.us-west-2.amazonaws.com/sdp-0123456789abcdef0123-";
    const image = (repository: string, hash: string) => registry + repository + "@sha256:" + hash.repeat(64);
    const plan: DemoWorkloadPlan = { phase: "runtime", vpcId: "vpc-0123456789abcdef0", subnetIds: ["subnet-0123456789abcdef0", "subnet-0123456789abcdef1"], hostedZoneId: "Z0123456789ABCDEFG",
      certificateArn: "arn:aws:acm:us-west-2:123456789012:certificate/50000000-0000-4000-8000-000000000001", documentPrincipalArn: "arn:aws:iam::123456789012:user/verified-platform-fixture",
      releases, images: { worker: image("worker", "a"), tls: image("tls", "b"), publishedV1: image("notes", "c"), publishedV2: image("notes", "d"), preview: image("notes", "e") },
      cleanup: { accountId: "123456789012", region: "us-west-2", demoId: "0123456789abcdef0123", appId: APP, expiresAt: Math.floor(Date.now() / 1000) * 1000 + 3600000, clusterName: "fixture-cluster", workerInstanceId: "i-0123456789abcdef0", workerEniId: "eni-0123456789abcdef0", runtimes } };
    return { plan, dispose: async () => { for (const material of certificates) await material.dispose(); } };
  } catch (error) { for (const material of certificates) await material.dispose(); throw error; }
}
