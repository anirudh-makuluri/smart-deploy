"use client";

import * as React from "react";
import ConfigTabs from "@/components/ConfigTabs";
import DeploymentHistory from "@/components/DeploymentHistory";
import DeployWorkspaceMenu, { MenuSection } from "@/components/deploy-workspace/DeployWorkspaceMenu";
import DeployOverview from "@/components/deploy-workspace/DeployOverview";
import DeployLogsView, { DeployStatus } from "@/components/deploy-workspace/DeployLogsView";
import BlueprintView from "@/components/blueprint/BlueprintView";
import DirectStaticConfigureView from "@/components/DirectStaticConfigureView";
import DirectStaticPreviewView from "@/components/DirectStaticPreviewView";

import type { DeployCompleteWsPayload } from "@/custom-hooks/useWorkerWebSocket";
import { useWorkerWebSocket } from "@/components/WorkerWebSocketProvider";

import { useDeploymentHistoryWithSync } from "@/custom-hooks/useDeploymentHistoryWithSync";
import { useDocumentTitleSync } from "@/custom-hooks/useDocumentTitleSync";
import { usePreviewScreenshot } from "@/custom-hooks/usePreviewScreenshot";
import { useActiveDeployment } from "@/custom-hooks/useActiveDeployment";
import { toast } from "sonner";
import { DeployConfig, DeploymentHistoryEntry, DetectedServiceInfo, repoType, SDArtifactsResponse } from "@/app/types";
import { withDeployInfraDefaults } from "@/lib/deployInfraDefaults";
import { configSnapshotFromDeployConfig, isDeploymentDisabled, normalizeRepoUrl } from "@/lib/utils";
import { getDeploymentKind, isDirectStaticScanResults } from "@/lib/deploymentKind";
import {
	isDraftDeploymentStatus,
	isInProgressDeploymentStatus,
	resolveDeploymentStatus,
	transitionDeploymentStatus,
} from "@/lib/deploymentStatus";
import { branchNamesFromRepo } from "@/lib/repoBranch";
import { useAppData } from "@/store/useAppData";
import { Rocket, Search, ShieldCheck, AlertCircle, Layers } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import ScanProgress from "@/components/ScanProgress";
import FeedbackProgress, { type FeedbackProgressPayload } from "@/components/FeedbackProgress";
import PostScanResults from "@/components/PostScanResults";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { controlDeployment, deleteDeployment, fetchLatestCommit, prefillInfra } from "@/lib/graphqlClient";
import { authClient } from "@/lib/auth-client";

function repoRelativeServicePath(path: string | undefined): string | undefined {
	const p = path?.trim().replace(/^\.\/+/, "").replace(/\/+$/, "") ?? "";
	if (!p || p === ".") return undefined;
	return p;
}

export type DeployWorkspaceProps = {
	mobileNavOpen?: boolean;
	onMobileNavOpenChange?: (open: boolean) => void;
};

export default function DeployWorkspace({
	mobileNavOpen = false,
	onMobileNavOpenChange,
}: DeployWorkspaceProps = {}) {
	// ============== STORE SELECTIONS ==============
	const updateDeploymentById = useAppData((s) => s.updateDeploymentById);
	const activeRepo = useAppData((s) => s.activeRepo);
	const serviceName = useAppData((s) => s.activeServiceName);
	const isLoading = useAppData((s) => s.isLoading);
	const fetchRepoDeployments = useAppData((s) => s.fetchRepoDeployments);
	const getDetectedRepoCache = useAppData((s) => s.getDetectedRepoCache);
	const repoServices = useAppData((s) => s.repoServices);
	const { data: session } = authClient.useSession();
	const posthog = usePostHog();
	const repoName = activeRepo?.name ?? "";
	const repoIdentifier = activeRepo?.full_name ?? repoName;
	const repoOwner = activeRepo?.owner?.login ?? "";
	const repoUrl = activeRepo?.html_url ?? "";
	const defaultBranch = activeRepo?.default_branch ?? "";

	// ============== STATE ==============
	const [isDeploying, setIsDeploying] = React.useState(false);
	const [deployingCommitInfo, setDeployingCommitInfo] = React.useState<{ sha: string; message: string; author: string; date: string } | null>(null);
	const [activeSection, setActiveSection] = React.useState<MenuSection>("setup");
	const [scanMode, setScanMode] = React.useState<"idle" | "scanning" | "results">("idle");
	const [scanResults, setScanResults] = React.useState<SDArtifactsResponse | null>(null);
	const [scanStartTime, setScanStartTime] = React.useState<number>(0);
	const [scanDuration, setScanDuration] = React.useState<number>(0);
	const [isPrefillingScan, setIsPrefillingScan] = React.useState(false);
	const [showRejectConfirm, setShowRejectConfirm] = React.useState(false);
	const [showPauseResumeConfirm, setShowPauseResumeConfirm] = React.useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
	const [showRollbackConfirm, setShowRollbackConfirm] = React.useState(false);
	const [rollbackEntry, setRollbackEntry] = React.useState<DeploymentHistoryEntry | null>(null);
	const [improveScanPayload, setImproveScanPayload] = React.useState<FeedbackProgressPayload | null>(null);
	const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
	const lastResolvedDeploymentKeyRef = React.useRef<string | null>(null);
	const [isChangingDeploymentState, setIsChangingDeploymentState] = React.useState(false);

	// ============== BASIC CONTEXT ==============
	const deployment = useActiveDeployment();

	// ============== MEMOIZED DERIVED VALUES (for callbacks & hooks) ==============
	const hasStoredLiveUrl = React.useMemo(
		() => Boolean(deployment.liveUrl),
		[deployment.liveUrl]
	);

	const effectiveDeploymentStatus = React.useMemo(
		() =>
			resolveDeploymentStatus({
				status: deployment.status,
				liveUrl: hasStoredLiveUrl ? deployment.liveUrl : null,
				screenshotUrl: deployment.screenshotUrl,
			}),
		[deployment.liveUrl, deployment.screenshotUrl, deployment.status, hasStoredLiveUrl]
	);

	// ============== CALLBACKS ==============
	const onDeployFinishedCallback = React.useCallback(
		(p: DeployCompleteWsPayload) => {
			setIsDeploying(false);
			const finalStatus =
				typeof p.finalStatus === "string" && p.finalStatus
					? p.finalStatus
					: (p.success ? "running" : "failed");
			const url = p.customUrl || p.deployUrl;
			if (p.success) {
				if (p.rolledBack) {
					toast.success("Rollback successful", {
						description: url ? `Restored release at ${url}` : "The previous release is now running.",
						duration: 8000,
					});
				} else {
					toast.success("Deployment successful", {
						description: url ? `Live at ${url}` : "Your application is now running.",
						duration: 8000,
					});
				}
			} else {
				toast.error(p.rolledBack ? "Rollback failed" : "Deployment failed", {
					description: p.error || "Check the deploy logs for details.",
					duration: 10000,
				});
			}

			if (repoName && serviceName) {
				void updateDeploymentById({
					repoName,
					serviceName,
					url: deployment.url || repoUrl || "",
					status: finalStatus,
					lastDeployment: new Date().toISOString(),
					liveUrl: finalStatus === "running" ? (url || deployment.liveUrl || null) : (deployment.liveUrl || null),
					...(p.ec2 != null ? { ec2: p.ec2 } : {}),
					...(p.deploymentTarget && {
						deploymentTarget: p.deploymentTarget as DeployConfig["deploymentTarget"],
					}),
				});
				void fetchRepoDeployments(repoIdentifier);
			}
		},
		[deployment.liveUrl, deployment.url, fetchRepoDeployments, repoIdentifier, repoName, repoUrl, serviceName, updateDeploymentById]
	);

	const effectiveBranch = React.useMemo(
		() => deployment.branch || defaultBranch,
		[deployment.branch, defaultBranch]
	);

	const { steps, sendDeployConfig, sendRollbackRequest, deployConfigRef, deployStatus, deployError, serviceLogs, deployLogEntries, setOnDeployFinished } =
		useWorkerWebSocket();

	React.useEffect(() => {
		setOnDeployFinished(onDeployFinishedCallback);
		return () => {
			setOnDeployFinished(undefined);
		};
	}, [onDeployFinishedCallback, setOnDeployFinished]);

	const { history: deploymentHistory, total: historyTotal, isLoading: isLoadingHistory } = useDeploymentHistoryWithSync({
		repoName,
		serviceName: serviceName ?? "",
		deployStatus: deployStatus,
	});

	const workspaceDeployState = React.useMemo(() => {
		if (isDeploying || deployStatus === "running") return "running";
		if (deployStatus === "success") return "success";
		if (deployStatus === "error") return "error";
		return "idle";
	}, [deployStatus, isDeploying]);

	useDocumentTitleSync({
		repoName: repoIdentifier,
		workspaceState: workspaceDeployState,
	});

	const { isRefreshing: isRefreshingPreview, refreshScreenshot: handleManualCreatePreview } = usePreviewScreenshot({
		repoName: repoIdentifier,
		serviceName: serviceName ?? undefined,
		screenshotUrl: deployment.screenshotUrl || undefined,
		deploymentStatus: effectiveDeploymentStatus,
		hasStoredLiveUrl: hasStoredLiveUrl,
		onScreenshotUpdated: async (nextScreenshotUrl) => {
			if (!repoName || !serviceName) return;
			await updateDeploymentById({
				repoName,
				serviceName,
				url: deployment.url || repoUrl || "",
				screenshotUrl: nextScreenshotUrl,
			});
		},
		onDeploymentsRefetch: async () => {
			await fetchRepoDeployments(repoIdentifier);
		},
	});

	// ============== ADDITIONAL MEMOIZED DERIVED VALUES ==============
	const showDeployLogs = React.useMemo(
		() => isDeploying || deployStatus === "running" || deployStatus === "success" || deployStatus === "error",
		[isDeploying, deployStatus]
	);

	const effectiveDeployStatus: DeployStatus = React.useMemo(() => {
		return deployStatus === "not-started" ? "not-started" :
			deployStatus === "running" ? "running" :
				deployStatus === "success" ? "success" :
					deployStatus === "error" ? "error" : "not-started";
	}, [deployStatus]);

	const analyzeServicePath = React.useMemo(() => {
		if (!repoUrl || serviceName === ".") return undefined;
		const fromList = (list: DetectedServiceInfo[] | undefined) => {
			const svc = list?.find((s) => s.name === serviceName);
			return repoRelativeServicePath(svc?.path);
		};
		const cached = fromList(getDetectedRepoCache(repoUrl, defaultBranch)?.services);
		if (cached) return cached;
		const norm = normalizeRepoUrl(repoUrl);
		const record = repoServices.find(
			(r) =>
				normalizeRepoUrl(r.repo_url) === norm &&
				(defaultBranch ? r.branch === defaultBranch : true)
		);
		return fromList(record?.services);
	},
	[defaultBranch, repoUrl, serviceName, getDetectedRepoCache, repoServices]);


	const effectiveScanResults = React.useMemo(
		() => (scanResults || deployment.scanResults || null),
		[scanResults, deployment.scanResults]
	);
	const deploymentKind = React.useMemo(
		() => getDeploymentKind(deployment),
		[deployment]
	);
	const isDirectStatic = deploymentKind === "direct-static";
	const directStaticResults = React.useMemo<SDArtifactsResponse | null>(
		() => (isDirectStaticScanResults(effectiveScanResults) ? (effectiveScanResults as SDArtifactsResponse) : null),
		[effectiveScanResults]
	);

	const hasScanResults = React.useMemo(
		() => Object.keys(effectiveScanResults || {}).length > 0,
		[effectiveScanResults]
	);

	const deploymentConfigInvalid = React.useMemo(
		() => isDeploymentDisabled({ ...deployment, scanResults: effectiveScanResults } as DeployConfig),
		[deployment, effectiveScanResults]
	);
	const directStaticDeploySupported = true;
	const deployDisabled = deploymentConfigInvalid || (isDirectStatic && !directStaticDeploySupported);
	const deployDisabledMessage = React.useMemo(() => {
		if (isDirectStatic) {
			if (!hasScanResults) return "Static configuration is still being prepared.";
			if (deploymentConfigInvalid) return "Output directory and nginx.conf are required.";
			return "";
		}
		if (!hasScanResults) return "Run smart scan first.";
		if (deploymentConfigInvalid) return "At least one Dockerfile and nginx.conf are required.";
		return "";
	}, [deploymentConfigInvalid, hasScanResults, isDirectStatic]);

	const isDraft = React.useMemo(
		() => isDraftDeploymentStatus(effectiveDeploymentStatus),
		[effectiveDeploymentStatus]
	);
	const canPauseResumeDeployment =
		effectiveDeploymentStatus === "running" || effectiveDeploymentStatus === "paused";
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
	const pauseResumeConfirmText = isChangingDeploymentState
		? effectiveDeploymentStatus === "paused"
			? "Resuming..."
			: "Pausing..."
		: effectiveDeploymentStatus === "paused"
			? "Resume Deployment"
			: "Pause Deployment";
	const deploymentInProgress = React.useMemo(
		() => isInProgressDeploymentStatus(effectiveDeploymentStatus),
		[effectiveDeploymentStatus]
	);

	React.useEffect(() => {
		const deploymentKey = `${deployment.repoName}:${deployment.serviceName}:${deployment.id}`;
		if (lastResolvedDeploymentKeyRef.current === deploymentKey) return;
		lastResolvedDeploymentKeyRef.current = deploymentKey;
		setActiveSection(isDraft ? (isDirectStatic ? "scan" : "setup") : "overview");
	}, [deployment.id, deployment.repoName, deployment.serviceName, isDirectStatic, isDraft]);

	if (!activeRepo || !serviceName) {
		return (
			<div className="landing-bg min-h-svh flex flex-col items-center justify-center gap-4 text-foreground">
				<p className="text-muted-foreground">Service not found</p>
			</div>
		);
	}

	const repoRecord = activeRepo as repoType;
	const currentServiceName = serviceName ?? "";

	async function onScanComplete(results: SDArtifactsResponse, branchOverride?: string) {
		if (!session?.user || !repoName || !serviceName) return;
		const branchToSave = branchOverride || effectiveBranch || "main";

		await updateDeploymentById({
			repoName,
			serviceName: serviceName,
			url: deployment.url || repoUrl || "",
			branch: branchToSave,
			commitSha: results.commit_sha ?? deployment.commitSha ?? null,
			scanResults: results,
		});
		setScanResults(results);
		setScanMode("results");
		toast.success("Scan saved to configuration");
	}

	async function handleConfirmRejectScan() {
		if (!deployment.repoName || !deployment.serviceName) return;
		const scanResults = deployment.scanResults as { response_id?: string; commit_sha?: string } | null;
		const responseId = deployment.responseId?.trim() || scanResults?.response_id?.trim();

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
			scanResults: null as never as SDArtifactsResponse,
		});
		setScanResults(null);
		setScanMode("idle");
		toast.info("Analysis results cleared and cache invalidated");
		setShowRejectConfirm(false);
	}

	async function handleRejectScan() {
		setShowRejectConfirm(true);
	}

	async function handleDeploy(commitSha?: string) {
		if (!session?.user?.id || !activeRepo || !deployment.repoName || !deployment.serviceName) {
			return console.log("Unauthenticated or missing deploy context");
		}
		if (deploymentInProgress) {
			toast.info("Deployment already in progress. Opening logs.");
			setActiveSection("logs");
			return;
		}
		if (deployDisabled) {
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

		const payload: DeployConfig = {
			...deployment,
			branch: effectiveBranch,
			status: effectiveDeploymentStatus,
			scanResults: effectiveScanResults || deployment.scanResults,
			...(commitSha && { commitSha }),
		};

		const ownerFromUrl = payload.url?.match(/github\.com[/]([^/]+)/)?.[1];
		const repoNameFromUrl = payload.url?.split("/").filter(Boolean).pop()?.replace(/\.git$/, "");
		const owner = repoOwner || ownerFromUrl;
		const currentRepoName = repoName || repoNameFromUrl;

		if (owner && currentRepoName) {
			fetchLatestCommit(owner, currentRepoName, payload.branch)
				.then((commit) => {
					if (commit) {
						setDeployingCommitInfo({
							sha: commit.sha,
							message: commit.message,
							author: commit.author,
							date: commit.date,
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

		setIsDeploying(true);
		await updateDeploymentById({
			repoName: payload.repoName,
			serviceName: payload.serviceName,
			url: payload.url || repoUrl || "",
			branch: payload.branch,
			commitSha: payload.commitSha,
			status: transitionDeploymentStatus(effectiveDeploymentStatus, "deploy_requested"),
		});
		sendDeployConfig(payload, githubToken, session?.user?.id);
		setActiveSection("logs");
	}

	function startScan() {
		if (!repoUrl) {
			toast.error("Unable to start scan: repository URL is missing.");
			return;
		}
		setScanStartTime(Date.now());
		setScanMode("scanning");
		setActiveSection("scan");
	}

	async function prefillScanFromRepo() {
		if (!deployment.url && !activeRepo?.html_url) return;

		setIsPrefillingScan(true);
		try {
			const data = await prefillInfra(
				deployment.url || activeRepo?.html_url || "",
				effectiveBranch,
				analyzeServicePath
			);

			if (!data?.found || !data?.results) {
				toast.info("No existing Dockerfiles or compose files were found in the repository.");
				return;
			}

			if (data?.branch && data.branch !== effectiveBranch) {
				await updateDeploymentById({
				repoName: deployment.repoName || activeRepo?.name || "",
				serviceName: deployment.serviceName || serviceName || "",
				url: deployment.url || activeRepo?.html_url || "",
					branch: data.branch,
				});
			}

			setScanDuration(0);
			setScanResults(data.results);
			setScanMode("results");
			await onScanComplete(data.results, data.branch || effectiveBranch);
			// Ensure url and branch are stored for future fetches if this is a new deployment
			if (!deployment.url) {
				await updateDeploymentById({
					repoName: activeRepo?.name || "",
					serviceName: serviceName || "",
					url: activeRepo?.html_url || "",
					branch: effectiveBranch,
				});
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to prefill infrastructure";
			console.error("Prefill infrastructure error:", err);
			toast.error(message);
		} finally {
			setIsPrefillingScan(false);
		}
	}

	function onStartImproveScan(payload: FeedbackProgressPayload) {
		const fallbackFailureLogs = (deployLogEntries || [])
			.slice(-80)
			.map((entry) => `${entry.timestamp || ""} ${entry.message || ""}`.trim())
			.filter(Boolean)
			.join("\n")
			.slice(-12000);

		const resolvedCommitSha =
			payload.commitSha ||
			(payload as { commit_sha?: string } | null)?.commit_sha ||
			((deployment.scanResults as { commit_sha?: string } | null)?.commit_sha ?? undefined) ||
			(deployment.commitSha ?? undefined);

		if (!resolvedCommitSha) {
			toast.error("Cannot start feedback remediation: missing commit SHA from scan results.");
			return;
		}

		setImproveScanPayload({
			...payload,
			commitSha: resolvedCommitSha,
			packagePath: payload.packagePath || analyzeServicePath || ".",
			failedArtifactScope: payload.failedArtifactScope || "general",
			failureSummary: payload.failureSummary || deployError || undefined,
			failureLogs: payload.failureLogs || fallbackFailureLogs || undefined,
		});
		setActiveSection("scan");
	}

	async function handlePauseResumeDeployment() {
		if (!deployment.repoName || !deployment.serviceName || isChangingDeploymentState || !canPauseResumeDeployment) return;

		setIsChangingDeploymentState(true);
		try {
			await controlDeployment(pauseResumeAction, deployment.repoName, deployment.serviceName);
			await updateDeploymentById({
				repoName: deployment.repoName,
				serviceName: deployment.serviceName,
				url: deployment.url || repoUrl || "",
				status: pauseResumeNextStatus,
			});
			toast.success(
				pauseResumeNextStatus === "paused"
					? "Deployment paused"
					: "Deployment resumed"
			);
			setShowPauseResumeConfirm(false);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to update deployment";
			toast.error(message);
		} finally {
			setIsChangingDeploymentState(false);
		}
	}

	async function handleDeleteDeployment() {
		if (!deployment.repoName || !deployment.serviceName || isChangingDeploymentState) return;

		setIsChangingDeploymentState(true);
		try {
			const deletedScanResults = effectiveScanResults;
			const draftDeployment = withDeployInfraDefaults({
				id: `draft-${deployment.repoName}-${deployment.serviceName}`,
				repoName: deployment.repoName,
				serviceName: deployment.serviceName,
				url: deployment.url,
				branch: deployment.branch,
				kind: deployment.kind ?? getDeploymentKind(deployment),
				responseId: deployment.responseId ?? null,
				commitSha: null,
				envVars: deployment.envVars ?? null,
				liveUrl: null,
				screenshotUrl: null,
				status: "didnt_deploy",
				firstDeployment: null,
				lastDeployment: null,
				revision: 0,
				cloudProvider: deployment.cloudProvider,
				deploymentTarget: deployment.deploymentTarget,
				awsRegion: deployment.awsRegion,
				ec2: null,
				cloudRun: null,
				scanResults: deletedScanResults ?? deployment.scanResults ?? {},
			} as DeployConfig);
			await deleteDeployment(deployment.repoName, deployment.serviceName);
			useAppData.getState().removeDeployment(deployment.repoName, deployment.serviceName);
			await updateDeploymentById(draftDeployment);
			if (deletedScanResults && Object.keys(deletedScanResults).length > 0) {
				setScanResults(deletedScanResults as SDArtifactsResponse);
			} else {
				setScanResults(null);
			}
			toast.success("Deployment deleted. Draft restored.");
			setShowDeleteConfirm(false);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to delete deployment";
			toast.error(message);
		} finally {
			setIsChangingDeploymentState(false);
		}
	}

	function handleRollbackEntrySelect(entry: DeploymentHistoryEntry) {
		setRollbackEntry(entry);
		setShowRollbackConfirm(true);
	}

	async function handleRollbackDeployment() {
		if (!deployment.repoName || !deployment.serviceName || !rollbackEntry || isChangingDeploymentState || deploymentInProgress) return;

		setIsChangingDeploymentState(true);
		try {
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
				toast.error("GitHub is not connected. Sign in with GitHub to rollback.");
				return;
			}

			await updateDeploymentById({
				repoName: deployment.repoName,
				serviceName: deployment.serviceName,
				url: deployment.url || repoUrl || "",
				status: transitionDeploymentStatus(effectiveDeploymentStatus, "rollback_requested"),
			});
			sendRollbackRequest(deployment, rollbackEntry.id, githubToken, session?.user?.id);
			setActiveSection("logs");
			setShowRollbackConfirm(false);
			setRollbackEntry(null);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to start rollback";
			toast.error(message);
		} finally {
			setIsChangingDeploymentState(false);
		}
	}

	function renderActiveSection() {
		switch (activeSection) {
			case "scan":
				if (isDirectStatic) {
					if (!directStaticResults) {
						return (
							<div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-4 p-12 text-center">
								<div className="rounded-3xl border border-white/10 bg-card p-10">
									<h2 className="text-2xl font-bold text-foreground">Static configuration is missing</h2>
									<p className="mt-3 max-w-md text-sm text-muted-foreground">
										We expected a prefilled direct-static configuration here. Refresh service detection or reopen the workspace to rebuild it.
									</p>
								</div>
							</div>
						);
					}

					return (
						<DirectStaticConfigureView
							results={directStaticResults}
							onUpdateResults={(updated) => {
								setScanResults(updated);
								void onScanComplete(updated);
							}}
							onDeploy={() => handleDeploy()}
							deployDisabled={deployDisabled}
							deployDisabledMessage={deployDisabledMessage}
						/>
					);
				}
				if (improveScanPayload) {
					return (
						<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
							<FeedbackProgress
								payload={improveScanPayload}
								repoName={repoName}
								serviceName={serviceName ?? ""}
								onComplete={(data) => {
									setScanResults(data);
									setScanMode("results");
									onScanComplete(data);
									setImproveScanPayload(null);
									toast.success("Scan results updated");
								}}
								onCancel={() => {
									setImproveScanPayload(null);
									setScanMode(hasScanResults ? "results" : "idle");
								}}
							/>
						</div>
					);
				}
				if (scanMode === "scanning") {
					return (
						<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
							<ScanProgress
								repoUrl={repoUrl}
								packagePath={analyzeServicePath || "."}
								branch={effectiveBranch}
								repoName={repoName}
								serviceName={serviceName ?? ""}
								onComplete={(data) => {
									setScanDuration(Date.now() - scanStartTime);
									setScanResults(data);
									setScanMode("results");
									onScanComplete(data);
								}}
								onCancel={() => setScanMode("idle")}
							/>
						</div>
					);
				}
				if (scanMode === "results" || hasScanResults) {
					return (
						<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
							<PostScanResults
								key={`${deployment.repoName}:${deployment.serviceName}`}
								results={effectiveScanResults as SDArtifactsResponse}
								packagePath={analyzeServicePath}
								onUpdateResults={(updated) => {
									setScanResults(updated);
									onScanComplete(updated);
								}}
								scanTime={scanDuration}
								deployment={deployment!}
								onStartDeployment={() => handleDeploy()}
								onCancel={handleRejectScan}
								onStartImproveScan={onStartImproveScan}
							/>
						</div>
					);
				}
				return (
					<div className="w-full mx-auto p-12 flex-1 max-w-4xl text-center">
						<div className="bg-card border border-border rounded-2xl p-12 space-y-6 shadow-xl">
							<div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center">
								<Search className="size-8 text-primary" />
							</div>
							<div className="space-y-2">
								<h2 className="text-2xl font-bold">Blueprint Your Application</h2>
								<p className="text-muted-foreground max-w-md mx-auto">
									SmartDeploy analyzes your repository to automatically generate Dockerfiles,
									optimize build layers, and audit security before deployment.
								</p>
							</div>
							<div className="pt-4">
								<div className="flex flex-wrap items-center justify-center gap-3">
									<Button type="button" size="lg" onClick={startScan} className="px-8 font-bold gap-2">
										<Rocket className="size-5" />
										Start Smart Analysis
									</Button>
									<Button
										type="button"
										size="lg"
										variant="outline"
										onClick={prefillScanFromRepo}
										disabled={isPrefillingScan}
										className="px-8 font-bold gap-2"
									>
										{isPrefillingScan ? "Checking Repository..." : "Use Existing Repo Files"}
									</Button>
								</div>
							</div>
							<div className="grid grid-cols-3 gap-4 pt-8 border-t border-border/50">
								<div className="flex flex-col items-center gap-2">
									<ShieldCheck className="size-5 text-emerald-500" />
									<span className="text-xs font-medium">Security Audit</span>
								</div>
								<div className="flex flex-col items-center gap-2">
									<Layers className="size-5 text-blue-500" />
									<span className="text-xs font-medium">Auto-Layering</span>
								</div>
								<div className="flex flex-col items-center gap-2">
									<ShieldCheck className="size-5 text-purple-500" />
									<span className="text-xs font-medium">Runtime Detection</span>
								</div>
							</div>
						</div>
					</div>
				);
			case "history":
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
						{deployment && (
							<DeploymentHistory
								key={`${deployment.repoName}:${deployment.serviceName}`}
								repoName={deployment.repoName}
								serviceName={deployment.serviceName}
								prefetchedData={deploymentHistory ? { history: deploymentHistory, total: historyTotal } : null}
								isPrefetching={isLoadingHistory}
								onRollback={handleRollbackEntrySelect}
								rollbackingEntryId={isChangingDeploymentState ? rollbackEntry?.id ?? null : null}
								activeDeployment={deployment}
								activeDeploymentStatus={effectiveDeploymentStatus}
							/>
						)}
					</div>
				);
			case "blueprint":
				if (isDirectStatic) {
					return (
						<DirectStaticPreviewView
							deployment={deployment as DeployConfig}
							scanResults={effectiveScanResults as SDArtifactsResponse | null}
						/>
					);
				}
				return (
					<div className="flex h-full flex-1">
						<BlueprintView
							deployment={deployment as DeployConfig}
							scanResults={effectiveScanResults as SDArtifactsResponse | null}
							branchOptions={branchNamesFromRepo(repoRecord)}
							onUpdateDeployment={(partial) =>
								updateDeploymentById({
									repoName: deployment.repoName || repoName,
									serviceName: deployment.serviceName || currentServiceName,
									url: deployment.url || repoUrl,
									...partial,
								})
							}
							onUpdateScanResults={async (updater) => {
								const current = effectiveScanResults as SDArtifactsResponse | null;
								if (!current) return;
								const next = updater(current);
								setScanResults(next);
								await updateDeploymentById({
									repoName: deployment.repoName || repoName,
									serviceName: deployment.serviceName || currentServiceName,
									url: deployment.url || repoUrl,
									scanResults: next,
								});
							}}
						/>
					</div>
				);
			case "logs":
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl min-h-0 overflow-hidden">
						<DeployLogsView
							showDeployLogs={showDeployLogs}
							deployLogEntries={deployLogEntries}
							serviceLogs={serviceLogs}
							deployStatus={effectiveDeployStatus}
							deployError={deployError}
							deployingCommitInfo={deployingCommitInfo}
							steps={steps}
							repoNameForLogs={repoName}
							serviceNameForLogs={currentServiceName}
						configSnapshot={deployConfigRef.current ? configSnapshotFromDeployConfig(deployConfigRef.current) : configSnapshotFromDeployConfig(deployment)}
						repoUrl={deployment.url}
						commitSha={(deployment.scanResults as { commit_sha?: string } | null)?.commit_sha ?? deployment.commitSha ?? undefined}
							packagePath={analyzeServicePath}
							onStartImproveScan={onStartImproveScan}
						/>
					</div>
				);
			case "setup":
				return (
				<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
				<ConfigTabs
					repoFullName={repoIdentifier}
					branches={branchNamesFromRepo(repoRecord)}
					onConfigChange={(partial) => {
						updateDeploymentById({
						repoName: deployment.repoName || repoName,
									serviceName: deployment.serviceName || currentServiceName,
						url: deployment.url || repoUrl,
							branch: effectiveBranch,
							...partial,
						});
					}}
					deployment={deployment as DeployConfig}
					onStartScan={isDirectStatic ? undefined : startScan}
				/>
					</div>
				);
			case "overview":
			default:
				if (isDraft) {
					return (
						<div className="w-full mx-auto p-12 flex-1 max-w-4xl text-center">
							<div className="bg-card border border-border rounded-2xl p-12 space-y-6">
								<div className="mx-auto w-16 h-16 bg-muted rounded-2xl flex items-center justify-center">
									<AlertCircle className="size-8 text-muted-foreground" />
								</div>
								<div className="space-y-2">
									<h2 className="text-2xl font-bold">No deployments done yet</h2>
									<p className="text-muted-foreground max-w-md mx-auto">
										{isDirectStatic
											? "This service is currently in draft mode. Review the generated build commands and nginx settings before the direct deploy pipeline is connected."
											: "This service is currently in draft mode. Configure your environment and run a smart scan to prepare for your first deployment."}
									</p>
								</div>
								<div className="pt-4 flex items-center justify-center gap-4">
									<Button variant="outline" onClick={() => setActiveSection("setup")} className="font-bold">
										Configure Environment
									</Button>
									<Button onClick={() => setActiveSection("scan")} className="font-bold">
										{isDirectStatic ? "Review Build Plan" : "Blueprint App"}
									</Button>
								</div>
							</div>
						</div>
					);
				}
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
							{deployment && (
								<DeployOverview
									deployment={deployment}
								isDeploying={isDeploying}
								isRefreshingPreview={isRefreshingPreview}
								onRedeploy={handleDeploy}
								onRefreshPreview={handleManualCreatePreview}
								onEditConfiguration={() => { setActiveSection("setup"); }}
								onPauseResumeDeployment={() => setShowPauseResumeConfirm(true)}
								onDeleteDeployment={() => setShowDeleteConfirm(true)}
								isChangingDeploymentState={isChangingDeploymentState}
								repo={activeRepo as repoType}
								deployDisabled={deployDisabled}
								deployDisabledReason={deployDisabledMessage}
							/>
						)}
					</div>
				);
		}
	}

	const deployAction = (
		<div className="relative group">
			<Button
				disabled={!hasScanResults || isDeploying || deployDisabled || deploymentInProgress}
				onClick={() => handleDeploy()}
				className={`h-10 w-full font-bold gap-2 shadow-lg shadow-primary/20 relative overflow-hidden ${isSidebarCollapsed ? "px-0" : "px-6"}`}
				title={
					deploymentInProgress
						? "Deployment already in progress. Open logs to follow along."
						: !hasScanResults
							? deployDisabledMessage
							: (deployDisabled ? deployDisabledMessage : "")
				}
				aria-label="Deploy"
			>
				<Rocket className="size-4 relative z-10" />
				{!isSidebarCollapsed ? <span className="relative z-10">Deploy</span> : null}
			</Button>
			{(!hasScanResults || deployDisabled || deploymentInProgress) && (
				<div className={`absolute top-full mt-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 ${isSidebarCollapsed ? "left-0" : "left-0 right-0"}`}>
					<div className="bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-1 rounded shadow-lg whitespace-nowrap border border-destructive/20 text-center">
						{deploymentInProgress
							? "Deployment already in progress. Open logs to follow along."
							: !hasScanResults
								? deployDisabledMessage
								: deployDisabledMessage}
					</div>
				</div>
			)}
		</div>
	);

	if (!isLoading && !activeRepo) {
		return (
			<div className="landing-bg min-h-svh flex flex-col items-center justify-center gap-4 text-foreground">
				<p className="text-muted-foreground">Service not found</p>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-background/30 text-foreground dot-grid-bg">
			{/* Action Bar */}
			<div className="border-b border-white/5 bg-background/50 backdrop-blur-md sticky top-0 z-10 transition-all">
				<div className="mx-auto flex max-w-6xl items-center justify-end px-6 py-4 md:justify-end">
					<div className="w-full max-w-[164px] md:hidden">
						{deployAction}
					</div>
				</div>
			</div>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<aside className={`hidden h-full shrink-0 border-r border-white/6 bg-background/22 backdrop-blur-sm transition-[width] duration-200 md:block ${isSidebarCollapsed ? "w-20" : "w-60"}`}>
					<DeployWorkspaceMenu
						activeSection={activeSection}
						onChange={setActiveSection}
						footer={deployAction}
						collapsed={isSidebarCollapsed}
						onToggleCollapsed={() => setIsSidebarCollapsed((value) => !value)}
						deploymentKind={deploymentKind}
					/>
				</aside>
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<main className={activeSection === "blueprint" ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-auto stealth-scrollbar"}>
						{renderActiveSection()}
					</main>
				</div>
			</div>

			{onMobileNavOpenChange ? (
				<Sheet open={mobileNavOpen} onOpenChange={onMobileNavOpenChange}>
					<SheetContent
						side="left"
						className="z-100 flex w-[min(20rem,calc(100vw-2rem))] max-w-[20rem] flex-col gap-0 border-r border-white/10 bg-background/95 p-0 backdrop-blur-xl [&>button]:text-foreground"
					>
						<SheetTitle className="sr-only">Deploy workspace navigation</SheetTitle>
						<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
							<DeployWorkspaceMenu
								activeSection={activeSection}
								onChange={(section) => {
									setActiveSection(section);
									onMobileNavOpenChange(false);
								}}
								footer={deployAction}
								collapsed={false}
								deploymentKind={deploymentKind}
							/>
						</div>
					</SheetContent>
				</Sheet>
			) : null}

			<ConfirmDialog
				open={showRejectConfirm}
				onOpenChange={setShowRejectConfirm}
				onConfirm={handleConfirmRejectScan}
				title="Reject Analysis?"
				description="This will clear all generated infrastructure files (Dockerfiles, Docker Compose, etc.) and revert this service to its pre-scan state. This action cannot be undone."
				confirmText="Reject Analysis"
				variant="destructive"
			/>
			<ConfirmDialog
				open={showDeleteConfirm}
				onOpenChange={setShowDeleteConfirm}
				onConfirm={handleDeleteDeployment}
				title="Delete Deployment?"
				description="This permanently removes the deployment and its tracked runtime state. You can deploy again later, but this current deployment record will be deleted."
				confirmText={isChangingDeploymentState ? "Deleting..." : "Delete Deployment"}
				variant="destructive"
			/>
			<ConfirmDialog
				open={showPauseResumeConfirm}
				onOpenChange={setShowPauseResumeConfirm}
				onConfirm={handlePauseResumeDeployment}
				title={pauseResumeDialogTitle}
				description={pauseResumeDialogDescription}
				confirmText={pauseResumeConfirmText}
				variant="default"
			/>
			<ConfirmDialog
				open={showRollbackConfirm}
				onOpenChange={(open) => {
					setShowRollbackConfirm(open);
					if (!open) setRollbackEntry(null);
				}}
				onConfirm={handleRollbackDeployment}
				title="Rollback Deployment?"
				description={
					rollbackEntry?.commitSha
						? `This will redeploy the release from commit ${rollbackEntry.commitSha.slice(0, 7)} while keeping current environment variables.`
						: "This will redeploy the selected release while keeping current environment variables."
				}
				confirmText={isChangingDeploymentState ? "Rolling back..." : "Rollback Release"}
				variant="default"
			/>
		</div>
	);
}
