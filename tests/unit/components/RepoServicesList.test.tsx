import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoServicesList from "@/components/RepoServicesList";
import type { DeployConfig, DetectedServiceInfo, repoType } from "@/app/types";

vi.mock("@/components/ServiceTypeIcon", () => ({
	default: () => <div data-testid="service-icon" />,
	ServiceTypeBadge: () => <div data-testid="service-badge" />,
}));

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
	} as DeployConfig;
}

const repo = {
	name: "shop",
	full_name: "acme/shop",
	default_branch: "main",
	html_url: "https://github.com/acme/shop",
	owner: { login: "acme" },
} as repoType;

const service: DetectedServiceInfo = {
	name: "web",
	path: ".",
	language: "ts",
	deployMode: "container",
};

describe("RepoServicesList", () => {
	beforeEach(() => {
		cleanup();
	});

	it("shows paused and stopped labels for offline deployments", () => {
		render(
			<RepoServicesList
				owner="acme"
				repoName="shop"
				repoUrl="https://github.com/acme/shop"
				services={[
					service,
					{ ...service, name: "api", path: "apps/api" },
				]}
				loading={false}
				error={null}
				repoDeployments={[
					makeDeployment({ serviceName: "web", status: "paused" }),
					makeDeployment({ id: "dep-2", serviceName: "api", status: "stopped" }),
				]}
				resolvedRepo={repo}
				openWorkspaceForService={vi.fn()}
			/>
		);

		expect(screen.getByText("Paused")).toBeInTheDocument();
		expect(screen.getByText("Stopped")).toBeInTheDocument();
	});

	it("opens the workspace when a service card is clicked", () => {
		const openWorkspaceForService = vi.fn();

		const view = render(
			<RepoServicesList
				owner="acme"
				repoName="shop"
				repoUrl="https://github.com/acme/shop"
				services={[service]}
				loading={false}
				error={null}
				repoDeployments={[makeDeployment({ serviceName: "web", status: "paused" })]}
				resolvedRepo={repo}
				openWorkspaceForService={openWorkspaceForService}
			/>
		);

		fireEvent.click(within(view.container).getByRole("button", { name: /@shop\/web root: \. paused/i }));

		expect(openWorkspaceForService).toHaveBeenCalledWith(service);
	});
});
