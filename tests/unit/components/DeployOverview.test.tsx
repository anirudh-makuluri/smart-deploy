import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DeployOverview from "@/components/deploy-workspace/DeployOverview";
import type { DeployConfig } from "@/app/types";

vi.mock("@/components/DeployOptions", () => ({
	default: () => <div data-testid="deploy-options">Deploy Options</div>,
}));

vi.mock("@/lib/aws/ec2InstanceTypes", () => ({
	DEFAULT_EC2_INSTANCE_TYPE: "t3.micro",
	formatApproxEc2PriceCompact: vi.fn(() => "$0.0104/hr"),
}));

vi.mock("@/lib/utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/utils")>();
	return {
		...actual,
		formatTimestamp: vi.fn(() => "formatted-time"),
		formatDeploymentTargetName: vi.fn(() => "EC2"),
		getDeploymentDisplayUrl: vi.fn((deployment: DeployConfig) => deployment.liveUrl || ""),
		isDeploymentDisabled: vi.fn(() => false),
	};
});

function makeDeployment(overrides: Partial<DeployConfig> = {}): DeployConfig {
	return {
		id: "dep-1",
		repoName: "repo",
		url: "https://github.com/acme/repo",
		branch: "main",
		serviceName: "web",
		status: "running",
		liveUrl: "https://web.example.com",
		commitSha: null,
		envVars: null,
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

describe("DeployOverview", () => {
	it("falls back to didnt_deploy when running has no stored live URL", () => {
		render(<DeployOverview deployment={makeDeployment({ liveUrl: "", screenshotUrl: "" })} />);
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
					liveUrl: "https://preview.example.com",
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

	it("shows endpoint links for custom URL and instance IP", () => {
		render(
			<DeployOverview
				deployment={makeDeployment({
					liveUrl: "https://custom.example.com",
					ec2: {
						success: true,
						baseUrl: "http://8.8.8.8",
						instanceId: "i-123",
						publicIp: "8.8.8.8",
						vpcId: "vpc-123",
						subnetId: "subnet-123",
						securityGroupId: "sg-123",
						amiId: "ami-123",
						sharedAlbDns: "alb.example.com",
						instanceType: "t3.micro",
					},
				})}
			/>
		);

		expect(screen.getByRole("link", { name: /custom\.example\.com/i })).toHaveAttribute(
			"href",
			"https://custom.example.com"
		);
		expect(screen.getByRole("link", { name: /8\.8\.8\.8/i })).toHaveAttribute("href", "http://8.8.8.8");
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
