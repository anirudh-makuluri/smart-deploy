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
		expect(script).toContain("ExecStartPre=/usr/bin/docker pull ${WORKER_IMAGE}");
	});

	it("boots existing-worker instances with the same startup safeguards", () => {
		const template = readRepoFile("infra/aws-worker/user_data.sh.tpl");
		expect(template).toContain("TimeoutStartSec=0");
		expect(template).toContain("ExecStartPre=/usr/bin/docker pull ${worker_image}");
	});

	it("boots fresh-worker instances with the same startup safeguards", () => {
		const template = readRepoFile("infra/aws-worker-new/user_data.sh.tpl");
		expect(template).toContain("TimeoutStartSec=0");
		expect(template).toContain("ExecStartPre=/usr/bin/docker pull ${worker_image}");
	});
});
