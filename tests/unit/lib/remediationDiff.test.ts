import { describe, expect, it } from "vitest";
import { buildRemediationDiffPreview } from "@/lib/remediationDiff";

describe("buildRemediationDiffPreview", () => {
	it("detects modified artifact and runtime config changes", () => {
		const diffs = buildRemediationDiffPreview({
			currentScanResults: {
				dockerfiles: { Dockerfile: "FROM node:18\nRUN npm install" },
				docker_compose: "services:\n  web:\n    ports:\n      - 3000:3000",
				nginx_conf: "proxy_pass http://127.0.0.1:3000;",
			} as any,
			proposedScanResults: {
				dockerfiles: { Dockerfile: "FROM node:20\nRUN npm ci" },
				docker_compose: "services:\n  web:\n    ports:\n      - 8080:8080",
				nginx_conf: "proxy_pass http://127.0.0.1:8080;",
			} as any,
			currentConfig: {
				envVars: "PORT=3000",
				liveUrl: "https://old.example.com",
				awsRegion: "us-west-2",
				deploymentTarget: "ec2",
			},
			proposedConfig: {
				envVars: "PORT=8080",
				liveUrl: "https://old.example.com",
				awsRegion: "us-west-2",
				deploymentTarget: "ec2",
			},
		});

		expect(diffs.map((entry) => entry.target)).toEqual([
			"artifact:docker-compose.yml",
			"artifact:Dockerfile",
			"artifact:nginx.conf",
			"config:envVars",
		]);
		expect(diffs.every((entry) => entry.changeType === "modified")).toBe(true);
	});

	it("detects added and removed entries", () => {
		const diffs = buildRemediationDiffPreview({
			currentScanResults: {
				dockerfiles: { Dockerfile: "FROM node:18" },
			} as any,
			proposedScanResults: {
				nginx_conf: "server { listen 80; }",
			} as any,
		});

		expect(diffs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ target: "artifact:Dockerfile", changeType: "removed" }),
				expect.objectContaining({ target: "artifact:nginx.conf", changeType: "added" }),
			])
		);
	});
});
