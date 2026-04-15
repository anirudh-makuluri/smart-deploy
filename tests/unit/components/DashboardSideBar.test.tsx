import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardSideBar from "@/components/DashboardSideBar";

const mockUseSession = vi.fn();

let appState: Record<string, unknown> = {};

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession: () => mockUseSession(),
	},
}));

vi.mock("@/store/useAppData", () => ({
	useAppData: () => appState,
}));

describe("DashboardSideBar", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUseSession.mockReturnValue({
			data: { user: { name: "Anirudh" } },
		});
		appState = {
			repoList: [{ id: 1 }, { id: 2 }, { id: 3 }],
			deployments: [
				{ id: "1", status: "running", liveUrl: "https://repo-one.example.com", serviceName: "web", repoName: "repo1", url: "", branch: "", commitSha: null, envVars: null, screenshotUrl: null, firstDeployment: null, lastDeployment: null, revision: null, cloudProvider: "aws", deploymentTarget: "ec2", awsRegion: "", ec2: null, cloudRun: null, scanResults: {} },
				{ id: "2", status: "failed", liveUrl: null, serviceName: "web", repoName: "repo2", url: "", branch: "", commitSha: null, envVars: null, screenshotUrl: null, firstDeployment: null, lastDeployment: null, revision: null, cloudProvider: "aws", deploymentTarget: "ec2", awsRegion: "", ec2: null, cloudRun: null, scanResults: {} },
				{ id: "3", status: "didnt_deploy", liveUrl: null, serviceName: "web", repoName: "repo3", url: "", branch: "", commitSha: null, envVars: null, screenshotUrl: null, firstDeployment: null, lastDeployment: null, revision: null, cloudProvider: "aws", deploymentTarget: "ec2", awsRegion: "", ec2: null, cloudRun: null, scanResults: {} },
				{ id: "4", status: "paused", liveUrl: null, serviceName: "web", repoName: "repo4", url: "", branch: "", commitSha: null, envVars: null, screenshotUrl: null, firstDeployment: null, lastDeployment: null, revision: null, cloudProvider: "aws", deploymentTarget: "ec2", awsRegion: "", ec2: null, cloudRun: null, scanResults: {} },
			],
		};
	});

	it("renders navigation and workspace stats", () => {
		render(<DashboardSideBar activeView="overview" onViewChange={vi.fn()} />);

		expect(screen.getByText("Deployments")).toBeInTheDocument();
		expect(screen.getByText("History")).toBeInTheDocument();
		expect(screen.getByText("Repositories")).toBeInTheDocument();
		expect(screen.getByText("Workspace Stats")).toBeInTheDocument();
		expect(screen.getByText("Repos")).toBeInTheDocument();
		expect(screen.getByText("Active")).toBeInTheDocument();
		expect(screen.getByText("Issues")).toBeInTheDocument();

		// repos=3, active=1, issues=2 for this fixture
		expect(screen.getByText("3")).toBeInTheDocument();
		expect(screen.getByText("1")).toBeInTheDocument();
		// issues = failed + paused
		expect(screen.getByText("2")).toBeInTheDocument();
	});

	it("calls onViewChange when nav buttons are clicked", () => {
		const onViewChange = vi.fn();
		const { container } = render(<DashboardSideBar activeView="overview" onViewChange={onViewChange} />);
		const aside = container.querySelector("aside");
		if (!aside) throw new Error("Sidebar not rendered");

		fireEvent.click(within(aside).getByRole("button", { name: "Deployments" }));
		fireEvent.click(within(aside).getByRole("button", { name: "History" }));
		fireEvent.click(within(aside).getByRole("button", { name: "Repositories" }));

		expect(onViewChange).toHaveBeenCalledWith("overview");
		expect(onViewChange).toHaveBeenCalledWith("deployments");
		expect(onViewChange).toHaveBeenCalledWith("repositories");
	});
});
