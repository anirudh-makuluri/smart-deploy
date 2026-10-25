import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import RepoServicesList from "@/components/RepoServicesList";
import type { DeployConfig, DetectedServiceInfo, repoType } from "@/app/types";
import { makeDeployment } from "../helpers/deployConfigFixture";

vi.mock("@/components/RepoRecordIcon", () => ({
	default: () => <div data-testid="service-icon" />,
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

function renderService(deployment: DeployConfig | null) {
	const openWorkspaceForService = vi.fn();
	const view = render(<RepoServicesList owner="acme" repoName="shop" repoUrl="https://github.com/acme/shop"
		services={[service]} loading={false} error={null} repoDeployments={deployment ? [deployment] : []}
		resolvedRepo={repo} openWorkspaceForService={openWorkspaceForService} />);
	return { view, openWorkspaceForService };
}

describe("RepoServicesList", () => {
	beforeEach(() => {
		cleanup();
	});

	it("keeps the live URL outside the workspace button", () => {
		renderService(makeDeployment({ hostedSubdomain: "live-card", status: "running" }));
		const link = screen.getByRole("link");
		expect(link.closest("button")).toBeNull();
		expect(link).toHaveAttribute("target", "_blank");
		expect(link).toHaveAttribute("rel", "noopener noreferrer");
	});

	it("offers independent keyboard workspace and URL actions", async () => {
		const user = userEvent.setup();
		const { openWorkspaceForService } = renderService(makeDeployment({ hostedSubdomain: "live-card", status: "running" }));
		const button = screen.getByRole("button", { name: /web root directory online/i });
		const link = screen.getByRole("link");
		link.addEventListener("click", (event) => event.preventDefault());
		await user.tab();
		expect(button).toHaveFocus();
		await user.keyboard("{Enter}");
		expect(openWorkspaceForService).toHaveBeenCalledOnce();
		await user.tab();
		expect(link).toHaveFocus();
		await user.keyboard("{Enter}");
		expect(openWorkspaceForService).toHaveBeenCalledOnce();
	});

	it("does not open the workspace when the live URL is clicked", () => {
		const { openWorkspaceForService } = renderService(makeDeployment({ hostedSubdomain: "live-card", status: "running" }));
		const link = screen.getByRole("link");
		link.addEventListener("click", (event) => event.preventDefault());
		fireEvent.click(link);
		expect(openWorkspaceForService).not.toHaveBeenCalled();
	});

	it.each([
		["didnt_deploy", "Draft (Not Deployed)"], ["deploying", "Deploying"], ["running", "Online"],
		["paused", "Paused"], ["failed", "Failed"], ["stopped", "Stopped"],
	] as const)("retains the %s status and workspace action", (status, label) => {
		const { openWorkspaceForService } = renderService(makeDeployment({ status, hostedSubdomain: "live-card" }));
		expect(screen.getByText(label)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button"));
		expect(openWorkspaceForService).toHaveBeenCalledWith(service);
		expect(screen.queryByRole("link") !== null).toBe(status === "running");
	});

	it("distinguishes an undeployed service from a saved draft", () => {
		renderService(null);
		expect(screen.getByText("Not Deployed")).toBeInTheDocument();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("keeps the service path in the workspace button's accessible name", () => {
		render(<RepoServicesList owner="acme" repoName="shop" repoUrl="https://github.com/acme/shop"
			services={[{ ...service, path: "apps/web" }]} loading={false} error={null} repoDeployments={[]}
			resolvedRepo={repo} openWorkspaceForService={vi.fn()} />);
		expect(screen.getByRole("button", { name: /web apps\/web not deployed/i })).toBeInTheDocument();
	});

	it("keeps refresh and add-service actions working through the catalog header", async () => {
		const user = userEvent.setup();
		const onRefresh = vi.fn().mockResolvedValue(true);
		const onAddService = vi.fn().mockResolvedValue(true);
		render(<RepoServicesList owner="acme" repoName="shop" repoUrl="https://github.com/acme/shop"
			services={[service]} loading={false} error={null} repoDeployments={[]} resolvedRepo={repo}
			openWorkspaceForService={vi.fn()} catalogActions={{ busy: false, onRefresh, onAddService }} />);
		await user.click(screen.getByRole("button", { name: "Refresh detection" }));
		expect(onRefresh).toHaveBeenCalledOnce();
		await user.click(screen.getByRole("button", { name: "Add service" }));
		const dialog = screen.getByRole("dialog");
		await user.clear(within(dialog).getByLabelText("Root path"));
		await user.type(within(dialog).getByLabelText("Root path"), " apps/api ");
		await user.type(within(dialog).getByLabelText("Display name (optional)"), " api ");
		await user.click(within(dialog).getByRole("button", { name: "Add service" }));
		expect(onAddService).toHaveBeenCalledWith("apps/api", "api");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("disables both catalog header actions while busy", () => {
		render(<RepoServicesList owner="acme" repoName="shop" repoUrl="https://github.com/acme/shop"
			services={[service]} loading={false} error={null} repoDeployments={[]} resolvedRepo={repo}
			openWorkspaceForService={vi.fn()} catalogActions={{ busy: true, onRefresh: vi.fn(), onAddService: vi.fn() }} />);
		expect(screen.getByRole("button", { name: "Refresh detection" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Add service" })).toBeDisabled();
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

		fireEvent.click(within(view.container).getByRole("button", { name: /web root directory paused/i }));

		expect(openWorkspaceForService).toHaveBeenCalledWith(service);
	});
});
