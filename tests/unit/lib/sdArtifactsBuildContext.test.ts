import { describe, expect, it } from "vitest";
import type { SDArtifactsResponse } from "@/app/types";
import {
	buildSdArtifactsRemoteBuildRepoName,
	resolveSdArtifactsPrebuiltImage,
	sdArtifactsRemoteBuildImageTag,
} from "@/lib/sdArtifactsBuildContext";

function makeScan(overrides: Partial<SDArtifactsResponse> = {}): SDArtifactsResponse {
	return {
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
			},
		],
		remote_builds: {},
		build_verification: {},
		repair_history: [],
		pipeline_trace: [],
		errors: [],
		llm_outputs: {},
		inputs_snapshot: {},
		token_usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
		...overrides,
	};
}

describe("sdArtifactsBuildContext prebuilt image helpers", () => {
	it("matches sd-artifacts remote-build repository naming", () => {
		expect(buildSdArtifactsRemoteBuildRepoName("smart-deploy", ".")).toBe("sd/smart-deploy/root");
		expect(buildSdArtifactsRemoteBuildRepoName("smart-deploy", "apps/web")).toBe("sd/smart-deploy/apps/web");
		expect(buildSdArtifactsRemoteBuildRepoName("Smart Deploy", "./Apps/Admin UI/")).toBe("sd/smart-deploy/apps/admin-ui");
	});

	it("uses the upstream short image-tag convention", () => {
		expect(sdArtifactsRemoteBuildImageTag("abcdef123456")).toBe("abcdef");
		expect(sdArtifactsRemoteBuildImageTag("ABCDEF123456")).toBe("abcdef");
	});

	it("prefers the exact image_uri returned by analyze/stream", () => {
		const scan = makeScan({
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
						image_uri: "123456789012.dkr.ecr.us-west-2.amazonaws.com/sd/smart-deploy/root:abcdef",
						image_digest: "sha256:abc",
						ecr_repository: "sd/smart-deploy/root",
						image_tag: "abcdef",
					},
				},
			],
		});

		expect(resolveSdArtifactsPrebuiltImage({ scan, repoName: "smart-deploy" })).toEqual(
			expect.objectContaining({
				ecrRepoName: "sd/smart-deploy/root",
				imageTag: "abcdef",
				imageUri: "123456789012.dkr.ecr.us-west-2.amazonaws.com/sd/smart-deploy/root:abcdef",
				imageDigest: "sha256:abc",
			})
		);
	});

	it("falls back to the sd-artifacts repo path when image_uri is omitted", () => {
		const scan = makeScan({
			commit_sha: "1234567890ab",
			deploy_units: [
				{
					name: "web",
					root: "apps/web",
					type: "server",
					provider: "node",
					framework: null,
					port: 3000,
					artifacts: {
						railpack_plan: { deploy: { startCommand: "npm start" } },
						railpack_json: null,
					},
					remote_build: {
						unit_name: "web",
						unit_root: "apps/web",
						status: "SUCCEEDED",
						image_tag: "123456",
					},
				},
			],
		});

		expect(resolveSdArtifactsPrebuiltImage({ scan, repoName: "smart-deploy", preferredServiceName: "web" })).toEqual(
			expect.objectContaining({
				ecrRepoName: "sd/smart-deploy/apps/web",
				imageTag: "123456",
				imageUri: null,
				imageDigest: null,
			})
		);
	});
});
