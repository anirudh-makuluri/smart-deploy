"use client";

import * as React from "react";
import ConfigTabs from "@/components/ConfigTabs";
import DeploymentHistory from "@/components/DeploymentHistory";
import DeployWorkspaceMenu, { MenuSection } from "@/components/deploy-workspace/DeployWorkspaceMenu";
import DeployOverview from "@/components/deploy-workspace/DeployOverview";
import DeployLogsView, { DeployStatus } from "@/components/deploy-workspace/DeployLogsView";
import BlueprintView from "@/components/blueprint/BlueprintView";

import { useDeployLogs, type DeployCompleteWsPayload } from "@/custom-hooks/useDeployLogs";

import { useDeploymentHistoryWithSync } from "@/custom-hooks/useDeploymentHistoryWithSync";
import { useDocumentTitleSync } from "@/custom-hooks/useDocumentTitleSync";
import { useDeploymentTimer } from "@/custom-hooks/useDeploymentTimer";
import { usePreviewScreenshot } from "@/custom-hooks/usePreviewScreenshot";
import { useActiveDeployment } from "@/custom-hooks/useActiveDeployment";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { DeployConfig, DetectedServiceInfo, repoType, SDArtifactsResponse } from "@/app/types";
import { configSnapshotFromDeployConfig, isDeploymentDisabled, normalizeRepoUrl } from "@/lib/utils";
import { branchNamesFromRepo } from "@/lib/repoBranch";
import { useAppData } from "@/store/useAppData";
import { Clock, Rocket, Search, ShieldCheck, AlertCircle, Trash2, Layers } from "lucide-react";
import ScanProgress from "@/components/ScanProgress";
import FeedbackProgress, { type FeedbackProgressPayload } from "@/components/FeedbackProgress";
import PostScanResults from "@/components/PostScanResults";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { controlDeployment, deleteDeployment, fetchLatestCommit, prefillInfra } from "@/lib/graphqlClient";

function repoRelativeServicePath(path: string | undefined): string | undefined {
	const p = path?.trim().replace(/^\.\/+/, "").replace(/\/+$/, "") ?? "";
	if (!p || p === ".") return undefined;
	return p;
}

export default function DeployWorkspace() {
	// ============== STORE SELECTIONS ==============
	const updateDeploymentById = useAppData((s) => s.updateDeploymentById);
	const activeRepo = useAppData((s) => s.activeRepo);
	const serviceName = useAppData((s) => s.activeServiceName);
	const isLoading = useAppData((s) => s.isLoading);
	const fetchRepoDeployments = useAppData((s) => s.fetchRepoDeployments);
	const getDetectedRepoCache = useAppData((s) => s.getDetectedRepoCache);
	const repoServices = useAppData((s) => s.repoServices);
	const { data: session } = useSession();
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
	const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
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
		() => deployment.status === "running" && !hasStoredLiveUrl ? "didnt_deploy" : (deployment.status ?? "didnt_deploy"),
		[deployment.status, hasStoredLiveUrl]
	);

	// ============== CALLBACKS ==============
	const onDeployFinishedCallback = React.useCallback(
		(p: DeployCompleteWsPayload) => {
			setIsDeploying(false);
			const ec2 = p.ec2 as { instanceId?: string } | null;
			if (p.success) {
				const url = p.customUrl || p.deployUrl;
				toast.success("Deployment successful", {
					description: url ? `Live at ${url}` : "Your application is now running.",
					duration: 8000,
				});

				if (repoName && serviceName) {
					void updateDeploymentById({
						repoName,
						serviceName,
						url: deployment.url || repoUrl || "",
						status: "running",
						lastDeployment: new Date().toISOString(),
						liveUrl: url || deployment.liveUrl || null,
						...(p.ec2 != null ? { ec2: p.ec2 } : {}),
						...(p.deploymentTarget && {
							deploymentTarget: p.deploymentTarget as DeployConfig["deploymentTarget"],
						}),
					});
					void fetchRepoDeployments(repoIdentifier);
				}
			} else {
				toast.error("Deployment failed", {
					description: p.error || "Check the deploy logs for details.",
					duration: 10000,
				});
			}

			if (!p.success && ec2?.instanceId && repoName && serviceName) {
				void updateDeploymentById({
					repoName,
					serviceName: serviceName,
					ec2: p.ec2,
					...(p.deploymentTarget && {
						deploymentTarget: p.deploymentTarget as DeployConfig["deploymentTarget"],
					}),
					status: "failed",
				});
			}
		},
		[deployment.liveUrl, deployment.url, fetchRepoDeployments, repoIdentifier, repoName, repoUrl, serviceName, updateDeploymentById]
	);

	const effectiveBranch = React.useMemo(
		() => deployment.branch || defaultBranch,
		[deployment.branch, defaultBranch]
	);

	const { steps, sendDeployConfig, deployConfigRef, deployStatus, deployError, serviceLogs, deployLogEntries } =
		useDeployLogs(serviceName ?? "", repoName, { onDeployFinished: onDeployFinishedCallback });

	const { history: deploymentHistory, total: historyTotal, isLoading: isLoadingHistory } = useDeploymentHistoryWithSync({
		repoName,
		serviceName: serviceName ?? "",
		deployStatus: deployStatus,
	});

	const { elapsedSeconds: elapsedTime, formattedTime } = useDeploymentTimer({
		isActive: isDeploying || deployStatus === "running" || deployStatus === "error",
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
		() => isDeploying || deployStatus === "running" || deployStatus === "error",
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
		const cached = fromList(getDetectedRepoCache(repoUrl)?.services);
		if (cached) return cached;
		const norm = normalizeRepoUrl(repoUrl);
		const record = repoServices.find((r) => normalizeRepoUrl(r.repo_url) === norm);
		return fromList(record?.services);
		}, 
	[repoUrl, serviceName, getDetectedRepoCache, repoServices]);


	const effectiveScanResults = React.useMemo(
		() => (scanResults || deployment.scanResults || null),
		[scanResults, deployment.scanResults]
	);

	const hasScanResults = React.useMemo(
		() => Object.keys(effectiveScanResults || {}).length > 0,
		[effectiveScanResults]
	);

	const deployDisabled = React.useMemo(
		() => isDeploymentDisabled({ ...deployment, scanResults: effectiveScanResults } as DeployConfig),
		[deployment, effectiveScanResults]
	);

	const isDraft = React.useMemo(
		() => effectiveDeploymentStatus === "didnt_deploy",
		[effectiveDeploymentStatus]
	);

	React.useEffect(() => {
		const deploymentKey = `${deployment.repoName}:${deployment.serviceName}:${deployment.id}`;
		if (lastResolvedDeploymentKeyRef.current === deploymentKey) return;
		lastResolvedDeploymentKeyRef.current = deploymentKey;
		setActiveSection(isDraft ? "setup" : "overview");
	}, [deployment.id, deployment.repoName, deployment.serviceName, isDraft]);

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
			scanResults: results,
		});
		setScanResults(results);
		setScanMode("results");
		toast.success("Scan saved to configuration");
	}

	async function handleConfirmRejectScan() {
		if (!deployment.repoName || !deployment.serviceName) return;

		try {
			const scanResults = deployment.scanResults as { commit_sha?: string } | null;
			await fetch("/api/cache", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					repo_url: deployment.url,
					commit_sha: scanResults?.commit_sha || deployment.commitSha,
				}),
			});
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
		const token = session?.accessToken;
		if (!token || !activeRepo || !deployment.repoName || !deployment.serviceName) {
			return console.log("Unauthenticated or missing deploy context");
		}
		if (deployDisabled) {
			toast.error("Deployment requires at least one Dockerfile and nginx.conf.");
			return;
		}

		const payload: DeployConfig = {
			...deployment,
			branch: effectiveBranch,
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

		setIsDeploying(true);
		sendDeployConfig(payload, token!, session?.userID);
		setActiveSection("logs");
	}

	function startScan() {
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
		setImproveScanPayload(payload);
		setActiveSection("scan");
	}

	async function handlePauseResumeDeployment() {
		if (!deployment.repoName || !deployment.serviceName || isChangingDeploymentState) return;

		const isPaused = deployment.status === "paused";
		const action = isPaused ? "resume" : "pause";
		const nextStatus: DeployConfig["status"] = isPaused ? "running" : "paused";

		setIsChangingDeploymentState(true);
		try {
			await controlDeployment(action, deployment.repoName, deployment.serviceName);
			await updateDeploymentById({
				repoName: deployment.repoName,
				serviceName: deployment.serviceName,
				url: deployment.url || repoUrl || "",
				status: nextStatus,
			});
			toast.success(
				nextStatus === "paused"
					? "Deployment paused"
					: "Deployment resumed"
			);
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
			await deleteDeployment(deployment.repoName, deployment.serviceName);
			useAppData.getState().removeDeployment(deployment.repoName, deployment.serviceName);
			toast.success("Deployment deleted.");
			setShowDeleteConfirm(false);
			setActiveSection("setup");
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to delete deployment";
			toast.error(message);
		} finally {
			setIsChangingDeploymentState(false);
		}
	}

	function renderActiveSection() {
		switch (activeSection) {
			case "scan":
				if (improveScanPayload) {
					return (
						<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
							<FeedbackProgress
								payload={improveScanPayload}
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
								repoFullName={repoIdentifier}
								packagePath={analyzeServicePath}
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
									<Button size="lg" onClick={startScan} className="px-8 font-bold gap-2">
										<Rocket className="size-5" />
										Start Smart Analysis
									</Button>
									<Button
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
							/>
						)}
					</div>
				);
			case "blueprint":
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
					onStartScan={startScan}
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
										This service is currently in draft mode. Configure your environment
										and run a smart scan to prepare for your first deployment.
									</p>
								</div>
								<div className="pt-4 flex items-center justify-center gap-4">
									<Button variant="outline" onClick={() => setActiveSection("setup")} className="font-bold">
										Configure Environment
									</Button>
									<Button onClick={() => setActiveSection("scan")} className="font-bold">
										Blueprint App
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
								onPauseResumeDeployment={handlePauseResumeDeployment}
								onDeleteDeployment={() => setShowDeleteConfirm(true)}
								isChangingDeploymentState={isChangingDeploymentState}
								repo={activeRepo as repoType}
							/>
						)}
					</div>
				);
		}
	}

	const deployAction = (
		<div className="relative group">
			<Button
				disabled={!hasScanResults || isDeploying || deployDisabled}
				onClick={() => handleDeploy()}
				className={`h-10 w-full font-bold gap-2 shadow-lg shadow-primary/20 relative overflow-hidden ${isSidebarCollapsed ? "px-0" : "px-6"}`}
				title={!hasScanResults ? "Run smart scan first" : (deployDisabled ? "At least one Dockerfile and nginx.conf are required" : "")}
				aria-label="Deploy"
			>
				<Rocket className="size-4 relative z-10" />
				{!isSidebarCollapsed ? <span className="relative z-10">Deploy</span> : null}
			</Button>
			{(!hasScanResults || deployDisabled) && (
				<div className={`absolute top-full mt-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 ${isSidebarCollapsed ? "left-0" : "left-0 right-0"}`}>
					<div className="bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-1 rounded shadow-lg whitespace-nowrap border border-destructive/20 text-center">
						{!hasScanResults ? "Run smart scan first" : "Need Dockerfile and nginx.conf"}
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

			{isDeploying && deployingCommitInfo && (
				<div className="mx-auto mt-6 w-full max-w-6xl px-6 animate-in slide-in-from-top-4 duration-500">
					<div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm flex items-center justify-between group hover:border-primary/40 transition-colors">
						<div className="flex flex-col gap-1">
							<div className="flex items-center gap-2">
								<div className="size-2 rounded-full bg-primary animate-pulse" />
								<span className="font-bold text-foreground">Deploying commit: {deployingCommitInfo.sha.substring(0, 7)}</span>
							</div>
							<div className="font-medium text-muted-foreground truncate max-w-md">{deployingCommitInfo.message.split("\n")[0]}</div>
						</div>
						<div className="flex items-center gap-4">
							{elapsedTime > 0 && (
								<div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-background/50 font-mono text-xs tabular-nums">
									<Clock className="size-4 text-muted-foreground" />
									{formattedTime}
								</div>
							)}
							<Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
								<Trash2 className="size-4" />
							</Button>
						</div>
					</div>
				</div>
			)}

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<aside className={`hidden h-full shrink-0 border-r border-white/6 bg-background/22 backdrop-blur-sm transition-[width] duration-200 md:block ${isSidebarCollapsed ? "w-20" : "w-60"}`}>
					<DeployWorkspaceMenu
						activeSection={activeSection}
						onChange={setActiveSection}
						footer={deployAction}
						collapsed={isSidebarCollapsed}
						onToggleCollapsed={() => setIsSidebarCollapsed((value) => !value)}
					/>
				</aside>
				<div className="flex min-w-0 min-h-0 flex-1 flex-col">
					<div className="border-b border-white/5 px-4 py-3 md:hidden">
						<DeployWorkspaceMenu
							activeSection={activeSection}
							onChange={setActiveSection}
						/>
					</div>
					<main className={activeSection === "blueprint" ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-auto stealth-scrollbar"}>
						{renderActiveSection()}
					</main>
				</div>
			</div>

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
		</div>
	);
}
