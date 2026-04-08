import { describe, expect, it } from "vitest";
import type { DeployConfig, RepoServicesRecord } from "@/app/types";
import { countDeployedServicesForRepo } from "@/lib/utils";

function makeRepoRecord(overrides: Partial<RepoServicesRecord> = {}): RepoServicesRecord {
	return {
		repo_url: "https://github.com/acme/shop",
		branch: "main",
		repo_owner: "acme",
		repo_name: "shop",
		services: [{ name: "web", path: "apps/web", language: "ts" }],
		is_monorepo: true,
		updated_at: new Date().toISOString(),
		...overrides,
	};
}

function makeDeployment(overrides: Partial<DeployConfig> = {}): DeployConfig {
	return {
		id: "dep-1",
		repoName: "shop",
		url: "https://github.com/acme/shop",
		branch: "main",
		serviceName: "web",
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
		scanResults: {},
		...overrides,
	};
}

describe("countDeployedServicesForRepo", () => {
	it("counts deployed services by exact service name match", () => {
		const record = makeRepoRecord();
		const deployments = [makeDeployment({ serviceName: "web", status: "running" })];

		expect(countDeployedServicesForRepo(record, deployments)).toBe(1);
	});

	it("counts all services when a repo-level deployment exists", () => {
		const record = makeRepoRecord({
			services: [
				{ name: "web", path: "apps/web", language: "ts" },
				{ name: "api", path: "apps/api", language: "ts" },
			],
		});
		const deployments = [makeDeployment({ serviceName: ".", status: "running" })];

		expect(countDeployedServicesForRepo(record, deployments)).toBe(2);
	});
});
