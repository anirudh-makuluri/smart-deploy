import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import DeploymentHistory from "@/components/DeploymentHistory";
import type { DeployConfig, DeploymentHistoryEntry } from "@/app/types";

vi.mock("@/lib/graphqlClient", () => ({
	fetchDeploymentHistoryPage: vi.fn(),
}));

function renderWithQueryClient(ui: React.ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});

	return render(
		<QueryClientProvider client={queryClient}>
			{ui}
		</QueryClientProvider>
	);
}

describe("DeploymentHistory", () => {
	it("marks the matching active release and disables rollback for it", () => {
		const activeDeployment: DeployConfig = {
			id: "dep-1",
			repoName: "smart-deploy",
			serviceName: "web",
			url: "https://github.com/acme/smart-deploy",
			branch: "main",
			kind: "container",
			commitSha: "abcdef123456",
			envVars: null,
			liveUrl: "https://web.example.com",
			screenshotUrl: null,
			status: "running",
			firstDeployment: null,
			lastDeployment: null,
			revision: 3,
			cloudProvider: "aws",
			deploymentTarget: "ec2",
			awsRegion: "us-west-2",
			ec2: null,
			cloudRun: null,
			scanResults: {},
		};

		const history: DeploymentHistoryEntry[] = [
			{
				id: "hist-active",
				repo_name: "smart-deploy",
				service_name: "web",
				timestamp: "2026-06-01T00:00:00.000Z",
				success: true,
				steps: [],
				configSnapshot: {},
				releaseArtifact: {
					kind: "ecr_image",
					cloudProvider: "aws",
					deploymentTarget: "ec2",
					region: "us-west-2",
					ecrRegistry: "123456789012.dkr.ecr.us-west-2.amazonaws.com",
					ecrRepoName: "smartdeploy/smart-deploy",
					imageTag: "abcdef",
					imageUri: "123456789012.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/smart-deploy:abcdef",
					commitSha: "abcdef123456",
					branch: "main",
					deployConfig: {
						repoName: "smart-deploy",
						serviceName: "web",
						url: "https://github.com/acme/smart-deploy",
						branch: "main",
						kind: "container",
						commitSha: "abcdef123456",
						cloudProvider: "aws",
						deploymentTarget: "ec2",
						awsRegion: "us-west-2",
					},
				},
				commitSha: "abcdef123456",
				branch: "main",
			},
			{
				id: "hist-older",
				repo_name: "smart-deploy",
				service_name: "web",
				timestamp: "2026-05-31T00:00:00.000Z",
				success: true,
				steps: [],
				configSnapshot: {},
				releaseArtifact: {
					kind: "ecr_image",
					cloudProvider: "aws",
					deploymentTarget: "ec2",
					region: "us-west-2",
					ecrRegistry: "123456789012.dkr.ecr.us-west-2.amazonaws.com",
					ecrRepoName: "smartdeploy/smart-deploy",
					imageTag: "123456",
					imageUri: "123456789012.dkr.ecr.us-west-2.amazonaws.com/smartdeploy/smart-deploy:123456",
					commitSha: "1234567890ab",
					branch: "main",
					deployConfig: {
						repoName: "smart-deploy",
						serviceName: "web",
						url: "https://github.com/acme/smart-deploy",
						branch: "main",
						kind: "container",
						commitSha: "1234567890ab",
						cloudProvider: "aws",
						deploymentTarget: "ec2",
						awsRegion: "us-west-2",
					},
				},
				commitSha: "1234567890ab",
				branch: "main",
			},
		];

		renderWithQueryClient(
			<DeploymentHistory
				repoName="smart-deploy"
				serviceName="web"
				prefetchedData={{ history, total: history.length }}
				onRollback={vi.fn()}
				activeDeployment={activeDeployment}
				activeDeploymentStatus="running"
			/>
		);

		expect(screen.getByText("Active Release")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /Active Release/ }));
		expect(screen.getByRole("button", { name: "Active Release" })).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: /1234567/ }));
		expect(screen.getByRole("button", { name: "Rollback to this release" })).not.toBeDisabled();
	});
});
