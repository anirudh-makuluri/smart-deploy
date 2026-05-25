import { describe, expect, it } from "vitest";
import { deriveRemediationProposal } from "@/lib/remediationRules";

describe("deriveRemediationProposal", () => {
	it("proposes concrete proxy, compose, and runtime port fixes for single-service EC2 deploys", () => {
		const proposal = deriveRemediationProposal({
			deployConfig: {
				envVars: "NODE_ENV=production\nPORT=3000",
				scanResults: {
					services: [{ name: "web", port: 8080 }],
					docker_compose: "services:\n  web:\n    ports:\n      - 3000:3000",
					nginx_conf: "location / {\n  proxy_pass http://127.0.0.1:3000;\n}",
				},
			} as any,
			steps: [
				{
					id: "deploy",
					label: "Deploy",
					status: "error",
					logs: ["nginx returned 502 bad gateway", "upstream connection refused"],
				},
			] as any,
			healthCheck: {
				url: "https://example.com",
				status: "unreachable",
				failure_type: "connection_refused",
				error_message: "upstream connection refused",
				checked_at: new Date().toISOString(),
			} as any,
		});

		expect(proposal.summary).toContain("proxy or port mismatch");
		expect(proposal.rootCause).toContain("8080");
		expect(proposal.riskLevel).toBe("safe");
		expect(proposal.confidence).toBeGreaterThan(0.8);
		expect(proposal.changes.map((change) => change.title)).toEqual([
			"Align nginx upstream port",
			"Align docker-compose port mapping",
			"Ensure PORT env var is wired",
		]);
		expect(proposal.filesToModify).toEqual(["nginx.conf", "docker-compose.yml", "envVars"]);
		expect(proposal.proposedConfigPatch).toEqual({ envVars: "NODE_ENV=production\nPORT=8080" });
		expect(proposal.diffPreview.map((entry) => entry.target)).toEqual([
			"artifact:docker-compose.yml",
			"artifact:nginx.conf",
			"config:envVars",
		]);
	});

	it("avoids broad docker-compose rewrites for multi-service deployments", () => {
		const proposal = deriveRemediationProposal({
			deployConfig: {
				envVars: null,
				scanResults: {
					services: [
						{ name: "web", port: 8080 },
						{ name: "worker", port: 9000 },
					],
					docker_compose:
						"services:\n  web:\n    ports:\n      - 3000:3000\n  worker:\n    ports:\n      - 9000:9000",
					nginx_conf: "proxy_pass http://127.0.0.1:3000;",
				},
			} as any,
			steps: [{ id: "deploy", label: "Deploy", status: "error", logs: ["upstream connection refused"] }] as any,
		});

		expect(proposal.changes.some((change) => change.target === "docker-compose.yml")).toBe(false);
		expect(proposal.diffPreview.some((entry) => entry.target === "artifact:docker-compose.yml")).toBe(false);
	});

	it("falls back to artifact regeneration when no deterministic runtime fix is available", () => {
		const proposal = deriveRemediationProposal({
			deployConfig: {
				envVars: null,
				scanResults: {},
			} as any,
			steps: [{ id: "deploy", label: "Deploy", status: "error", logs: ["container exited"] }] as any,
		});

		expect(proposal.summary).toBeUndefined();
		expect(proposal.riskLevel).toBe("moderate");
		expect(proposal.confidence).toBe(0.38);
		expect(proposal.changes).toEqual([
			{
				title: "Regenerate deployment artifacts",
				description: "Regenerate deployment artifacts with failure context and retry the deployment.",
				target: "generated-artifacts",
			},
		]);
		expect(proposal.filesToModify).toEqual(["generated-artifacts"]);
		expect(proposal.diffPreview).toEqual([]);
		expect(proposal.proposedConfigPatch).toEqual({});
	});
});
