import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DeployOverview from "@/components/deploy-workspace/DeployOverview";
import type { DeployConfig } from "@/app/types";

vi.mock("@/components/DeployOptions", () => ({
	default: () => <div data-testid="deploy-options">Deploy Options</div>,
}));

vi.mock("@/lib/utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/utils")>();
	return {
		...actual,
		formatTimestamp: vi.fn(() => "formatted-time"),
		formatDeploymentTargetName: vi.fn(() => "ECS"),
		getDeploymentDisplayUrl: vi.fn((deployment: DeployConfig) =>
			deployment.hostedSubdomain ? `https://${deployment.hostedSubdomain}.example.com` : ""
		),
		isDeploymentDisabled: vi.fn(() => false),
	};
});

function makeDeployment(overrides: Partial<DeployConfig> = {}): DeployConfig {
	return {
		id: "dep-1",
		repoName: "repo",
		repoUrl: "https://github.com/acme/repo",
		branch: "main",
		serviceName: "web",
		status: "running",
		hostedSubdomain: "web",
		commitSha: null,
		envVars: null,
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
	} as DeployConfig;
}

describe("DeployOverview", () => {
	it("falls back to didnt_deploy when running has no stored live URL", () => {
		render(<DeployOverview deployment={makeDeployment({ hostedSubdomain: null, screenshotUrl: "" })} />);
		expect(screen.getByText("didnt_deploy")).toBeInTheDocument();
		expect(screen.getByText("No live URL yet. Deploy to generate a preview snapshot.")).toBeInTheDocument();
	});

	it("treats stale didnt_deploy rows with preview evidence as running", () => {
		render(
			<DeployOverview
				deployment={makeDeployment({
					status: "didnt_deploy",
					screenshotUrl: "https://cdn.example.com/shot.png",
				})}
			/>
		);
		expect(screen.getAllByText("running").length).toBeGreaterThan(0);
		expect(screen.getByRole("link", { name: /visit site/i })).toHaveAttribute("href", "https://web.example.com");
	});

	it("keeps draft deployments with only a custom domain in didnt_deploy", () => {
		const { container } = render(
			<DeployOverview
				deployment={makeDeployment({
					status: "didnt_deploy",
					hostedSubdomain: "preview",
					screenshotUrl: null,
				})}
			/>
		);

		expect(within(container).getAllByText("didnt_deploy").length).toBeGreaterThan(0);
		expect(within(container).queryByText("running")).not.toBeInTheDocument();
	});

	it("renders screenshot when screenshot_url exists", () => {
		const { container } = render(<DeployOverview deployment={makeDeployment({ screenshotUrl: "https://cdn.example.com/shot.png" })} />);
		expect(within(container).getAllByAltText("Screenshot of web").length).toBeGreaterThan(0);
	});

	it("shows endpoint links for hosted subdomain and ECS base URL", () => {
		render(
			<DeployOverview
				deployment={makeDeployment({
					status: "running",
					hostedSubdomain: "custom",
					cloudResources: {
						target: "ecs",
						region: "us-west-2",
						cluster: "default",
						service: "web",
						baseUrl: "https://alb.example.com",
					},
				})}
			/>
		);

		expect(screen.getByRole("link", { name: /custom\.smart-deploy\.xyz/i })).toHaveAttribute(
			"href",
			"https://custom.smart-deploy.xyz"
		);
		expect(screen.getByText("default/web")).toBeInTheDocument();
	});

	it("shows and triggers New Preview button when callback provided", () => {
		const onRefreshPreview = vi.fn();
		render(
			<DeployOverview
				deployment={makeDeployment()}
				onRefreshPreview={onRefreshPreview}
			/>
		);

		const btn = screen.getByRole("button", { name: /new preview/i });
		expect(btn).toBeInTheDocument();
		fireEvent.click(btn);
		expect(onRefreshPreview).toHaveBeenCalledTimes(1);
	});

	it("renders deployment controls in overview and triggers handlers", () => {
		const onPauseResumeDeployment = vi.fn();
		const onDeleteDeployment = vi.fn();

		render(
			<DeployOverview
				deployment={makeDeployment()}
				onPauseResumeDeployment={onPauseResumeDeployment}
				onDeleteDeployment={onDeleteDeployment}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: /pause deployment/i }));
		fireEvent.click(screen.getByRole("button", { name: /delete deployment/i }));

		expect(onPauseResumeDeployment).toHaveBeenCalledTimes(1);
		expect(onDeleteDeployment).toHaveBeenCalledTimes(1);
	});
});
