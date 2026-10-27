import { chmod, mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runtimeControlFixture } from "./runtimeControlFixture";

/** Public certs/fake catalog only. No platform sessions, real DB or AWS credentials. */
export async function privateDemoWorkerFixture(expiresAt: number, port: number, containerDirectory: string | null) {
  const material = await runtimeControlFixture();
  const directory = await mkdtemp(path.join(tmpdir(), "smartdeploy-private-demo-worker-"));
  const ca = path.join(directory, "ca.pem"), config = path.join(directory, "control.json");
  const operator = containerDirectory ?? directory;
  const dispose = async () => { for (const file of [ca, config]) await unlink(file); await rmdir(directory); await material.dispose(); };
  try {
    if (containerDirectory !== null) await chmod(directory, 0o755); // Only public cert/fake catalog files are mounted.
    material.settings.scope.privateDomain = "apps.smart-deploy.xyz"; material.settings.expiresAt = expiresAt;
    await writeFile(ca, material.materials[0].cert, { mode: 0o644 });
    await writeFile(config, JSON.stringify({ runtime: material.settings, databaseCaFile: path.join(operator, "ca.pem") }), { mode: 0o644 });
    const environment: Record<string, string> = { WORKSPACE_APPS_ENABLED: "true", PRIVATE_APP_GATEWAY_ENABLED: "true", PRIVATE_APP_PUBLISH_ENABLED: "true", WAITING_LIST_ENABLED: "true",
      PRIVATE_APP_PUBLISH_CONFIG: path.join(operator, "control.json"), DATABASE_URL: "postgres://fixture:local-only@127.0.0.1:9/platform?sslmode=no-verify&sslrootcert=must-not-be-read.pem&uselibpqcompat=true",
      BETTER_AUTH_SECRET: "private-demo-process-fixture-never-for-production", WS_ALLOWED_ORIGINS: "https://smart-deploy.xyz", NEXT_PUBLIC_WS_URL: "wss://ws.smart-deploy.xyz/ws", WORKER_VERSION: "a".repeat(40),
      AWS_EC2_METADATA_DISABLED: "true", WS_PORT: String(port) };
    return { directory, environment, expiresAt, dispose };
  } catch (error) { for (const file of [ca, config]) await unlink(file).catch(() => {}); await rmdir(directory); await material.dispose(); throw error; }
}
