import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DeployWorkspace from "@/components/DeployWorkspace";
import type { DeployConfig } from "@/app/types";

const mockUseSession = vi.fn();
const mockUseWorkerWebSocket = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastInfo = vi.fn();
const mockToastError = vi.fn();
const fetchRepoDeployments = vi.fn();
const updateDeploymentById = vi.fn();
const getDetectedRepoCache = vi.fn(() => undefined);
const setDetectedRepoCache = vi.fn();
const setActiveRepo = vi.fn();
const setActiveServiceName = vi.fn();

let appState: Record<string, unknown> = {};

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession: () => mockUseSession(),
	},
}));

vi.mock("sonner", () => ({
	toast: {
		success: (...args: unknown[]) => mockToastSuccess(...args),
		info: (...args: unknown[]) => mockToastInfo(...args),
		error: (...args: unknown[]) => mockToastError(...args),
	},
}));

vi.mock("@/store/useAppData", () => ({
	useAppData: (selector: (state: Record<string, unknown>) => unknown) => selector(appState),
}));

vi.mock("@/components/WorkerWebSocketProvider", () => ({
	useWorkerWebSocket: () => mockUseWorkerWebSocket(),
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
	repoName: "smart-deploy",
	serviceName: "web",
	url: "https://github.com/acme/smart-deploy",
	branch: "main",
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
};

function renderWithQueryClient(ui: React.ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});

	return render(
		<QueryClientProvider client={queryClient}>
			{ui}
		</QueryClientProvider>
	);
}

describe("DeployWorkspace", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUseSession.mockReturnValue({ data: { user: { name: "A", id: "u-1" } } });
		mockUseWorkerWebSocket.mockReturnValue({
			steps: [],
			sendDeployConfig: vi.fn(),
			deployConfigRef: { current: null },
			deployStatus: "not-started",
			deployError: null,
			serviceLogs: [],
			deployLogEntries: [],
			setOnDeployFinished: vi.fn(),
		});
		updateDeploymentById.mockImplementation(async (partial: Partial<DeployConfig> & { repoName: string; serviceName: string }) => {
			const deployments = ((appState.deployments as DeployConfig[] | undefined) ?? []);
			const next = deployments.find(
				(dep) => dep.repoName === partial.repoName && dep.serviceName === partial.serviceName
			);
			const merged = { ...(next ?? {}), ...partial } as DeployConfig;
			appState = {
				...appState,
				deployments: next
					? deployments.map((dep) =>
						dep.repoName === partial.repoName && dep.serviceName === partial.serviceName ? merged : dep
					)
					: [...deployments, merged],
			};
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
		renderWithQueryClient(<DeployWorkspace />);
		expect(screen.getByText("Service not found")).toBeInTheDocument();
	});

	it("treats running without URL as draft setup mode", () => {
		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [baseDeployment],
		};
		renderWithQueryClient(<DeployWorkspace />);
		expect(screen.getByText("ConfigTabs")).toBeInTheDocument();
		expect(screen.queryByText("DeployOverview")).not.toBeInTheDocument();
	});

	it("opens overview first when the selected service already has a live deployment", async () => {
		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [{ ...baseDeployment, liveUrl: "https://web.example.com" }],
		};

		renderWithQueryClient(<DeployWorkspace />);

		await waitFor(() => {
			expect(screen.getByText("DeployOverview")).toBeInTheDocument();
		});
	});

	it("requests screenshot generation when running deployment has live URL and no screenshot", async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ status: "success", history: [] }),
			})
			.mockResolvedValue({
				ok: true,
				json: async () => ({ status: "success", screenshotUrl: "https://cdn.example.com/new.png" }),
			});
		global.fetch = fetchMock as unknown as typeof fetch;

		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [{ ...baseDeployment, liveUrl: "https://web.example.com" }],
		};

		renderWithQueryClient(<DeployWorkspace />);

		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/deployment-preview-screenshot",
				expect.objectContaining({ method: "POST" })
			)
		);
		await waitFor(() => {
			expect(updateDeploymentById).toHaveBeenCalledWith(
				expect.objectContaining({
					repoName: "smart-deploy",
					serviceName: "web",
					screenshotUrl: "https://cdn.example.com/new.png",
				})
			);
		});
		expect(fetchRepoDeployments).toHaveBeenCalledWith("acme/smart-deploy");
	});

	it("updates the workspace immediately after a successful deploy completes", async () => {
		mockUseWorkerWebSocket.mockReturnValue({
			steps: [],
			sendDeployConfig: vi.fn(),
			deployConfigRef: { current: null },
			deployStatus: "success",
			deployError: null,
			serviceLogs: [],
			deployLogEntries: [],
			setOnDeployFinished: vi.fn((handler) => {
				if (handler) {
					queueMicrotask(() => {
						handler({
							success: true,
							deployUrl: "https://web.example.com",
						});
					});
				}
			}),
		});

		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [baseDeployment],
		};

		renderWithQueryClient(<DeployWorkspace />);

		await waitFor(() => {
			expect(updateDeploymentById).toHaveBeenCalledWith(
				expect.objectContaining({
					repoName: "smart-deploy",
					serviceName: "web",
					status: "running",
					liveUrl: "https://web.example.com",
				})
			);
		});
		expect(document.title).toContain("Deployment succeeded");
	});

	it("marks deployment failed when deploy completes with error even without EC2 metadata", async () => {
		mockUseWorkerWebSocket.mockReturnValue({
			steps: [],
			sendDeployConfig: vi.fn(),
			deployConfigRef: { current: null },
			deployStatus: "error",
			deployError: "Build failed",
			serviceLogs: [],
			deployLogEntries: [],
			setOnDeployFinished: vi.fn((handler) => {
				if (handler) {
					queueMicrotask(() => {
						handler({
							success: false,
							error: "Build failed",
						});
					});
				}
			}),
		});

		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [baseDeployment],
		};

		renderWithQueryClient(<DeployWorkspace />);

		await waitFor(() => {
			expect(updateDeploymentById).toHaveBeenCalledWith(
				expect.objectContaining({
					repoName: "smart-deploy",
					serviceName: "web",
					status: "failed",
				})
			);
		});
		expect(fetchRepoDeployments).toHaveBeenCalledWith("acme/smart-deploy");
		expect(mockToastError).toHaveBeenCalled();
	});
});
