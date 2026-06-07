import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoServicesList from "@/components/RepoServicesList";
import type { DetectedServiceInfo, repoType } from "@/app/types";
import { makeDeployment } from "../helpers/deployConfigFixture";

vi.mock("@/components/ServiceTypeIcon", () => ({
	default: () => <div data-testid="service-icon" />,
	ServiceTypeBadge: () => <div data-testid="service-badge" />,
}));

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

		fireEvent.click(within(view.container).getByRole("button", { name: /shop\/web root directory paused/i }));

		expect(openWorkspaceForService).toHaveBeenCalledWith(service);
	});
});
