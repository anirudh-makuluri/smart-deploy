import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PostScanResults from "@/components/PostScanResults";
import type { DeployConfig, SDArtifactsResponse } from "@/app/types";

const deployment: DeployConfig = {
	id: "dep-1",
	repoName: "smart-deploy",
	serviceName: "web",
	url: "https://github.com/acme/smart-deploy",
	branch: "main",
	status: "running",
	commitSha: null,
	envVars: null,
	liveUrl: null,
	screenshotUrl: null,
	firstDeployment: null,
	lastDeployment: null,
	revision: null,
	cloudProvider: "aws",
	deploymentTarget: "ec2",
	awsRegion: "us-west-2",
	ec2: null,
	cloudRun: null,
	scanResults: {} as SDArtifactsResponse,
};

const scanResults: SDArtifactsResponse = {
	commit_sha: "abc123",
	stack_summary: "Node Express app",
	services: [
		{
			name: "web",
			build_context: ".",
			port: 8080,
			dockerfile_path: "Dockerfile",
			language: "TypeScript",
			framework: "Express",
		},
	],
	dockerfiles: {
		Dockerfile: "FROM node:20-alpine\nWORKDIR /app",
	},
	docker_compose: "",
	nginx_conf: "",
	has_existing_dockerfiles: true,
	has_existing_compose: false,
	risks: [],
	confidence: 0.9,
	hadolint_results: {},
	token_usage: {
		input_tokens: 10,
		output_tokens: 5,
		total_tokens: 15,
	},
};

describe("PostScanResults", () => {
	it("allows editing detected service build context (ctx)", async () => {
		const onUpdateResults = vi.fn();

		render(
			<PostScanResults
				results={scanResults}
				deployment={deployment}
				onStartDeployment={vi.fn()}
				onCancel={vi.fn()}
				onUpdateResults={onUpdateResults}
			/>
		);

		fireEvent.doubleClick(screen.getByText("web"));

		const ctxInput = screen.getByPlaceholderText(".") as HTMLInputElement;
		fireEvent.change(ctxInput, { target: { value: "apps/web" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => {
			expect(onUpdateResults).toHaveBeenCalled();
		});

		const updated = onUpdateResults.mock.calls.at(-1)?.[0] as SDArtifactsResponse;
		expect(updated.services[0]?.build_context).toBe("apps/web");
		expect(updated.services[0]?.port).toBe(8080);
	});
});
