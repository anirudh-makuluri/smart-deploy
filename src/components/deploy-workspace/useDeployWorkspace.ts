"use client";

import * as React from "react";
import { type MenuSection } from "@/components/deploy-workspace/DeployWorkspaceMenu";
import {
	deployWorkspaceUiReducer,
	initialDeployWorkspaceUiState,
	type DeployWorkspaceUiAction,
} from "@/components/deploy-workspace/deployWorkspaceState";
import type { DeployStatus } from "@/components/deploy-workspace/DeployLogsView";
import { formatRecentDeployLogs } from "@/components/deploy-workspace/deployLogsUtils";
import type { FeedbackProgressPayload } from "@/components/FeedbackProgress";
import type { DeployCompleteWsPayload } from "@/custom-hooks/useWorkerWebSocket";
import { useWorkerWebSocket } from "@/components/WorkerWebSocketProvider";
import { useDeploymentHistoryWithSync } from "@/custom-hooks/useDeploymentHistoryWithSync";
import { useDocumentTitleSync } from "@/custom-hooks/useDocumentTitleSync";
import { usePreviewScreenshot } from "@/custom-hooks/usePreviewScreenshot";
import { useActiveDeployment, createDefaultDeployment } from "@/custom-hooks/useActiveDeployment";
import { toast } from "sonner";
import {
	DeployConfig,
	DeploymentHistoryEntry,
	DetectedServiceInfo,
	repoType,
	ScanResultsPayload,
	SDArtifactsResponse,
} from "@/app/types";
import { withDeployInfraDefaults } from "@/lib/deployInfraDefaults";
import { isDeploymentDisabled, normalizeRepoUrl } from "@/lib/utils";
import { hostedUrlFromSubdomain } from "@/lib/hostedUrl";
import {
	canManageRuntimeDeploymentStatus,
	isDraftDeploymentStatus,
	isInProgressDeploymentStatus,
	resolveDeploymentStatus,
	transitionDeploymentStatus,
} from "@/lib/deploymentStatus";
import { useAppData } from "@/store/useAppData";
import { usePostHog } from "posthog-js/react";
import { isSdArtifactsAnalyzeScan } from "@/lib/scanResultNormalization";
import { controlDeployment, deleteDeployment, fetchLatestCommit, saveDeploymentAnalysis } from "@/lib/graphqlClient";
import { authClient } from "@/lib/auth-client";

function repoRelativeServicePath(path: string | undefined): string | undefined {
	const p = path?.trim().replace(/^\.\/+/, "").replace(/\/+$/, "") ?? "";
	if (!p || p === ".") return undefined;
	return p;
}

export function useDeployWorkspace() {
	const updateDeploymentById = useAppData((s) => s.updateDeploymentById);
	const activeRepo = useAppData((s) => s.activeRepo)!;
	const serviceName = useAppData((s) => s.activeServiceName)!;
	const isLoading = useAppData((s) => s.isLoading);
	const fetchRepoDeployments = useAppData((s) => s.fetchRepoDeployments);
	const activeRepoRecord = useAppData((s) => s.activeRepoRecord)!;
	const { data: session } = authClient.useSession()!;
	const posthog = usePostHog();
	const repoName = activeRepo.name;
	const repoIdentifier = activeRepo.full_name;
	const repoOwner = activeRepo.owner.login;
	const repoUrl = activeRepo.html_url;
	const defaultBranch = activeRepo.default_branch;

	const [ui, dispatch] = React.useReducer(deployWorkspaceUiReducer, initialDeployWorkspaceUiState);
	const scanStartTimeRef = React.useRef(0);
	const lastResolvedDeploymentKeyRef = React.useRef<string | null>(null);

	const deployment = useActiveDeployment();
	const { sendDeployConfig, liveDeployConfig, deployStatus, deployError, serviceLogs, deployLogEntries, setOnDeployFinished } = useWorkerWebSocket();

	const hasHostedSubdomain = React.useMemo(() => Boolean(deployment.hostedSubdomain?.trim()), [deployment.hostedSubdomain]);
	
	const effectiveDeploymentStatus = React.useMemo(() => deployment.status, [deployment.status]);
	
	const effectiveBranch = React.useMemo(() => deployment.branch || defaultBranch, [deployment.branch, defaultBranch]);
	
	const showDeployLogs = React.useMemo(() => ui.isDeploying || deployStatus === "running" || deployStatus === "success" || deployStatus === "error",	[ui.isDeploying, deployStatus]);
		const workspaceDeployState = React.useMemo(() => {
		if (ui.isDeploying || deployStatus === "running") return "running";
		if (deployStatus === "success") return "success";
		if (deployStatus === "error") return "error";
		return "idle";
	}, [deployStatus, ui.isDeploying]);
	
	const effectiveScanResults = React.useMemo(() => (ui.scanResults || deployment.scanResults || null), [ui.scanResults, deployment.scanResults]);
	
	const hasScanResults = React.useMemo(() => Object.keys(effectiveScanResults || {}).length > 0, [effectiveScanResults]);
	
	const analyzeServicePath = React.useMemo(() => {
		if (!repoUrl || serviceName === ".") return undefined;
		const fromList = (list: DetectedServiceInfo[] | undefined) => {
			const svc = list?.find((s) => s.name === serviceName);
			return repoRelativeServicePath(svc?.path);
		};
		const record = activeRepoRecord
		return fromList(record.services);
	}, [defaultBranch, repoUrl, serviceName]);

	const deployDisabled = React.useMemo(() => isDeploymentDisabled({ ...deployment, scanResults: effectiveScanResults } as DeployConfig), [deployment, effectiveScanResults]);
	
	const deployDisabledMessage = React.useMemo(() => {
		if (!hasScanResults) return "Run smart scan first.";
		if (deployDisabled) return "Analyze must complete with at least one deploy unit.";
		return "";
	}, [deployDisabled, hasScanResults]);

		const deploymentInProgress = React.useMemo(
		() => ui.isDeploying || deployStatus === "running",
		[ui.isDeploying, deployStatus]
	);

	const statusForDeployTransition = React.useMemo(() => {
		if (
			isInProgressDeploymentStatus(effectiveDeploymentStatus) &&
			!ui.isDeploying &&
			deployStatus !== "running"
		) {
			return "failed" as const;
		}
		return effectiveDeploymentStatus;
	}, [deployStatus, effectiveDeploymentStatus, ui.isDeploying]);
	
	
	const { history: deploymentHistory, total: historyTotal, isLoading: isLoadingHistory } = useDeploymentHistoryWithSync({
		repoName,
		serviceName: serviceName,
		deployStatus: deployStatus,
	});

	useDocumentTitleSync({
		repoName: repoName,
		workspaceState: workspaceDeployState,
	});

	const { isRefreshing: isRefreshingPreview, refreshScreenshot: handleManualCreatePreview } = usePreviewScreenshot({
		repoName: repoIdentifier,
		serviceName: serviceName ?? undefined,
		screenshotUrl: deployment.screenshotUrl || undefined,
		deploymentStatus: effectiveDeploymentStatus,
		hasStoredLiveUrl: hasHostedSubdomain,
		onScreenshotUpdated: async (nextScreenshotUrl) => {
			if (!repoName || !serviceName) return;
			await updateDeploymentById({
				repoName,
				serviceName,
				repoUrl: deployment.repoUrl || repoUrl || "",
				screenshotUrl: nextScreenshotUrl,
			});
		},
		onDeploymentsRefetch: async () => {
			await fetchRepoDeployments(repoIdentifier);
		},
	});

	
	
	const onDeployFinishedCallback = React.useCallback(
		(p: DeployCompleteWsPayload) => {
			dispatch({ type: "set_deploying", value: false });
			const finalStatus = p.finalStatus;
			const hostedSubdomain = p.hosted_subdomain;
			const url = hostedUrlFromSubdomain(hostedSubdomain);
			if (p.success) {
				toast.success("Deployment successful", {
					description: url ? `Live at ${url}` : "Your application is now running.",
					duration: 8000,
				});
			} else {
				toast.error("Deployment failed", {
					description: p.error || "Check the deploy logs for details.",
					duration: 10000,
				});
			}

			updateDeploymentById({
				repoName,
				serviceName,
				repoUrl: deployment.repoUrl,
				status: finalStatus,
				firstDeployment: deployment.firstDeployment ?? new Date().toISOString(),
				lastDeployment: new Date().toISOString(),
				...(finalStatus === "running" && hostedSubdomain ? { hostedSubdomain } : {}),
				...(p.cloudResources != null ? { cloudResources: p.cloudResources } : {}),
				...(p.deploymentTarget && {
					deploymentTarget: p.deploymentTarget as DeployConfig["deploymentTarget"],
				}),
			});
		},
		[deployment.repoUrl, fetchRepoDeployments, repoIdentifier, repoName, repoUrl, serviceName, updateDeploymentById]
	);

	React.useEffect(() => {
		setOnDeployFinished(onDeployFinishedCallback);
		return () => {
			setOnDeployFinished(undefined);
		};
	}, [onDeployFinishedCallback, setOnDeployFinished]);

	const canPauseResumeDeployment = effectiveDeploymentStatus === "running" || effectiveDeploymentStatus === "paused";
	const pauseResumeAction = effectiveDeploymentStatus === "paused" ? "resume" : "pause";
	const pauseResumeNextStatus: DeployConfig["status"] =
		!canPauseResumeDeployment
			? effectiveDeploymentStatus
			: effectiveDeploymentStatus === "paused"
				? transitionDeploymentStatus(effectiveDeploymentStatus, "resume_requested")
				: transitionDeploymentStatus(effectiveDeploymentStatus, "pause_requested");
	const pauseResumeDialogTitle = effectiveDeploymentStatus === "paused" ? "Resume Deployment?" : "Pause Deployment?";
	const pauseResumeDialogDescription =
		effectiveDeploymentStatus === "paused"
			? "This will bring the deployment back online using its current configuration."
			: "This will temporarily stop the live deployment while keeping its configuration intact.";
	const pauseResumeConfirmText = ui.isChangingDeploymentState
		? effectiveDeploymentStatus === "paused"
			? "Resuming..."
			: "Pausing..."
		: effectiveDeploymentStatus === "paused"
			? "Resume Deployment"
			: "Pause Deployment";

	React.useEffect(() => {
		const deploymentKey = `${deployment.repoName}:${deployment.serviceName}:${deployment.id}`;
		if (lastResolvedDeploymentKeyRef.current === deploymentKey) return;
		lastResolvedDeploymentKeyRef.current = deploymentKey;
		dispatch({
			type: "sync_deployment_scan",
			scanResults: deployment.scanResults,
			isDraft: isDraftDeploymentStatus(
				resolveDeploymentStatus({
					status: deployment.status,
					hostedSubdomain: deployment.hostedSubdomain,
					screenshotUrl: deployment.screenshotUrl,
				})
			),
		});
	}, [deployment.id, deployment.repoName, deployment.serviceName, deployment.scanResults, deployment.status, deployment.hostedSubdomain, deployment.screenshotUrl]);

	const setActiveSection = React.useCallback((section: MenuSection) => {
		dispatch({ type: "set_active_section", value: section });
	}, []);

	const persistScanResults = React.useCallback(async (results: ScanResultsPayload, branchOverride?: string) => {
		if (!session?.user || !repoName || !serviceName) return;
		const branchToSave = branchOverride || effectiveBranch || "main";
		const responseId = isSdArtifactsAnalyzeScan(results) ? results.response_id?.trim() || null : null;

		await saveDeploymentAnalysis({
			repoName,
			serviceName,
			repoUrl: deployment.repoUrl || repoUrl || "",
			branch: branchToSave,
			commitSha: results.commit_sha ?? deployment.commitSha ?? null,
			responseId,
			scanResults: results,
		});

		dispatch({ type: "set_scan_results", value: results });
		dispatch({ type: "set_scan_mode", value: "results" });
	}, [deployment.commitSha, deployment.repoUrl, effectiveBranch, fetchRepoDeployments, repoIdentifier, repoName, repoUrl, serviceName, session?.user]);

	const onScanComplete = React.useCallback(async (results: ScanResultsPayload, branchOverride?: string) => {
		try {
			await persistScanResults(results, branchOverride);
			toast.success("Scan saved to configuration");
		} catch (err) {
			console.error("Failed to persist scan results:", err);
			toast.error(err instanceof Error ? err.message : "Failed to save scan results");
		}
	}, [persistScanResults]);

	const handleConfirmRejectScan = React.useCallback(async () => {
		if (!deployment.repoName || !deployment.serviceName) return;
		const storedScanResults = deployment.scanResults as { response_id?: string; commit_sha?: string } | null;
		const responseId = deployment.responseId?.trim() || storedScanResults?.response_id?.trim();

		try {
			if (responseId) {
				await fetch("/api/cache", {
					method: "DELETE",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ response_id: responseId }),
				});
			} else {
				console.warn("Skip cache deletion: scan result has no response_id");
			}
		} catch (err) {
			console.error("Failed to clear backend cache:", err);
		}

		await updateDeploymentById({
			repoName: deployment.repoName,
			serviceName: deployment.serviceName,
			scanResults: undefined,
		});
		dispatch({ type: "set_scan_results", value: null });
		dispatch({ type: "set_scan_mode", value: "idle" });
		toast.info("Analysis results cleared and cache invalidated");
		dispatch({ type: "set_show_reject_confirm", value: false });
	}, [deployment.repoName, deployment.responseId, deployment.scanResults, deployment.serviceName, updateDeploymentById]);

	const handleRejectScan = React.useCallback(() => {
		dispatch({ type: "set_show_reject_confirm", value: true });
	}, []);

	const handleDeploy = React.useCallback(async (commitSha?: string) => {
		if (!session?.user?.id || !activeRepo || !deployment.repoName || !deployment.serviceName) {
			return console.log("Unauthenticated or missing deploy context");
		}
		if (deploymentInProgress) {
			toast.info("Deployment already in progress. Opening logs.");
			setActiveSection("logs");
			return;
		}
		const isRuntimeRedeploy = canManageRuntimeDeploymentStatus(effectiveDeploymentStatus);
		if (deployDisabled && !isRuntimeRedeploy) {
			toast.error(deployDisabledMessage || "Deployment configuration is incomplete.");
			return;
		}

		let githubToken: string | null = null;
		try {
			const res = await fetch("/api/github/access-token", { method: "GET" });
			if (res.ok) {
				const payload = (await res.json()) as { token?: string };
				githubToken = typeof payload.token === "string" && payload.token.trim() ? payload.token.trim() : null;
			}
		} catch {
			// ignore; handled below
		}
		if (!githubToken) {
			toast.error("GitHub is not connected. Sign in with GitHub to deploy.");
			return;
		}

		const nextDeployStatus = transitionDeploymentStatus(statusForDeployTransition, "deploy_requested");

		const payload: DeployConfig = {
			...deployment,
			branch: effectiveBranch,
			status: nextDeployStatus,
			scanResults: effectiveScanResults || deployment.scanResults,
			...(commitSha && { commitSha }),
		};

		const ownerFromUrl = payload.repoUrl?.match(/github\.com[/]([^/]+)/)?.[1];
		const repoNameFromUrl = payload.repoUrl?.split("/").filter(Boolean).pop()?.replace(/\.git$/, "");
		const owner = repoOwner || ownerFromUrl;
		const currentRepoName = repoName || repoNameFromUrl;

		if (owner && currentRepoName) {
			fetchLatestCommit(owner, currentRepoName, payload.branch)
				.then((commit) => {
					if (commit) {
						dispatch({
							type: "set_deploying_commit_info",
							value: {
								sha: commit.sha,
								message: commit.message,
								author: commit.author,
								date: commit.date,
							},
						});
					}
				})
				.catch((err) => {
					console.error("Failed to fetch commit info:", err);
				});
		}

		posthog.capture("deploy_clicked", {
			repo_name: payload.repoName ?? null,
			service_name: payload.serviceName ?? null,
			branch: payload.branch ?? null,
			commit_sha: payload.commitSha ?? null,
			has_scan_results: Boolean(payload.scanResults),
		});

		dispatch({ type: "set_deploying", value: true });
		if (statusForDeployTransition !== effectiveDeploymentStatus) {
			await updateDeploymentById({
				repoName: payload.repoName,
				serviceName: payload.serviceName,
				status: "failed",
			});
		}
		await updateDeploymentById({
			repoName: payload.repoName,
			serviceName: payload.serviceName,
			repoUrl: payload.repoUrl || repoUrl || "",
			branch: payload.branch,
			commitSha: payload.commitSha,
			status: nextDeployStatus,
		});
		sendDeployConfig(payload, githubToken, session?.user?.id);
		setActiveSection("logs");
	}, [
		activeRepo,
		deployDisabled,
		deployDisabledMessage,
		deployment,
		deploymentInProgress,
		effectiveBranch,
		effectiveDeploymentStatus,
		effectiveScanResults,
		posthog,
		repoName,
		repoOwner,
		repoUrl,
		sendDeployConfig,
		session?.user?.id,
		setActiveSection,
		statusForDeployTransition,
		updateDeploymentById,
	]);

	const startScan = React.useCallback(() => {
		if (!repoUrl) {
			toast.error("Unable to start scan: repository URL is missing.");
			return;
		}
		scanStartTimeRef.current = Date.now();
		dispatch({ type: "set_scan_mode", value: "scanning" });
		setActiveSection("scan");
	}, [repoUrl, setActiveSection]);

	const onStartImproveScan = React.useCallback((payload: FeedbackProgressPayload) => {
		const fallbackFailureLogs = formatRecentDeployLogs(deployLogEntries);

		const resolvedCommitSha =
			payload.commitSha ||
			(payload as { commit_sha?: string } | null)?.commit_sha ||
			((deployment.scanResults as { commit_sha?: string } | null)?.commit_sha ?? undefined) ||
			(deployment.commitSha ?? undefined);

		if (!resolvedCommitSha) {
			toast.error("Cannot start feedback remediation: missing commit SHA from scan results.");
			return;
		}

		dispatch({
			type: "set_improve_scan_payload",
			value: {
				...payload,
				commitSha: resolvedCommitSha,
				packagePath: payload.packagePath || analyzeServicePath || ".",
				failedArtifactScope: payload.failedArtifactScope || "general",
				failureSummary: payload.failureSummary || deployError || undefined,
				failureLogs: payload.failureLogs || fallbackFailureLogs || undefined,
			},
		});
		setActiveSection("scan");
	}, [analyzeServicePath, deployError, deployLogEntries, deployment.commitSha, deployment.scanResults, setActiveSection]);

	const handlePauseResumeDeployment = React.useCallback(async () => {
		if (!deployment.repoName || !deployment.serviceName || ui.isChangingDeploymentState || !canPauseResumeDeployment) return;

		dispatch({ type: "set_changing_deployment_state", value: true });
		try {
			await controlDeployment(pauseResumeAction, deployment.repoName, deployment.serviceName);
			await updateDeploymentById({
				repoName: deployment.repoName,
				serviceName: deployment.serviceName,
				repoUrl: deployment.repoUrl || repoUrl || "",
				status: pauseResumeNextStatus,
			});
			toast.success(
				pauseResumeNextStatus === "paused"
					? "Deployment paused"
					: "Deployment resumed"
			);
			dispatch({ type: "set_show_pause_resume_confirm", value: false });
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to update deployment";
			toast.error(message);
		} finally {
			dispatch({ type: "set_changing_deployment_state", value: false });
		}
	}, [canPauseResumeDeployment, deployment, pauseResumeAction, pauseResumeNextStatus, repoUrl, ui.isChangingDeploymentState, updateDeploymentById]);

	const handleConfirmRollbackDeployment = React.useCallback(async () => {
		const rollbackCommitSha = ui.rollbackEntry?.commitSha?.trim();
		if (!rollbackCommitSha) {
			toast.error("Cannot redeploy the selected release because its commit SHA is missing.");
			return;
		}
		dispatch({ type: "set_show_rollback_confirm", value: false });
		await handleDeploy(rollbackCommitSha);
	}, [
		handleDeploy,
		ui.rollbackEntry?.commitSha,
	]);

	const handleDeleteDeployment = React.useCallback(async () => {
		if (!deployment.repoName || !deployment.serviceName || ui.isChangingDeploymentState) return;

		dispatch({ type: "set_changing_deployment_state", value: true });
		try {
			const deletedScanResults = effectiveScanResults;
			const draftDeployment = withDeployInfraDefaults({
				...createDefaultDeployment(
					deployment.repoName,
					deployment.serviceName,
					deployment.repoUrl,
					deployment.branch
				),
				responseId: deployment.responseId ?? null,
				envVars: deployment.envVars ?? null,
				revision: 0,
				cloudProvider: deployment.cloudProvider,
				deploymentTarget: deployment.deploymentTarget,
				region: deployment.region,
				scanResults: deletedScanResults ?? deployment.scanResults ?? {},
			} as DeployConfig);
			await deleteDeployment(deployment.repoName, deployment.serviceName);
			useAppData.getState().removeDeployment(deployment.repoName, deployment.serviceName);
			await updateDeploymentById(draftDeployment);
			if (deletedScanResults && Object.keys(deletedScanResults).length > 0) {
				dispatch({ type: "set_scan_results", value: deletedScanResults as SDArtifactsResponse });
			} else {
				dispatch({ type: "set_scan_results", value: null });
			}
			toast.success("Deployment deleted. Draft restored.");
			dispatch({ type: "set_show_delete_confirm", value: false });
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to delete deployment";
			toast.error(message);
		} finally {
			dispatch({ type: "set_changing_deployment_state", value: false });
		}
	}, [deployment, effectiveScanResults, ui.isChangingDeploymentState, updateDeploymentById]);

	const handleRollbackEntrySelect = React.useCallback((entry: DeploymentHistoryEntry) => {
		dispatch({ type: "set_rollback_entry", value: entry });
		dispatch({ type: "set_show_rollback_confirm", value: true });
	}, []);

	const handleScanProgressComplete = React.useCallback((data: SDArtifactsResponse) => {
		dispatch({ type: "set_scan_duration", value: Date.now() - scanStartTimeRef.current });
		dispatch({ type: "set_scan_results", value: data });
		dispatch({ type: "set_scan_mode", value: "results" });
	}, []);

	const handleImproveScanComplete = React.useCallback(async (data: ScanResultsPayload) => {
		try {
			await persistScanResults(data);
			dispatch({ type: "set_improve_scan_payload", value: null });
			toast.success("Scan results updated");
		} catch (err) {
			console.error("Failed to persist improved scan:", err);
			toast.error(err instanceof Error ? err.message : "Failed to save scan results");
		}
	}, [persistScanResults]);

	const handleImproveScanCancel = React.useCallback(() => {
		dispatch({ type: "set_improve_scan_payload", value: null });
		dispatch({ type: "set_scan_mode", value: hasScanResults ? "results" : "idle" });
	}, [hasScanResults]);

	const handleConfigChange = React.useCallback((partial: Partial<DeployConfig>) => {
		updateDeploymentById({
			repoName: repoName,
			serviceName: serviceName,
			...partial,
		});
	}, [deployment, effectiveBranch, repoName, repoUrl, serviceName, updateDeploymentById]);

	const latestDeploymentRunId = React.useMemo(
		() => deploymentHistory?.[0]?.id ?? null,
		[deploymentHistory]
	);

	const missingService = !activeRepo || !serviceName;
	const repoNotFound = !isLoading && !activeRepo;
	const repoRecord = (activeRepo ?? null) as repoType | null;
	const currentServiceName = serviceName ?? "";
	const deploymentConfig = deployment as DeployConfig;

	return {
		missingService,
		repoNotFound,
		ui,
		dispatch,
		repoRecord,
		currentServiceName,
		deploymentConfig,
		repoUrl,
		repoName,
		repoIdentifier,
		analyzeServicePath,
		effectiveBranch,
		hasScanResults,
		deployDisabled,
		deploymentInProgress,
		deployDisabledMessage,
		effectiveDeploymentStatus,
		effectiveScanResults,
		deploymentHistory,
		historyTotal,
		isLoadingHistory,
		latestDeploymentRunId,
		showDeployLogs,
		deployLogEntries,
		serviceLogs,
		deployStatus,
		deployError,
		liveDeployConfig,
		isRefreshingPreview,
		pauseResumeDialogTitle,
		pauseResumeDialogDescription,
		pauseResumeConfirmText,
		setActiveSection,
		onScanComplete,
		handleScanProgressComplete,
		handleImproveScanComplete,
		handleImproveScanCancel,
		handleDeploy,
		handleRejectScan,
		onStartImproveScan,
		startScan,
		handleRollbackEntrySelect,
		handleConfigChange,
		persistScanResults,
		handleManualCreatePreview,
		handleConfirmRejectScan,
		handleDeleteDeployment,
		handlePauseResumeDeployment,
		handleConfirmRollbackDeployment,
	};
}

export type UseDeployWorkspaceResult = ReturnType<typeof useDeployWorkspace>;
export type DeployWorkspaceDispatch = React.Dispatch<DeployWorkspaceUiAction>;
