import type { DeployConfig } from "@/app/types";

export function makeDeployment(overrides: Partial<DeployConfig> = {}): DeployConfig {
	return {
		id: "dep-1",
		repoName: "shop",
		repoUrl: "https://github.com/acme/shop",
		branch: "main",
		serviceName: "web",
		status: "running",
		commitSha: null,
		envVars: null,
		hostedSubdomain: null,
		screenshotUrl: null,
		activeRunId: null,
		firstDeployment: null,
		lastDeployment: null,
		revision: null,
		cloudProvider: "aws",
		deploymentTarget: "ecs",
		region: "us-west-2",
		cloudResources: null,
		scanResults: {},
		...overrides,
	};
}
