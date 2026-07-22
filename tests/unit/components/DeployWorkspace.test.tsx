import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DeployWorkspace from "@/components/DeployWorkspace";
import type { DeployConfig } from "@/app/types";
import { hostedUrlFromSubdomain } from "@/lib/hostedUrl";
import { makeDeployment } from "../helpers/deployConfigFixture";

const mockUseSession = vi.fn();
const mockUseWorkerWebSocket = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastInfo = vi.fn();
const mockToastError = vi.fn();
const mockToastDismiss = vi.fn();
const fetchRepoDeployments = vi.fn();
const updateDeploymentById = vi.fn();
const getDetectedRepoCache = vi.fn(() => undefined);
const setDetectedRepoCache = vi.fn();
const setActiveRepo = vi.fn();
const setActiveServiceName = vi.fn();
const removeDeployment = vi.fn();
const mockSendDeployConfig = vi.fn();
const mockClearDeploymentLogs = vi.fn();
const mockControlDeployment = vi.fn();
const mockDeleteDeployment = vi.fn();
const mockFetchLatestCommit = vi.fn();
const mockSaveDeploymentAnalysis = vi.fn();

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
		dismiss: (...args: unknown[]) => mockToastDismiss(...args),
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
			<button type="button" onClick={() => onChange?.("scan")}>OpenScan</button>
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
	default: ({
		onComplete,
	}: {
		onComplete?: (data: {
			response_id: string;
			commit_sha: string;
			package_path: string;
			deploy_shape: "server";
			build_status: "passed";
			railpack_version: string;
			workflow_version: string;
			deploy_briefing: string;
			deploy_units: [];
			remote_builds: Record<string, never>;
			build_verification: Record<string, never>;
			repair_history: [];
			pipeline_trace: [];
			errors: [];
			llm_outputs: Record<string, never>;
			inputs_snapshot: Record<string, never>;
			token_usage: { input_tokens: number; output_tokens: number; total_tokens: number };
		}) => void;
	}) => (
		<div>
			<div>ScanProgress</div>
			<button
				type="button"
				onClick={() =>
					onComplete?.({
						response_id: "resp-new",
						commit_sha: "abcdef123456",
						package_path: ".",
						deploy_shape: "server",
						build_status: "passed",
						railpack_version: "0.1.0",
						workflow_version: "1",
						deploy_briefing: "API service",
						deploy_units: [],
						remote_builds: {},
						build_verification: {},
						repair_history: [],
						pipeline_trace: [],
						errors: [],
						llm_outputs: {},
						inputs_snapshot: {},
						token_usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
					})
				}
			>
				FinishScan
			</button>
		</div>
	),
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
	saveDeploymentAnalysis: (...args: unknown[]) => mockSaveDeploymentAnalysis(...args),
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
			clearDeploymentLogs: mockClearDeploymentLogs,
			deployConfigRef: { current: null },
			deployStatus: "not-started",
			deployError: null,
			deployCompleteEvent: null,
			serviceLogs: [],
			deployLogEntries: [],
		});
		mockFetchLatestCommit.mockResolvedValue(null);
		mockControlDeployment.mockResolvedValue({ ok: true });
		mockDeleteDeployment.mockResolvedValue(undefined);
		mockSaveDeploymentAnalysis.mockResolvedValue({ responseId: "resp-new" });
		removeDeployment.mockImplementation((repoName: string, serviceName: string) => {
			const deployments = ((appState.deployments as DeployConfig[] | undefined) ?? []);
			appState = {
				...appState,
				deployments: deployments.filter(
					(dep) => dep.repoName !== repoName || dep.serviceName !== serviceName
				),
			};
		});
		const mergeDeployments = vi.fn((incoming: DeployConfig[]) => {
			const deployments = ((appState.deployments as DeployConfig[] | undefined) ?? []);
			const next = [...deployments];
			for (const deployment of incoming) {
				const index = next.findIndex(
					(dep) => dep.repoName === deployment.repoName && dep.serviceName === deployment.serviceName
				);
				if (index === -1) next.push(deployment);
				else next[index] = deployment;
			}
			appState = {
				...appState,
				deployments: next,
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
			mergeDeployments,
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
		expect(screen.getByText("ConfigTabs").closest("[hidden]")).toBeNull();
		expect(screen.getByText("DeployOverview").closest("[hidden]")).not.toBeNull();
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
			deployCompleteEvent: {
				payload: {
					success: true,
					hosted_subdomain: "web",
					deploymentTarget: "ecs",
					finalStatus: "running",
					cloudResources: null,
					rolledBack: false,
				},
				receivedAt: Date.now(),
			},
			serviceLogs: [],
			deployLogEntries: [],
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

	it("does not replay the deployment success toast when the workspace remounts", async () => {
		mockUseWorkerWebSocket.mockReturnValue({
			steps: [],
			sendDeployConfig: vi.fn(),
			deployConfigRef: { current: null },
			deployStatus: "success",
			deployError: null,
			deployCompleteEvent: {
				payload: {
					success: true,
					hosted_subdomain: "web",
					deploymentTarget: "ecs",
					finalStatus: "running",
					cloudResources: null,
					rolledBack: false,
				},
				receivedAt: 1_717_000_000_000,
			},
			serviceLogs: [],
			deployLogEntries: [],
		});

		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [baseDeployment],
		};

		const firstView = renderWithQueryClient(<DeployWorkspace />);

		await waitFor(() => {
			expect(mockToastSuccess).toHaveBeenCalledWith(
				"Deployment successful",
				expect.objectContaining({
					description: `Live at ${hostedUrlFromSubdomain("web")}`,
				})
			);
		});

		firstView.unmount();
		renderWithQueryClient(<DeployWorkspace />);

		await waitFor(() => {
			expect(mockToastSuccess).toHaveBeenCalledTimes(1);
		});
	});

	it("dismisses and does not replay a completion toast after switching workspaces", async () => {
		mockUseWorkerWebSocket.mockReturnValue({
			steps: [],
			sendDeployConfig: vi.fn(),
			deployConfigRef: { current: null },
			deployStatus: "success",
			deployError: null,
			deployCompleteEvent: {
				payload: {
					success: true,
					hosted_subdomain: "web",
					deploymentTarget: "ecs",
					finalStatus: "running",
					cloudResources: null,
					rolledBack: false,
				},
				receivedAt: 1_718_000_000_000,
			},
			serviceLogs: [],
			deployLogEntries: [],
		});

		appState = {
			...appState,
			activeRepo: { name: "lexiguess-next", default_branch: "main", full_name: "acme/lexiguess-next", html_url: "https://github.com/acme/lexiguess-next" },
			activeServiceName: "web",
			deployments: [{ ...baseDeployment, repoName: "lexiguess-next" }],
		};

		const view = renderWithQueryClient(<DeployWorkspace />);

		await waitFor(() => {
			expect(mockToastSuccess).toHaveBeenCalledTimes(1);
		});

		appState = {
			...appState,
			activeRepo: { name: "Pluto", default_branch: "main", full_name: "acme/Pluto", html_url: "https://github.com/acme/Pluto" },
			activeServiceName: "server-node",
			deployments: [makeDeployment({ repoName: "Pluto", serviceName: "server-node" })],
		};
		view.rerender(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<DeployWorkspace />
			</QueryClientProvider>
		);

		await waitFor(() => {
			expect(mockToastDismiss).toHaveBeenCalledWith("deployment-complete:lexiguess-next:web");
			expect(mockToastSuccess).toHaveBeenCalledTimes(1);
		});
	});

	it("stores the saved responseId locally after smart analysis completes", async () => {
		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [{ ...baseDeployment, status: "didnt_deploy", responseId: null, scanResults: {} }],
		};

		const view = renderWithQueryClient(<DeployWorkspace />);

		fireEvent.click(within(view.container).getByText("OpenScan"));
		const startAnalysisButton = screen
			.getAllByText("Start Smart Analysis")
			.find((element) => !element.closest("[hidden]"));
		expect(startAnalysisButton).toBeDefined();
		fireEvent.click(startAnalysisButton!);
		fireEvent.click(screen.getByText("FinishScan"));

		await waitFor(() => {
			expect(mockSaveDeploymentAnalysis).toHaveBeenCalledWith(
				expect.objectContaining({
					repoName: "smart-deploy",
					serviceName: "web",
					responseId: "resp-new",
				})
			);
		});

		await waitFor(() => {
			const deployment = (appState.deployments as DeployConfig[])[0];
			expect(deployment?.responseId).toBe("resp-new");
			expect(deployment?.scanResults).toEqual(
				expect.objectContaining({
					response_id: "resp-new",
				})
			);
		});
	});

	it("marks deployment failed when deploy completes with error even without EC2 metadata", async () => {
		mockUseWorkerWebSocket.mockReturnValue({
			steps: [],
			sendDeployConfig: vi.fn(),
			deployConfigRef: { current: null },
			deployStatus: "error",
			deployError: "Build failed",
			deployCompleteEvent: {
				payload: {
					success: false,
					hosted_subdomain: "web",
					deploymentTarget: "ecs",
					finalStatus: "failed",
					cloudResources: null,
					rolledBack: false,
					error: "Build failed",
				},
				receivedAt: Date.now(),
			},
			serviceLogs: [],
			deployLogEntries: [],
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
		expect(mockToastError).toHaveBeenCalled();
	});

	it("restores the deployment to running when a failed attempt reports a rolled-back final status", async () => {
		mockUseWorkerWebSocket.mockReturnValue({
			steps: [],
			sendDeployConfig: mockSendDeployConfig,
			deployConfigRef: { current: null },
			deployStatus: "error",
			deployError: "Verification failed",
			deployCompleteEvent: {
				payload: {
					success: false,
					error: "Deployment verification failed. Rolled back automatically to abc1234.",
					finalStatus: "running",
					hosted_subdomain: "restored",
					deploymentTarget: "ecs",
					cloudResources: null,
					rolledBack: false,
				},
				receivedAt: Date.now(),
			},
			serviceLogs: [],
			deployLogEntries: [],
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

	it("keeps stale draft rows in setup mode even when live evidence exists", () => {
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

		renderWithQueryClient(<DeployWorkspace />);

		expect(screen.getByText("ConfigTabs")).toBeInTheDocument();
		expect(screen.queryByText("Redeploy")).not.toBeInTheDocument();
		expect(mockSendDeployConfig).not.toHaveBeenCalled();
	});

	it("does not allow pause or resume actions for stale draft rows with live evidence", () => {
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

		renderWithQueryClient(<DeployWorkspace />);

		expect(screen.getByText("ConfigTabs")).toBeInTheDocument();
		expect(screen.queryByText("PauseResume")).not.toBeInTheDocument();
		expect(mockControlDeployment).not.toHaveBeenCalled();
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

	it("restores a draft with the same hosted subdomain after delete", async () => {
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
		expect(mockClearDeploymentLogs).toHaveBeenCalledOnce();
		await waitFor(() => {
			expect(updateDeploymentById).toHaveBeenCalledWith(
				expect.objectContaining({
					repoName: "smart-deploy",
					serviceName: "web",
					status: "didnt_deploy",
					hostedSubdomain: "current-subdomain",
				})
			);
		});
	});
});
