import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DeployWorkspaceActiveSection from "@/components/deploy-workspace/DeployWorkspaceActiveSection";
import type { DeployConfig, repoType } from "@/app/types";
import { makeDeployment } from "../helpers/deployConfigFixture";

vi.mock("@/components/ConfigTabs", () => ({
	default: () => <div data-testid="setup-section">ConfigTabs</div>,
}));

vi.mock("@/components/DeploymentHistory", () => ({
	default: () => <div data-testid="history-section">DeploymentHistory</div>,
}));

vi.mock("@/components/deploy-workspace/DeployOverview", () => ({
	default: () => <div data-testid="overview-section">DeployOverview</div>,
}));

vi.mock("@/components/deploy-workspace/DeployLogsView", () => ({
	default: () => <div data-testid="logs-section">DeployLogsView</div>,
}));

vi.mock("@/components/blueprint/BlueprintView", () => ({
	default: () => <div data-testid="blueprint-section">BlueprintView</div>,
}));

vi.mock("@/components/ScanProgress", () => ({
	default: () => <div data-testid="scan-progress-section">ScanProgress</div>,
}));

vi.mock("@/components/FeedbackProgress", () => ({
	default: () => <div data-testid="feedback-progress-section">FeedbackProgress</div>,
}));

vi.mock("@/components/SdArtifactsScanResults", () => ({
	default: () => <div data-testid="scan-results-section">SdArtifactsScanResults</div>,
}));

const repoRecord: repoType = {
	id: "repo-1",
	name: "smart-deploy",
	full_name: "acme/smart-deploy",
	html_url: "https://github.com/acme/smart-deploy",
	language: "TypeScript",
	languages_url: "https://api.github.com/repos/acme/smart-deploy/languages",
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
	pushed_at: "2026-01-01T00:00:00Z",
	default_branch: "main",
	private: false,
	visibility: "public",
	owner: {
		login: "acme",
	},
	latest_commit: null,
	branches: [
		{
			name: "main",
			commit_sha: "abc123",
			protected: true,
		},
	],
};

function makeProps(overrides: Partial<React.ComponentProps<typeof DeployWorkspaceActiveSection>> = {}): React.ComponentProps<typeof DeployWorkspaceActiveSection> {
	const deployment: DeployConfig = makeDeployment({
		repoName: "smart-deploy",
		serviceName: "web",
		status: "running",
	});

	return {
		activeSection: "overview",
		improveScanPayload: null,
		scanMode: "idle",
		repoUrl: "https://github.com/acme/smart-deploy",
		analyzeServicePath: ".",
		effectiveBranch: "main",
		repoName: "smart-deploy",
		serviceName: "web",
		onScanComplete: vi.fn(),
		onScanProgressComplete: vi.fn(),
		onScanCancel: vi.fn(),
		onImproveScanComplete: vi.fn(async () => {}),
		onImproveScanCancel: vi.fn(),
		hasScanResults: false,
		effectiveScanResults: null,
		scanDuration: 0,
		deployment,
		onStartDeployment: vi.fn(),
		onRejectScan: vi.fn(),
		onStartImproveScan: vi.fn(),
		onStartScan: vi.fn(),
		deploymentHistory: null,
		historyTotal: 0,
		isLoadingHistory: false,
		onRollbackEntrySelect: vi.fn(),
		rollbackingEntryId: null,
		effectiveDeploymentStatus: "running",
		repoRecord,
		repoIdentifier: "acme/smart-deploy",
		currentServiceName: "web",
		onConfigChange: vi.fn(),
		onPersistScanResults: vi.fn(async () => {}),
		showDeployLogs: false,
		deployLogEntries: [],
		serviceLogs: [],
		effectiveDeployStatus: "not-started",
		deployError: null,
		latestDeploymentRunId: null,
		deployingCommitInfo: null,
		liveDeployConfig: null,
		isDeploying: false,
		isRefreshingPreview: false,
		onRedeploy: vi.fn(),
		onRefreshPreview: vi.fn(),
		onEditConfiguration: vi.fn(),
		onOpenScanSection: vi.fn(),
		onPauseResumeDeployment: vi.fn(),
		onDeleteDeployment: vi.fn(),
		isChangingDeploymentState: false,
		activeRepo: repoRecord,
		deployDisabled: false,
		deployDisabledMessage: "",
		...overrides,
	};
}

describe("DeployWorkspaceActiveSection", () => {
	it("keeps sections mounted and only unhides the active one", () => {
		const { rerender } = render(<DeployWorkspaceActiveSection {...makeProps({ activeSection: "overview" })} />);

		const overview = screen.getByTestId("overview-section");
		const setup = screen.getByTestId("setup-section");

		expect(overview).toBeVisible();
		expect(setup).not.toBeVisible();

		rerender(<DeployWorkspaceActiveSection {...makeProps({ activeSection: "setup" })} />);

		expect(screen.getByTestId("overview-section")).not.toBeVisible();
		expect(screen.getByTestId("setup-section")).toBeVisible();
	});
});
