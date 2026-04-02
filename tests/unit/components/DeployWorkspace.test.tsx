import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import DeployWorkspace from "@/components/DeployWorkspace";
import type { DeployConfig } from "@/app/types";

const mockUseSession = vi.fn();
const mockUseDeployLogs = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastInfo = vi.fn();
const fetchRepoDeployments = vi.fn();
const updateDeploymentById = vi.fn();
const getDetectedRepoCache = vi.fn(() => undefined);
const setDetectedRepoCache = vi.fn();
const setActiveRepo = vi.fn();
const setActiveServiceName = vi.fn();

let appState: Record<string, unknown> = {};

vi.mock("next-auth/react", () => ({
	useSession: () => mockUseSession(),
}));

vi.mock("sonner", () => ({
	toast: {
		success: (...args: unknown[]) => mockToastSuccess(...args),
		info: (...args: unknown[]) => mockToastInfo(...args),
	},
}));

vi.mock("@/store/useAppData", () => ({
	useAppData: (selector: (state: Record<string, unknown>) => unknown) => selector(appState),
}));

vi.mock("@/custom-hooks/useDeployLogs", () => ({
	useDeployLogs: () => mockUseDeployLogs(),
}));

vi.mock("@/components/ConfigTabs", () => ({
	default: () => <div>ConfigTabs</div>,
}));
vi.mock("@/components/DeploymentHistory", () => ({
	default: () => <div>DeploymentHistory</div>,
}));
vi.mock("@/components/deploy-workspace/DeployWorkspaceMenu", () => ({
	default: () => <div>DeployWorkspaceMenu</div>,
}));
vi.mock("@/components/deploy-workspace/DeployOverview", () => ({
	default: () => <div>DeployOverview</div>,
}));
vi.mock("@/components/deploy-workspace/DeployLogsView", () => ({
	default: () => <div>DeployLogsView</div>,
}));
vi.mock("@/components/ScanProgress", () => ({
	default: () => <div>ScanProgress</div>,
}));
vi.mock("@/components/FeedbackProgress", () => ({
	default: () => <div>FeedbackProgress</div>,
}));
vi.mock("@/components/PostScanResults", () => ({
	default: () => <div>PostScanResults</div>,
}));
vi.mock("@/components/ConfirmDialog", () => ({
	ConfirmDialog: () => <div>ConfirmDialog</div>,
}));

const baseDeployment: DeployConfig = {
	id: "dep-1",
	repo_name: "smart-deploy",
	service_name: "web",
	url: "https://github.com/acme/smart-deploy",
	branch: "main",
	status: "running",
};

describe("DeployWorkspace", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUseSession.mockReturnValue({ data: { user: { name: "A" }, accessToken: "token", userID: "u-1" } });
		mockUseDeployLogs.mockReturnValue({
			steps: [],
			sendDeployConfig: vi.fn(),
			deployConfigRef: { current: null },
			deployStatus: "not-started",
			deployError: null,
			serviceLogs: [],
			deployLogEntries: [],
		});
		appState = {
			deployments: [],
			updateDeploymentById,
			activeRepo: null,
			activeServiceName: null,
			isLoading: false,
			fetchRepoDeployments,
			getDetectedRepoCache,
			setDetectedRepoCache,
			setActiveRepo,
			setActiveServiceName,
			repoServices: [],
		};
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ status: "success", history: [] }),
		}) as unknown as typeof fetch;
	});

	it("shows service-not-found state when no active repo", () => {
		render(<DeployWorkspace />);
		expect(screen.getByText("Service not found")).toBeInTheDocument();
	});

	it("treats running without URL as draft setup mode", () => {
		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [baseDeployment],
		};
		render(<DeployWorkspace />);
		expect(screen.getByText("ConfigTabs")).toBeInTheDocument();
		expect(screen.queryByText("DeployOverview")).not.toBeInTheDocument();
	});

	it("requests screenshot generation when running deployment has live URL and no screenshot", async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ status: "success", history: [] }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ status: "success", screenshotUrl: "https://cdn.example.com/new.png" }),
			});
		global.fetch = fetchMock as unknown as typeof fetch;

		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [{ ...baseDeployment, deployUrl: "https://web.example.com" }],
		};

		render(<DeployWorkspace />);

		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/deployment-preview-screenshot",
				expect.objectContaining({ method: "POST" })
			)
		);
		expect(fetchRepoDeployments).toHaveBeenCalledWith("smart-deploy");
	});
});
