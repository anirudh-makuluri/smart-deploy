import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readRepoFile(relativePath: string): string {
	return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("worker systemd service definitions", () => {
	it("gives image pulls unlimited startup time during rollout", () => {
		const script = readRepoFile("scripts/lib/worker-release.sh");
		expect(script).toContain("TimeoutStartSec=0");
		expect(script).toContain("cat >/usr/local/bin/smart-deploy-worker-login <<'SCRIPT'");
		expect(script).toContain("cat >/usr/local/bin/smart-deploy-worker-prune-images <<'SCRIPT'");
		expect(script).toContain("ExecStartPre=/usr/local/bin/smart-deploy-worker-login ${WORKER_IMAGE}");
		expect(script).toContain("ExecStartPre=/usr/local/bin/smart-deploy-worker-prune-images ${WORKER_IMAGE}");
		expect(script).toContain("ExecStartPre=/usr/bin/docker pull ${WORKER_IMAGE}");
	});

	it("supports env overrides so CI can roll out without local terraform state", () => {
		const script = readRepoFile("scripts/lib/worker-release.sh");
		expect(script).toContain('ECR_REGISTRY="${ECR_REGISTRY:-${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com}"');
		expect(script).toContain("WORKER_INSTANCE_ID");
		expect(script).toContain("WORKER_SECRET_ARN");
		expect(script).toContain("WORKER_DNS_RECORD");
		expect(script).toContain("worker_release_read_output");
	});

	it("targets the configured ECR account consistently during worker releases", () => {
		const script = readRepoFile("scripts/lib/worker-release.sh");
		expect(script).toContain('aws sts get-caller-identity --query Account --output text');
		expect(script).toContain('describe-repositories --registry-id "${AWS_ACCOUNT_ID}"');
		expect(script).toContain('create-repository --registry-id "${AWS_ACCOUNT_ID}"');
		expect(script).toContain('docker login --username AWS --password-stdin "${ECR_REGISTRY}"');
		expect(script).toContain('batch-check-layer-availability');
		expect(script).toContain('initiate-layer-upload');
		expect(script).toContain('WORKER_RELEASE_DOCKER_CONFIG_DIR="$(mktemp -d)"');
		expect(script).toContain('worker_release_cleanup_docker_config');
		expect(script).toContain('/^WARNING! Your credentials are stored unencrypted in /d');
		expect(script).toContain("worker_release_preflight_ecr_push_permissions");
	});

	it("boots existing-worker instances with the same startup safeguards", () => {
		const template = readRepoFile("infra/aws-worker/user_data.sh.tpl");
		expect(template).toContain("TimeoutStartSec=0");
		expect(template).toContain("cat >/usr/local/bin/smart-deploy-worker-login <<'SCRIPT'");
		expect(template).toContain("cat >/usr/local/bin/smart-deploy-worker-prune-images <<'SCRIPT'");
		expect(template).toContain('ExecStartPre=/usr/local/bin/smart-deploy-worker-login "${worker_image}"');
		expect(template).toContain('ExecStartPre=/usr/local/bin/smart-deploy-worker-prune-images "${worker_image}"');
		expect(template).toContain("ExecStartPre=/usr/bin/docker pull ${worker_image}");
	});

	it("boots fresh-worker instances with the same startup safeguards", () => {
		const template = readRepoFile("infra/aws-worker-new/user_data.sh.tpl");
		expect(template).toContain("TimeoutStartSec=0");
		expect(template).toContain("cat >/usr/local/bin/smart-deploy-worker-login <<'SCRIPT'");
		expect(template).toContain("cat >/usr/local/bin/smart-deploy-worker-prune-images <<'SCRIPT'");
		expect(template).toContain('ExecStartPre=/usr/local/bin/smart-deploy-worker-login "${worker_image}"');
		expect(template).toContain('ExecStartPre=/usr/local/bin/smart-deploy-worker-prune-images "${worker_image}"');
		expect(template).toContain("ExecStartPre=/usr/bin/docker pull ${worker_image}");
	});
});
