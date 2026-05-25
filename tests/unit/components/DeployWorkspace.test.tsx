import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const mockApproveDeploymentRemediation = vi.fn();
const mockRejectDeploymentRemediation = vi.fn();
const mockFetchLatestCommit = vi.fn();
const mockPrefillInfra = vi.fn();
const mockControlDeployment = vi.fn();
const mockDeleteDeployment = vi.fn();
const mockFetchDeploymentHistoryPage = vi.fn();
const sendDeployConfig = vi.fn();

let appState: Record<string, unknown> = {};

const remediationFeedbackResult = {
	commit_sha: "def456",
	dockerfiles: { Dockerfile: "FROM node:20" },
	nginx_conf: "proxy_pass http://127.0.0.1:8080;",
	services: [{ name: "web", port: 8080, build_context: ".", dockerfile_path: "Dockerfile" }],
};

const remediationAnalysis = {
	summary: "Nginx is pointing at the wrong upstream port.",
	rootCause: "The generated nginx config still proxies to port 3000 while the service listens on 8080.",
	concreteFixInstructions: "Regenerate nginx and related deployment artifacts so traffic is routed to port 8080.",
	evidence: ["upstream connection refused", "health check reported connection_refused"],
	failedArtifactScope: "nginx",
	expectedOutcome: "The generated artifacts should route traffic to the running service on port 8080.",
};

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

vi.mock("@/lib/graphqlClient", () => ({
	approveDeploymentRemediation: (...args: unknown[]) => mockApproveDeploymentRemediation(...args),
	rejectDeploymentRemediation: (...args: unknown[]) => mockRejectDeploymentRemediation(...args),
	fetchLatestCommit: (...args: unknown[]) => mockFetchLatestCommit(...args),
	prefillInfra: (...args: unknown[]) => mockPrefillInfra(...args),
	controlDeployment: (...args: unknown[]) => mockControlDeployment(...args),
	deleteDeployment: (...args: unknown[]) => mockDeleteDeployment(...args),
	fetchDeploymentHistoryPage: (...args: unknown[]) => mockFetchDeploymentHistoryPage(...args),
}));

vi.mock("@/components/ConfigTabs", () => ({
	default: () => <div>ConfigTabs</div>,
}));
vi.mock("@/components/DeploymentHistory", () => ({
	default: () => <div>DeploymentHistory</div>,
}));
vi.mock("@/components/deploy-workspace/DeployWorkspaceMenu", () => ({
	default: (props: { onChange?: (section: string) => void }) => (
		<div>
			<div>DeployWorkspaceMenu</div>
			<button onClick={() => props.onChange?.("logs")}>Open Logs</button>
		</div>
	),
}));
vi.mock("@/components/deploy-workspace/DeployOverview", () => ({
	default: () => <div>DeployOverview</div>,
}));
vi.mock("@/components/deploy-workspace/DeployLogsView", () => ({
	default: (props: {
		latestRemediationAttempt?: { summary?: string; trigger_type?: string; diff_preview?: unknown[] | null } | null;
		monitoringState?: { finalStatus?: string } | null;
		onApproveRemediation?: () => void;
		onRejectRemediation?: () => void;
	}) => (
		<div>
			<div>DeployLogsView</div>
			{props.latestRemediationAttempt?.summary && <div>{props.latestRemediationAttempt.summary}</div>}
			{props.latestRemediationAttempt?.trigger_type && <div>{props.latestRemediationAttempt.trigger_type}</div>}
			{Array.isArray(props.latestRemediationAttempt?.diff_preview) && props.latestRemediationAttempt.diff_preview.length > 0 && <div>Has remediation diff</div>}
			{props.monitoringState?.finalStatus && <div>{props.monitoringState.finalStatus}</div>}
			{props.onApproveRemediation && (
				<button onClick={props.onApproveRemediation}>
					{Array.isArray(props.latestRemediationAttempt?.diff_preview) && props.latestRemediationAttempt.diff_preview.length > 0
						? "Redeploy with this plan"
						: "Investigate and prepare fix"}
				</button>
			)}
			{props.onRejectRemediation && <button onClick={props.onRejectRemediation}>Reject Retry</button>}
		</div>
	),
}));
vi.mock("@/components/ScanProgress", () => ({
	default: () => <div>ScanProgress</div>,
}));
vi.mock("@/components/FeedbackProgress", () => ({
	default: (props: { payload?: { title?: string }; onComplete?: (data: typeof remediationFeedbackResult) => void }) => (
		<div>
			<div>{props.payload?.title || "FeedbackProgress"}</div>
			<button onClick={() => props.onComplete?.(remediationFeedbackResult as any)}>Complete Feedback</button>
		</div>
	),
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
	afterEach(() => {
		cleanup();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockUseSession.mockReturnValue({ data: { user: { name: "A", id: "u-1" } } });
		mockApproveDeploymentRemediation.mockImplementation(async (attemptId: string) => ({
			id: attemptId,
			repo_name: "smart-deploy",
			service_name: "web",
			attempt_number: 1,
			trigger_type: "deploy_failure",
			summary: "Fix nginx upstream and retry deployment.",
			approved_by_user: true,
			status: "approved",
			created_at: new Date().toISOString(),
		}));
		mockRejectDeploymentRemediation.mockResolvedValue({
			id: "attempt-1",
			status: "rejected",
			created_at: new Date().toISOString(),
		});
		mockFetchLatestCommit.mockResolvedValue({
			sha: "abc1234",
			message: "Fix deploy",
			author: "A",
			date: new Date().toISOString(),
		});
		mockPrefillInfra.mockResolvedValue({ found: false });
		mockControlDeployment.mockResolvedValue(undefined);
		mockDeleteDeployment.mockResolvedValue(undefined);
		mockFetchDeploymentHistoryPage.mockResolvedValue({ history: [], total: 0 });
		mockUseWorkerWebSocket.mockReturnValue({
			steps: [],
			sendDeployConfig,
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
		global.fetch = vi.fn((input: RequestInfo | URL) => {
			const url = String(input);
			if (url === "/api/github/access-token") {
				return Promise.resolve({
					ok: true,
					json: async () => ({ token: "gh-token" }),
				});
			}
			if (url === "/api/llm/analyze-failure") {
				return Promise.resolve({
					ok: true,
					json: async () => ({ response: remediationAnalysis.summary, analysis: remediationAnalysis }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: async () => ({ status: "success", history: [] }),
			});
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

	it("shows a remediation proposal after a failed deploy", async () => {
		const user = userEvent.setup();
		mockUseWorkerWebSocket.mockReturnValue({
			steps: [{ id: "deploy", label: "Deploy", status: "error", logs: ["upstream connection refused"] }],
			sendDeployConfig,
			deployConfigRef: { current: null },
			deployStatus: "error",
			deployError: "Deployment failed",
			serviceLogs: [],
			deployLogEntries: [],
			latestRemediationAttempt: {
				id: "attempt-1",
				repo_name: "smart-deploy",
				service_name: "web",
				attempt_number: 1,
				trigger_type: "deploy_failure",
				summary: "Fix nginx upstream and retry deployment.",
				status: "proposed",
				created_at: new Date().toISOString(),
			},
			monitoringState: null,
			setOnDeployFinished: vi.fn(),
		});
		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [{ ...baseDeployment, liveUrl: "https://web.example.com" }],
		};

		renderWithQueryClient(<DeployWorkspace />);
		await user.click(screen.getAllByRole("button", { name: "Open Logs" }).at(-1)!);

		expect(screen.getByText("Fix nginx upstream and retry deployment.")).toBeInTheDocument();
		expect(screen.getByText("deploy_failure")).toBeInTheDocument();
	});

	it("analyzes a remediation attempt, shows generated artifact changes, and redeploys only after review approval", async () => {
		const user = userEvent.setup();
		mockUseWorkerWebSocket.mockReturnValue({
			steps: [{ id: "deploy", label: "Deploy", status: "error", logs: ["upstream connection refused"] }],
			sendDeployConfig,
			deployConfigRef: { current: null },
			deployStatus: "error",
			deployError: "Deployment failed",
			serviceLogs: [],
			deployLogEntries: [],
			latestHealthCheck: {
				url: "https://web.example.com",
				status: "unreachable",
				failure_type: "connection_refused",
				error_message: "upstream connection refused",
				checked_at: new Date().toISOString(),
			},
			latestRemediationAttempt: {
				id: "attempt-1",
				repo_name: "smart-deploy",
				service_name: "web",
				attempt_number: 1,
				trigger_type: "deploy_failure",
				summary: "Fix nginx upstream and retry deployment.",
				status: "proposed",
				created_at: new Date().toISOString(),
			},
			monitoringState: null,
			setOnDeployFinished: vi.fn(),
		});
		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [{
				...baseDeployment,
				commitSha: "abc123",
				liveUrl: "https://web.example.com",
				envVars: "PORT=3000",
				scanResults: {
					commit_sha: "abc123",
					services: [{ name: "web", port: 8080, build_context: ".", dockerfile_path: "Dockerfile" }],
					nginx_conf: "proxy_pass http://127.0.0.1:3000;",
				},
			}],
		};

		renderWithQueryClient(<DeployWorkspace />);
		await user.click(screen.getAllByRole("button", { name: "Open Logs" }).at(-1)!);
		await user.click(screen.getByRole("button", { name: "Investigate and prepare fix" }));

		await waitFor(() => {
			expect(global.fetch).toHaveBeenCalledWith(
				"/api/llm/analyze-failure",
				expect.objectContaining({ method: "POST" })
			);
		});
		expect(screen.getByText("Preparing recovery plan 1")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Complete Feedback" }));
		expect(screen.getByText("Has remediation diff")).toBeInTheDocument();
		expect(mockApproveDeploymentRemediation).not.toHaveBeenCalled();
		expect(sendDeployConfig).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "Redeploy with this plan" }));

		await waitFor(() => {
			expect(mockApproveDeploymentRemediation).toHaveBeenCalledWith("attempt-1");
			expect(sendDeployConfig).toHaveBeenCalledWith(
				expect.objectContaining({
					scanResults: remediationFeedbackResult,
					commitSha: "def456",
				}),
				"gh-token",
				"u-1"
			);
		});
	});

	it("shows a remediation proposal when monitoring later marks the deployment unhealthy", async () => {
		const user = userEvent.setup();
		mockUseWorkerWebSocket.mockReturnValue({
			steps: [],
			sendDeployConfig,
			deployConfigRef: { current: null },
			deployStatus: "error",
			deployError: "Deployment became unhealthy",
			serviceLogs: [],
			deployLogEntries: [],
			latestRemediationAttempt: {
				id: "attempt-2",
				repo_name: "smart-deploy",
				service_name: "web",
				attempt_number: 2,
				trigger_type: "post_deploy_unhealthy",
				summary: "Adjust runtime wiring after monitoring failure.",
				status: "proposed",
				created_at: new Date().toISOString(),
			},
			monitoringState: { active: false, finalStatus: "unhealthy", error: "Request timed out" },
			setOnDeployFinished: vi.fn(),
		});
		appState = {
			...appState,
			activeRepo: { name: "smart-deploy", default_branch: "main", full_name: "acme/smart-deploy", html_url: "https://github.com/acme/smart-deploy" },
			activeServiceName: "web",
			deployments: [{ ...baseDeployment, liveUrl: "https://web.example.com" }],
		};

		renderWithQueryClient(<DeployWorkspace />);
		await user.click(screen.getAllByRole("button", { name: "Open Logs" }).at(-1)!);

		expect(screen.getByText("Adjust runtime wiring after monitoring failure.")).toBeInTheDocument();
		expect(screen.getByText("post_deploy_unhealthy")).toBeInTheDocument();
		expect(screen.getByText("unhealthy")).toBeInTheDocument();
	});
});
