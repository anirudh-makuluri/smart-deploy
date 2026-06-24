import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DeployWorkspace from "@/components/DeployWorkspace";
import type { DeployConfig } from "@/app/types";
import { makeDeployment } from "../helpers/deployConfigFixture";

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
const removeDeployment = vi.fn();
const mockSendDeployConfig = vi.fn();
const mockControlDeployment = vi.fn();
const mockDeleteDeployment = vi.fn();
const mockFetchLatestCommit = vi.fn();

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

vi.mock("@/store/useAppData", () => {
	const useAppDataMock = (selector: (state: Record<string, unknown>) => unknown) => selector(appState);
	(useAppDataMock as typeof useAppDataMock & { getState: () => Record<string, unknown> }).getState = () => appState;
	return {
		useAppData: useAppDataMock,
	};
});

vi.mock("@/components/WorkerWebSocketProvider", () => ({
	useWorkerWebSocket: () => mockUseWorkerWebSocket(),
}));

vi.mock("@/components/ConfigTabs", () => ({
	default: () => <div>ConfigTabs</div>,
}));
vi.mock("@/components/DeploymentHistory", () => ({
	default: ({
		onRollback,
	}: {
		onRollback?: (entry: { id: string; commitSha?: string }) => void;
	}) => (
		<div>
			<div>DeploymentHistory</div>
			<button
				type="button"
				onClick={() => onRollback?.({ id: "hist-1", commitSha: "abcdef123456" })}
			>
				RollbackEntry
			</button>
		</div>
	),
}));
vi.mock("@/components/deploy-workspace/DeployWorkspaceMenu", () => ({
	default: ({ onChange }: { onChange?: (section: string) => void }) => (
		<div>
			<div>DeployWorkspaceMenu</div>
			<button type="button" onClick={() => onChange?.("history")}>OpenHistory</button>
		</div>
	),
}));
vi.mock("@/components/deploy-workspace/DeployOverview", () => ({
	default: ({
		onPauseResumeDeployment,
		onRedeploy,
		onDeleteDeployment,
	}: {
		onPauseResumeDeployment?: () => void;
		onRedeploy?: () => void;
		onDeleteDeployment?: () => void;
	}) => (
		<div>
			<div>DeployOverview</div>
			<button type="button" onClick={onPauseResumeDeployment}>PauseResume</button>
			<button type="button" onClick={() => onRedeploy?.()}>Redeploy</button>
			<button type="button" onClick={() => onDeleteDeployment?.()}>DeleteDeployment</button>
		</div>
	),
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
	ConfirmDialog: ({
		open,
		onConfirm,
		confirmText,
	}: {
		open?: boolean;
		onConfirm?: () => void;
		confirmText?: string;
	}) =>
		open ? (
			<button type="button" onClick={onConfirm}>
				{confirmText || "Confirm"}
			</button>
		) : null,
}));

vi.mock("@/lib/graphqlClient", () => ({
	controlDeployment: (...args: unknown[]) => mockControlDeployment(...args),
	deleteDeployment: (...args: unknown[]) => mockDeleteDeployment(...args),
	fetchLatestCommit: (...args: unknown[]) => mockFetchLatestCommit(...args),
	prefillInfra: vi.fn(),
}));

const baseDeployment: DeployConfig = makeDeployment({
	id: "dep-1",
	repoName: "smart-deploy",
	repoUrl: "https://github.com/acme/smart-deploy",
	serviceName: "web",
	status: "running",
});

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
		cleanup();
		vi.clearAllMocks();
		mockUseSession.mockReturnValue({ data: { user: { name: "A", id: "u-1" } } });
		mockUseWorkerWebSocket.mockReturnValue({
			steps: [],
			sendDeployConfig: mockSendDeployConfig,
			deployConfigRef: { current: null },
			deployStatus: "not-started",
			deployError: null,
			serviceLogs: [],
			deployLogEntries: [],
			setOnDeployFinished: vi.fn(),
		});
		mockFetchLatestCommit.mockResolvedValue(null);
		mockControlDeployment.mockResolvedValue({ ok: true });
		mockDeleteDeployment.mockResolvedValue(undefined);
		removeDeployment.mockImplementation((repoName: string, serviceName: string) => {
			const deployments = ((appState.deployments as DeployConfig[] | undefined) ?? []);
			appState = {
				...appState,
				deployments: deployments.filter(
					(dep) => dep.repoName !== repoName || dep.serviceName !== serviceName
				),
			};
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
			removeDeployment,
			repoRecords: [],
			repoServices: [],
		};
		global.fetch = vi.fn(async (input: RequestInfo | URL) => {
			if (typeof input === "string" && input === "/api/github/access-token") {
				return {
					ok: true,
					json: async () => ({ token: "gh-token" }),
				} as Response;
			}

			return {
				ok: true,
				json: async () => ({ status: "success", history: [] }),
			} as Response;
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
			deployments: [{ ...baseDeployment, hostedSubdomain: "web" }],
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
			deployments: [{ ...baseDeployment, hostedSubdomain: "web" }],
		};

		renderWithQueryClient(<DeployWorkspace />);

		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/deployment-preview-screenshot",
				expect.objectContaining({ method: "POST" })
			)
		);
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
							hosted_subdomain: "web",
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
					hostedSubdomain: "web",
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

	it("restores the deployment to running when a failed attempt reports a rolled-back final status", async () => {
		mockUseWorkerWebSocket.mockReturnValue({
			steps: [],
			sendDeployConfig: mockSendDeployConfig,
			deployConfigRef: { current: null },
			deployStatus: "error",
			deployError: "Verification failed",
			serviceLogs: [],
			deployLogEntries: [],
			setOnDeployFinished: vi.fn((handler) => {
				if (handler) {
					queueMicrotask(() => {
						handler({
							success: false,
							error: "Deployment verification failed. Rolled back automatically to abc1234.",
							finalStatus: "running",
							hosted_subdomain: "restored",
						});
					});
				}
			}),
		});

		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [{ ...baseDeployment, hostedSubdomain: "previous" }],
		};

		renderWithQueryClient(<DeployWorkspace />);

		await waitFor(() => {
			expect(updateDeploymentById).toHaveBeenCalledWith(
				expect.objectContaining({
					repoName: "smart-deploy",
					serviceName: "web",
					status: "running",
					hostedSubdomain: "restored",
				})
			);
		});
		expect(mockToastError).toHaveBeenCalled();
	});

	it("uses the effective running status when redeploying a stale draft row with live evidence", async () => {
		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy", owner: { login: "acme" } },
			activeServiceName: "web",
			deployments: [{
				...baseDeployment,
				status: "didnt_deploy",
				hostedSubdomain: "web",
				screenshotUrl: "https://cdn.example.com/shot.png",
				scanResults: { dockerfiles: { Dockerfile: "FROM node:20" }, nginx_conf: "events {}" },
			}],
		};

		const view = renderWithQueryClient(<DeployWorkspace />);

		fireEvent.click(within(view.container).getByText("Redeploy"));

		await waitFor(() => {
			expect(updateDeploymentById).toHaveBeenCalledWith(
				expect.objectContaining({
					repoName: "smart-deploy",
					serviceName: "web",
					status: "deploying",
				})
			);
		});
		expect(mockSendDeployConfig).toHaveBeenCalled();
	});

	it("allows pause/resume actions from the effective running status", async () => {
		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [{
				...baseDeployment,
				status: "didnt_deploy",
				hostedSubdomain: "web",
				screenshotUrl: "https://cdn.example.com/shot.png",
			}],
		};

		const view = renderWithQueryClient(<DeployWorkspace />);

		fireEvent.click(within(view.container).getByText("PauseResume"));
		fireEvent.click(screen.getByRole("button", { name: "Pause Deployment" }));

		await waitFor(() => {
			expect(mockControlDeployment).toHaveBeenCalledWith("pause", "smart-deploy", "web");
		});
		await waitFor(() => {
			expect(updateDeploymentById).toHaveBeenCalledWith(
				expect.objectContaining({
					repoName: "smart-deploy",
					serviceName: "web",
					status: "paused",
				})
			);
		});
	});

	it("starts a rollback from deployment history and opens logs", async () => {
		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [{
				...baseDeployment,
				status: "running",
				hostedSubdomain: "web",
				screenshotUrl: "https://cdn.example.com/shot.png",
			}],
		};

		const view = renderWithQueryClient(<DeployWorkspace />);
		fireEvent.click(within(view.container).getByText("OpenHistory"));
		fireEvent.click(screen.getByText("RollbackEntry"));
		fireEvent.click(screen.getByRole("button", { name: "Rollback Release" }));

		await waitFor(() => {
			expect(updateDeploymentById).toHaveBeenCalledWith(
				expect.objectContaining({
					repoName: "smart-deploy",
					serviceName: "web",
					status: "deploying",
					commitSha: "abcdef123456",
				})
			);
		});
		expect(mockSendDeployConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				repoName: "smart-deploy",
				serviceName: "web",
				commitSha: "abcdef123456",
				status: "deploying",
			}),
			"gh-token",
			"u-1"
		);
	});

	it("restores a draft with a generated hosted subdomain after delete", async () => {
		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [{
				...baseDeployment,
				hostedSubdomain: "current-subdomain",
				scanResults: { dockerfiles: { Dockerfile: "FROM node:20" }, nginx_conf: "events {}" },
			}],
		};

		const view = renderWithQueryClient(<DeployWorkspace />);

		fireEvent.click(within(view.container).getByText("DeleteDeployment"));
		fireEvent.click(screen.getByRole("button", { name: "Delete Deployment" }));

		await waitFor(() => {
			expect(mockDeleteDeployment).toHaveBeenCalledWith("smart-deploy", "web");
		});
		await waitFor(() => {
			expect(updateDeploymentById).toHaveBeenCalledWith(
				expect.objectContaining({
					repoName: "smart-deploy",
					serviceName: "web",
					status: "didnt_deploy",
					hostedSubdomain: expect.stringMatching(/^smart-deploy[a-z0-9]{5}$/),
				})
			);
		});
	});
});
