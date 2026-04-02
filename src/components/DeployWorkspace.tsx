"use client";

import * as React from "react";
import ConfigTabs from "@/components/ConfigTabs";
import DeploymentHistory from "@/components/DeploymentHistory";
import DeployWorkspaceMenu, { MenuSection } from "@/components/deploy-workspace/DeployWorkspaceMenu";
import DeployOverview from "@/components/deploy-workspace/DeployOverview";
import DeployLogsView, { DeployStatus } from "@/components/deploy-workspace/DeployLogsView";

import { useDeployLogs, type DeployCompleteWsPayload } from "@/custom-hooks/useDeployLogs";
import { useDeploymentBranch } from "@/custom-hooks/useDeploymentBranch";
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
import { fetchLatestCommit, prefillInfra } from "@/lib/graphqlClient";

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
	const [improveScanPayload, setImproveScanPayload] = React.useState<FeedbackProgressPayload | null>(null);

	// ============== BASIC CONTEXT ==============
	const repo = activeRepo;
	const deployment = useActiveDeployment();

	// ============== MEMOIZED DERIVED VALUES (for callbacks & hooks) ==============
	const hasStoredLiveUrl = React.useMemo(
		() => Boolean(deployment?.deployUrl || deployment?.custom_url),
		[deployment?.deployUrl, deployment?.custom_url]
	);

	const effectiveDeploymentStatus = React.useMemo(
		() => deployment?.status === "running" && !hasStoredLiveUrl ? "didnt_deploy" : (deployment?.status ?? "didnt_deploy"),
		[deployment?.status, hasStoredLiveUrl]
	);

	const workingDeployment = React.useMemo<DeployConfig | null>(() => {
		if (!repo?.name || !serviceName) return null;
		const base: DeployConfig = {
			id: deployment?.id ?? "",
			repo_name: repo.name,
			service_name: serviceName,
			url: deployment?.url ?? repo.html_url ?? "",
			branch: "",
			status: deployment?.status ?? "didnt_deploy",
		};
		const merged = { ...base, ...(deployment as Partial<DeployConfig> | undefined) } as DeployConfig;
		merged.url = merged.url ?? base.url ?? "";
		return merged;
	}, [deployment, repo, serviceName]);

	// ============== CALLBACKS ==============
	const onDeployFinishedCallback = React.useCallback(
		(p: DeployCompleteWsPayload) => {
			if (p.success) {
				const url = p.customUrl || p.deployUrl;
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

			if (!p.success && p.ec2?.instanceId?.trim() && repo?.name && serviceName) {
				void updateDeploymentById({
					repo_name: repo.name,
					service_name: serviceName,
					ec2: p.ec2,
					...(p.deploymentTarget && {
						deploymentTarget: p.deploymentTarget as DeployConfig["deploymentTarget"],
					}),
					status: "failed",
				});
			}
		},
		[repo?.name, serviceName, updateDeploymentById]
	);

	// ============== CUSTOM HOOKS ==============
	const { effectiveBranch, persistCorrectedBranch } = useDeploymentBranch({
		repo,
		deployment,
		serviceName: serviceName || "",
		onUpdateBranch: async (branch: string) => {
			if (!repo?.name || !serviceName) return;
			await updateDeploymentById({
				repo_name: repo.name,
				service_name: serviceName,
				url: deployment?.url || "",
				branch,
			});
		},
	});

	const { steps, sendDeployConfig, deployConfigRef, deployStatus, deployError, serviceLogs, deployLogEntries } =
		useDeployLogs(deployment?.service_name ?? serviceName ?? repo?.name, repo?.name ?? deployment?.repo_name, { onDeployFinished: onDeployFinishedCallback });

	const { history: deploymentHistory, total: historyTotal, isLoading: isLoadingHistory } = useDeploymentHistoryWithSync({
		repoName: repo?.name,
		serviceName: serviceName || "",
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
		repoName: repo?.name,
		workspaceState: workspaceDeployState,
	});

	const { isRefreshing: isRefreshingPreview, refreshScreenshot: handleManualCreatePreview } = usePreviewScreenshot({
		repoName: repo?.name,
		serviceName: serviceName || "",
		screenshotUrl: deployment?.screenshot_url,
		deploymentStatus: effectiveDeploymentStatus,
		hasStoredLiveUrl: hasStoredLiveUrl,
		onDeploymentsRefetch: async (repo: string) => {
			await fetchRepoDeployments(repo);
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

	// Memoize to prevent unnecessary re-renders of child components
	const serviceNameForLogs = React.useMemo(
		() => deployment?.service_name ?? serviceName ?? repo?.name,
		[deployment?.service_name, serviceName, repo?.name]
	);

	const repoNameForLogs = React.useMemo(
		() => repo?.name ?? deployment?.repo_name,
		[repo?.name, deployment?.repo_name]
	);

	const analyzeServicePath = React.useMemo(() => {
		if (!repo?.html_url || !serviceName || serviceName === ".") return undefined;
		const fromList = (list: DetectedServiceInfo[] | undefined) => {
			const svc = list?.find((s) => s.name === serviceName);
			return repoRelativeServicePath(svc?.path);
		};
		const cached = fromList(getDetectedRepoCache(repo.html_url)?.services);
		if (cached) return cached;
		const norm = normalizeRepoUrl(repo.html_url);
		const record = repoServices.find((r) => normalizeRepoUrl(r.repo_url) === norm);
		return fromList(record?.services);
	}, [repo?.html_url, serviceName, getDetectedRepoCache, repoServices]);

	const hasScanResults = React.useMemo(
		() => Boolean(deployment?.scan_results || scanResults),
		[deployment?.scan_results, scanResults]
	);

	const effectiveScanResults = React.useMemo(
		() => (scanResults || deployment?.scan_results || null),
		[scanResults, deployment?.scan_results]
	);

	const deployDisabled = React.useMemo(
		() => isDeploymentDisabled({ ...(workingDeployment || {}), scan_results: effectiveScanResults } as DeployConfig),
		[workingDeployment, effectiveScanResults]
	);

	const isDraft = React.useMemo(
		() => !deployment || effectiveDeploymentStatus === "didnt_deploy",
		[deployment, effectiveDeploymentStatus]
	);

	// ============== EFFECTS ==============
	// Persist corrected branch when branch from DB doesn't exist on remote
	React.useEffect(() => {
		void persistCorrectedBranch();
	}, [persistCorrectedBranch]);

	// Handle deployment completion - update UI state after deploy succeeds or fails
	React.useEffect(() => {
		if (deployStatus === "success" && deployConfigRef.current) {
			setIsDeploying(false);
			setDeployingCommitInfo(null);
			upsertDeploymentAfterDeploy(deployConfigRef.current);
		}
		if (deployStatus === "error") {
			setIsDeploying(false);
			setDeployingCommitInfo(null);
		}
	}, [deployStatus, deployment?.id]);

	async function upsertDeploymentAfterDeploy(config: DeployConfig) {
		const now = new Date().toISOString();
		const next: DeployConfig = {
			...config,
			first_deployment: deployment?.first_deployment ?? now,
			last_deployment: now,
			revision: deployment?.revision ? deployment.revision + 1 : 1,
		};
		await updateDeploymentById(next);
	}

	async function onScanComplete(results: SDArtifactsResponse) {
		if (!session?.user || !repo?.name || !serviceName) return;

		await updateDeploymentById({
			repo_name: repo.name,
			service_name: serviceName,
			url: workingDeployment?.url || "",
			branch: effectiveBranch || "main",
			scan_results: results,
		});
		setScanResults(results);
		setScanMode("results");
		toast.success("Scan saved to configuration");
	}

	async function handleConfirmRejectScan() {
		if (!workingDeployment) return;

		// 1. Clear backend cache
		try {
			await fetch("/api/cache", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					repo_url: workingDeployment.url,
					commit_sha: workingDeployment.scan_results?.commit_sha || workingDeployment.commitSha,
				}),
			});
		} catch (err) {
			console.error("Failed to clear backend cache:", err);
		}

		// 2. Clear frontend state and DB (must send explicit null so DB helper clears persisted scan_results)
		await updateDeploymentById({
			repo_name: workingDeployment.repo_name,
			service_name: workingDeployment.service_name,
			scan_results: null as unknown as SDArtifactsResponse,
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
		if (!token || !workingDeployment || !repo) {
			return console.log("Unauthenticated or missing deploy context");
		}
		if (deployDisabled) {
			toast.error("Deployment requires at least one Dockerfile and nginx.conf.");
			return;
		}

		const payload: DeployConfig = {
			...workingDeployment,
			branch: effectiveBranch,
			scan_results: effectiveScanResults || workingDeployment.scan_results,
			...(commitSha && { commitSha }),
		};

		const ownerFromUrl = payload.url?.match(/github\.com[/]([^/]+)/)?.[1];
		const repoNameFromUrl = payload.url?.split("/").filter(Boolean).pop()?.replace(/\.git$/, "");
		const owner = repo.owner?.login ?? ownerFromUrl;
		const repoName = repo.name ?? repoNameFromUrl;

		if (owner && repoName) {
			fetchLatestCommit(owner, repoName, payload.branch)
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
		if (!workingDeployment?.url) return;

		setIsPrefillingScan(true);
		try {
			const data = await prefillInfra(
				workingDeployment.url,
				effectiveBranch,
				analyzeServicePath
			);

			if (!data?.found || !data?.results) {
				toast.info("No existing Dockerfiles or compose files were found in the repository.");
				return;
			}

			if (data?.branch && data.branch !== effectiveBranch) {
				await updateDeploymentById({
					repo_name: workingDeployment.repo_name,
					service_name: workingDeployment.service_name,
					url: workingDeployment.url,
					branch: data.branch,
				});
			}

			setScanDuration(0);
			setScanResults(data.results);
			setScanMode("results");
			await onScanComplete(data.results);
			// Ensure url and branch are stored for future fetches if this is a new deployment
			if (!deployment) {
				await updateDeploymentById({
					repo_name: workingDeployment.repo_name,
					service_name: workingDeployment.service_name,
					url: workingDeployment.url,
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
								repoFullName={repo?.full_name ?? ""}
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
								results={effectiveScanResults as SDArtifactsResponse}
								onUpdateResults={(updated) => {
									setScanResults(updated);
									onScanComplete(updated);
								}}
								scanTime={scanDuration}
								deployment={workingDeployment!}
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
						{workingDeployment && (
							<DeploymentHistory
								repoName={workingDeployment.repo_name}
								serviceName={workingDeployment.service_name}
								prefetchedData={deploymentHistory ? { history: deploymentHistory, total: historyTotal } : null}
								isPrefetching={isLoadingHistory}
							/>
						)}
					</div>
				);
			case "logs":
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
						<DeployLogsView
							showDeployLogs={showDeployLogs}
							deployLogEntries={deployLogEntries}
							serviceLogs={serviceLogs}
							deployStatus={effectiveDeployStatus}
							deployError={deployError}
							deployingCommitInfo={deployingCommitInfo}
							steps={steps}
							repoNameForLogs={repoNameForLogs}
							serviceNameForLogs={serviceNameForLogs}
							configSnapshot={deployConfigRef.current ? configSnapshotFromDeployConfig(deployConfigRef.current) : (workingDeployment ? configSnapshotFromDeployConfig(workingDeployment) : {})}
							repoUrl={workingDeployment?.url}
							commitSha={workingDeployment?.scan_results?.commit_sha ?? workingDeployment?.commitSha}
							onStartImproveScan={onStartImproveScan}
						/>
					</div>
				);
			case "setup":
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
						{workingDeployment && (
							<ConfigTabs
								repoFullName={repo?.full_name ?? ""}
								branches={branchNamesFromRepo(repo ?? null)}
								onConfigChange={(partial) => {
									updateDeploymentById({
										repo_name: workingDeployment.repo_name,
										service_name: workingDeployment.service_name,
										url: workingDeployment.url,
										branch: effectiveBranch,
										...partial,
									});
								}}
								deployment={workingDeployment}
								onStartScan={startScan}
							/>
						)}
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
						{workingDeployment && (
							<DeployOverview
								deployment={workingDeployment}
								isDeploying={isDeploying}
								isRefreshingPreview={isRefreshingPreview}
								onRedeploy={handleDeploy}
								onRefreshPreview={handleManualCreatePreview}
								onEditConfiguration={() => { setActiveSection("setup"); }}
								repo={repo as repoType}
							/>
						)}
					</div>
				);
		}
	}

	if (!isLoading && !repo) {
		return (
			<div className="landing-bg min-h-svh flex flex-col items-center justify-center gap-4 text-foreground">
				<p className="text-muted-foreground">Service not found</p>
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col text-foreground min-h-0 bg-background/30 dot-grid-bg">
			{/* Action Bar */}
			<div className="border-b border-white/5 bg-background/50 backdrop-blur-md sticky top-0 z-10 transition-all">
				<div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
					<div className="flex items-center gap-4 overflow-hidden">
						<div className="flex items-center gap-2 text-sm font-semibold tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
							<span className="text-muted-foreground/60">{repo?.name ?? ""}</span>
							<span className="text-border">/</span>
							<span className="text-foreground">{serviceName ?? ""}</span>
						</div>
					</div>

					<div className="flex items-center gap-3">
						<div className="relative group">
							<Button
								disabled={!hasScanResults || isDeploying || deployDisabled}
								onClick={() => handleDeploy()}
								className="h-9 px-6 font-bold gap-2 shadow-lg shadow-primary/20 relative overflow-hidden"
								title={!hasScanResults ? "Run smart scan first" : (deployDisabled ? "At least one Dockerfile and nginx.conf are required" : "")}
							>
								<Rocket className="size-4 relative z-10" />
								<span className="relative z-10">Deploy</span>
							</Button>
							{(!hasScanResults || deployDisabled) && (
								<div className="absolute top-full right-0 mt-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
									<div className="bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-1 rounded shadow-lg whitespace-nowrap border border-destructive/20">
										{!hasScanResults ? "Run smart scan first" : "Need Dockerfile and nginx.conf"}
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>

			<DeployWorkspaceMenu
				activeSection={activeSection}
				onChange={setActiveSection}
			/>

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

			<main className="flex-1 overflow-auto stealth-scrollbar">
				{renderActiveSection()}
			</main>

			<ConfirmDialog
				open={showRejectConfirm}
				onOpenChange={setShowRejectConfirm}
				onConfirm={handleConfirmRejectScan}
				title="Reject Analysis?"
				description="This will clear all generated infrastructure files (Dockerfiles, Docker Compose, etc.) and revert this service to its pre-scan state. This action cannot be undone."
				confirmText="Reject Analysis"
				variant="destructive"
			/>
		</div>
	);
}
