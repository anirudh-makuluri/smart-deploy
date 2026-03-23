import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
		getDeploymentDisplayUrl: vi.fn((deployment: DeployConfig) => deployment.custom_url || deployment.deployUrl || ""),
		isDeploymentDisabled: vi.fn(() => false),
	};
});

function makeDeployment(overrides: Partial<DeployConfig> = {}): DeployConfig {
	return {
		id: "dep-1",
		repo_name: "repo",
		url: "https://github.com/acme/repo",
		branch: "main",
		service_name: "web",
		status: "running",
		deployUrl: "https://web.example.com",
		...overrides,
	};
}

describe("DeployOverview", () => {
	it("falls back to didnt_deploy when running has no stored live URL", () => {
		render(<DeployOverview deployment={makeDeployment({ deployUrl: "", custom_url: "" })} />);
		expect(screen.getByText("didnt_deploy")).toBeInTheDocument();
		expect(screen.getByText("No live URL yet. Deploy to generate a preview snapshot.")).toBeInTheDocument();
	});

	it("renders screenshot when screenshot_url exists", () => {
		render(<DeployOverview deployment={makeDeployment({ screenshot_url: "https://cdn.example.com/shot.png" })} />);
		const screenshot = screen.getByAltText("Screenshot of web");
		expect(screenshot).toBeInTheDocument();
	});

	it("shows endpoint links for custom URL and instance IP", () => {
		render(
			<DeployOverview
				deployment={makeDeployment({
					custom_url: "https://custom.example.com",
					ec2: {
						success: true,
						baseUrl: "http://8.8.8.8",
						instanceId: "i-123",
						publicIp: "8.8.8.8",
						vpcId: "vpc-123",
						subnetId: "subnet-123",
						securityGroupId: "sg-123",
						amiId: "ami-123",
					},
				})}
			/>
		);

		expect(screen.getByText("Custom URL")).toBeInTheDocument();
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
});
