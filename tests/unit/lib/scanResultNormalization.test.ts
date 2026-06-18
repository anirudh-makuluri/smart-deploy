import { describe, expect, it } from "vitest";
import { normalizeScanResultPayload } from "@/lib/scanResultNormalization";

describe("normalizeScanResultPayload", () => {
	it("preserves remote build metadata from sd-artifacts analyze responses", () => {
		const normalized = normalizeScanResultPayload({
			response_id: "resp-1",
			commit_sha: "abcdef123456",
			package_path: ".",
			deploy_shape: "server",
			build_status: "passed",
			railpack_version: "0.1.0",
			workflow_version: "1",
			deploy_briefing: "API service",
			deploy_units: [
				{
					name: "api",
					root: ".",
					type: "server",
					provider: "node",
					framework: null,
					port: 3000,
					artifacts: {
						railpack_plan: { deploy: { startCommand: "npm start" } },
						railpack_json: null,
					},
					remote_build: {
						unit_name: "api",
						unit_root: ".",
						status: "SUCCEEDED",
						image_uri: "123456789012.dkr.ecr.us-west-2.amazonaws.com/sd/repo/root:abcdef",
						image_digest: "sha256:abc",
					},
				},
			],
			remote_builds: {
				api: {
					unit_name: "api",
					unit_root: ".",
					status: "SUCCEEDED",
					image_uri: "123456789012.dkr.ecr.us-west-2.amazonaws.com/sd/repo/root:abcdef",
					image_digest: "sha256:abc",
				},
			},
			build_verification: {},
			repair_history: [],
			pipeline_trace: [],
			errors: [],
			llm_outputs: {},
			inputs_snapshot: {},
			token_usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
		});

		expect(normalized?.remote_builds.api.image_digest).toBe("sha256:abc");
		expect(normalized?.deploy_units[0]?.remote_build?.image_uri).toBe(
			"123456789012.dkr.ecr.us-west-2.amazonaws.com/sd/repo/root:abcdef"
		);
	});
});
