import { describe, expect, it } from "vitest";
import type { DeployConfig, RepoRecord } from "@/app/types";
import { countDeployedServicesForRepo, getDeploymentForService } from "@/lib/utils";

function makeRepoRecord(overrides: Partial<RepoRecord> = {}): RepoRecord {
	return {
		repo_url: "https://github.com/acme/shop",
		branch: "main",
		repo_owner: "acme",
		repo_name: "shop",
		services: [{ name: "web", path: "apps/web", language: "ts", deployMode: "container" }],
		is_monorepo: true,
		updated_at: new Date().toISOString(),
		...overrides,
	};
}

function makeDeployment(overrides: Partial<DeployConfig> = {}): DeployConfig {
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

describe("countDeployedServicesForRepo", () => {
	it("counts deployed services by exact service name match", () => {
		const record = makeRepoRecord();
		const deployments = [makeDeployment({ serviceName: "web", status: "running" })];

		expect(countDeployedServicesForRepo(record, deployments)).toBe(1);
	});

	it("counts all services when a repo-level deployment exists", () => {
		const record = makeRepoRecord({
			services: [
				{ name: "web", path: "apps/web", language: "ts", deployMode: "container" },
				{ name: "api", path: "apps/api", language: "ts", deployMode: "container" },
			],
		});
		const deployments = [makeDeployment({ serviceName: ".", status: "running" })];

		expect(countDeployedServicesForRepo(record, deployments)).toBe(2);
	});
});

describe("getDeploymentForService", () => {
	it("prefers a failed service deployment over a repo-level draft row", () => {
		const deployment = getDeploymentForService(
			[
				makeDeployment({
					id: "repo-draft",
					serviceName: ".",
					status: "didnt_deploy",
					lastDeployment: "2026-05-26T20:00:00.000Z",
				}),
				makeDeployment({
					id: "service-failed",
					serviceName: "web",
					status: "failed",
					lastDeployment: "2026-05-26T19:00:00.000Z",
				}),
			],
			"https://github.com/acme/shop",
			"web",
			"shop"
		);

		expect(deployment?.id).toBe("service-failed");
		expect(deployment?.status).toBe("failed");
	});
});
