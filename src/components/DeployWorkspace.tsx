"use client";

import * as React from "react";
import ConfigTabs from "@/components/ConfigTabs";
import DeploymentHistory from "@/components/DeploymentHistory";
import DeployWorkspaceMenu, { MenuSection } from "@/components/deploy-workspace/DeployWorkspaceMenu";
import DeployOverview from "@/components/deploy-workspace/DeployOverview";
import DeployLogsView, { DeployStatus } from "@/components/deploy-workspace/DeployLogsView";

import { useDeployLogs, type DeployCompleteWsPayload } from "@/custom-hooks/useDeployLogs";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { DeployConfig, DetectedServiceInfo, repoType, SDArtifactsResponse } from "@/app/types";
import { configSnapshotFromDeployConfig, isDeploymentDisabled, normalizeRepoUrl } from "@/lib/utils";
import { branchNamesFromRepo, resolveWorkspaceBranch } from "@/lib/repoBranch";
import { useAppData } from "@/store/useAppData";
import { Clock, Rocket, Search, ShieldCheck, AlertCircle, Trash2, Layers } from "lucide-react";
import ScanProgress from "@/components/ScanProgress";
import FeedbackProgress, { type FeedbackProgressPayload } from "@/components/FeedbackProgress";
import PostScanResults from "@/components/PostScanResults";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

function repoRelativeServicePath(path: string | undefined): string | undefined {
	const p = path?.trim().replace(/^\.\/+/, "").replace(/\/+$/, "") ?? "";
	if (!p || p === ".") return undefined;
	return p;
}

type WorkspaceDeployState = "idle" | "running" | "success" | "error";

export default function DeployWorkspace() {
	const deployments = useAppData((s) => s.deployments);
	const updateDeploymentById = useAppData((s) => s.updateDeploymentById);
	const activeRepo = useAppData((s) => s.activeRepo);
	const serviceName = useAppData((s) => s.activeServiceName);
	const isLoading = useAppData((s) => s.isLoading);
	const fetchRepoDeployments = useAppData((s) => s.fetchRepoDeployments);
	const getDetectedRepoCache = useAppData((s) => s.getDetectedRepoCache);
	const repoServices = useAppData((s) => s.repoServices);
	const { data: session } = useSession();
	const isDemoMode = session?.accountMode === "demo";
	const repo = activeRepo;
	const deployment = React.useMemo(() => {
		if (!repo?.name || !serviceName) return undefined;
		return deployments.find(
			(dep) => dep.repo_name === repo.name && dep.service_name === serviceName
		);
	}, [deployments, repo?.name, serviceName]);

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
		// Spread from DB overwrites branch with stale values (e.g. "main"); reconcile against remote branches last.
		merged.branch = resolveWorkspaceBranch(repo, merged.branch);
		return merged;
	}, [deployment, repo, serviceName]);

	/** Monorepo package root for the active service; sent to /analyze as package_path. */
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

	// Persist corrected branch when DB had a name that does not exist on the remote (e.g. legacy "main").
	React.useEffect(() => {
		if (!repo?.name || !serviceName || !deployment) return;
		const names = branchNamesFromRepo(repo);
		if (names.length === 0) return;
		const stored = deployment.branch?.trim() ?? "";
		if (!stored) return;
		if (names.includes(stored)) return;
		const next = resolveWorkspaceBranch(repo, deployment.branch);
		if (next && next !== stored) {
			void updateDeploymentById({
				repo_name: repo.name,
				service_name: serviceName,
				branch: next,
			});
		}
	}, [repo, serviceName, deployment, updateDeploymentById]);

	React.useEffect(() => {
		if (!isDemoMode || !repo?.name || !serviceName) return;
		const resolvedBranch = resolveWorkspaceBranch(repo, "");
		const hasDemoDefaults =
			deployment?.url === repo.html_url &&
			(deployment?.branch ?? "") === resolvedBranch &&
			deployment?.accountMode === "demo";
		if (hasDemoDefaults) return;
		void updateDeploymentById({
			repo_name: repo.name,
			service_name: serviceName,
			url: repo.html_url,
			branch: resolvedBranch,
			accountMode: "demo",
		});
	}, [isDemoMode, repo, serviceName, deployment, updateDeploymentById]);

	const hasStoredLiveUrl = Boolean(deployment?.deployUrl || deployment?.custom_url);
	const effectiveDeploymentStatus =
		deployment?.status === "running" && !hasStoredLiveUrl ? "didnt_deploy" : (deployment?.status ?? "didnt_deploy");

	const screenshotUrl = deployment?.screenshot_url;
	const [didRequestScreenshot, setDidRequestScreenshot] = React.useState(false);
	const [isRefreshingPreview, setIsRefreshingPreview] = React.useState(false);

	const [isDeploying, setIsDeploying] = React.useState(false);
	const [deployingCommitInfo, setDeployingCommitInfo] = React.useState<{ sha: string; message: string; author: string; date: string } | null>(null);
	const [activeSection, setActiveSection] = React.useState<MenuSection>(effectiveDeploymentStatus !== "didnt_deploy" ? "overview" : "setup");
	const [deploymentHistory, setDeploymentHistory] = React.useState<unknown[] | null>(null);
	const [isLoadingHistory, setIsLoadingHistory] = React.useState(false);
	const prevDeployStatusForHistoryRef = React.useRef<
		"not-started" | "running" | "success" | "error" | undefined
	>(undefined);
	const [elapsedTime, setElapsedTime] = React.useState(0);
	const initialTitleRef = React.useRef<string | null>(null);
	const initialIconHrefRef = React.useRef<string | null>(null);

	// Scan state
	const [scanMode, setScanMode] = React.useState<"idle" | "scanning" | "results">("idle");
	const [scanResults, setScanResults] = React.useState<SDArtifactsResponse | null>(null);
	const [scanStartTime, setScanStartTime] = React.useState<number>(0);
	const [scanDuration, setScanDuration] = React.useState<number>(0);
	const [isPrefillingScan, setIsPrefillingScan] = React.useState(false);
	const [showRejectConfirm, setShowRejectConfirm] = React.useState(false);
	const [improveScanPayload, setImproveScanPayload] = React.useState<FeedbackProgressPayload | null>(null);

	const serviceNameForLogs = deployment?.service_name ?? serviceName ?? repo?.name;
	const repoNameForLogs = repo?.name ?? deployment?.repo_name;

	const onDeployFinished = React.useCallback(
		(p: DeployCompleteWsPayload) => {
			if (p.success) {
				const url = p.customUrl || p.deployUrl;
				toast.success("Deployment successful", {
					description: isDemoMode
						? `Live at ${url || "your demo URL"}. This demo auto-deletes in 10 minutes.`
						: url ? `Live at ${url}` : "Your application is now running.",
					duration: 8000,
				});
				if (repo?.name && serviceName) {
					void updateDeploymentById({
						repo_name: repo.name,
						service_name: serviceName,
						status: "running",
						...(p.deployUrl ? { deployUrl: p.deployUrl } : {}),
						...(p.customUrl ? { custom_url: p.customUrl } : {}),
						...(p.demoExpiresAt ? { demoExpiresAt: p.demoExpiresAt } : {}),
						...(p.ec2 ? { ec2: p.ec2 } : {}),
					});
				}
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
		[isDemoMode, repo?.name, serviceName, updateDeploymentById]
	);

	const { steps, sendDeployConfig, deployConfigRef, deployStatus, deployError, serviceLogs, deployLogEntries } =
		useDeployLogs(serviceNameForLogs, repoNameForLogs, { onDeployFinished });
	const showDeployLogs = (isDeploying || deployStatus === "running" || deployStatus === "error");
	const effectiveDeployStatus: DeployStatus = deployStatus === "not-started" ? "not-started" :
		deployStatus === "running" ? "running" :
			deployStatus === "success" ? "success" :
				deployStatus === "error" ? "error" : "not-started";

	const workspaceDeployState = React.useMemo<WorkspaceDeployState>(() => {
		if (isDeploying || deployStatus === "running") return "running";
		if (deployStatus === "success") return "success";
		if (deployStatus === "error") return "error";
		return "idle";
	}, [deployStatus, isDeploying]);

	const pageTitleLabel = repo?.name ?? "Smart Deploy";
	const statusTitle = React.useMemo(() => {
		if (workspaceDeployState === "running") return `${pageTitleLabel} - Deploying...`;
		if (workspaceDeployState === "success") return `${pageTitleLabel} - Deployment succeeded`;
		if (workspaceDeployState === "error") return `${pageTitleLabel} - Deployment failed`;
		return pageTitleLabel === "Smart Deploy" ? "Smart Deploy" : `${pageTitleLabel} - Smart Deploy`;
	}, [workspaceDeployState, pageTitleLabel]);

	React.useEffect(() => {
		if (typeof document === "undefined") return;
		if (initialTitleRef.current === null) {
			initialTitleRef.current = document.title;
		}
		document.title = statusTitle;
	}, [statusTitle]);

	React.useEffect(() => {
		if (typeof document === "undefined") return;
		let iconLink = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
		if (!iconLink) {
			iconLink = document.createElement("link");
			iconLink.setAttribute("rel", "icon");
			document.head.appendChild(iconLink);
		}
		if (initialIconHrefRef.current === null) {
			initialIconHrefRef.current = iconLink.getAttribute("href") ?? "/icon.svg";
		}
		const targetHref =
			workspaceDeployState === "running"
				? "/icons/favicon-deploying.svg"
				: workspaceDeployState === "success"
					? "/icons/favicon-success.svg"
					: workspaceDeployState === "error"
						? "/icons/favicon-failed.svg"
						: initialIconHrefRef.current;
		if (iconLink.getAttribute("href") !== targetHref) {
			iconLink.setAttribute("href", targetHref);
		}
	}, [workspaceDeployState]);

	React.useEffect(() => {
		return () => {
			if (typeof document === "undefined") return;
			if (initialTitleRef.current) {
				document.title = initialTitleRef.current;
			}
			const iconLink = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
			if (iconLink && initialIconHrefRef.current) {
				iconLink.setAttribute("href", initialIconHrefRef.current);
			}
		};
	}, []);

	// Timer effect - starts when deployment begins
	React.useEffect(() => {
		if (!showDeployLogs || deployStatus === "not-started") {
			setElapsedTime(0);
			return;
		}

		const interval = setInterval(() => {
			setElapsedTime(prev => prev + 1);
		}, 1000);

		// Reset timer when deployment completes
		if (deployStatus === "success" || deployStatus === "error") {
			clearInterval(interval);
		}

		return () => clearInterval(interval);
	}, [showDeployLogs, deployStatus]);

	const requestPreviewScreenshot = React.useCallback(
		async (force = false) => {
			if (!repo?.name || !serviceName) return;
			try {
				const res = await fetch("/api/deployment-preview-screenshot", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ repoName: repo.name, serviceName, force }),
				});
				const data = await res.json();
				if (!res.ok) {
					console.error("Screenshot generation failed:", data?.error || data);
					if (force) toast.error("Failed to create preview");
					return;
				}
				if (data?.status === "skipped") {
					if (force) toast.info("Preview is currently unavailable (gateway error)");
					return;
				}
				await fetchRepoDeployments(repo.name);
				if (force) toast.success("Created a new preview");
			} catch (err) {
				console.error("Screenshot generation request error:", err);
				if (force) toast.error("Failed to create preview");
			}
		},
		[repo?.name, serviceName, fetchRepoDeployments]
	);

	const handleManualCreatePreview = React.useCallback(async () => {
		if (isRefreshingPreview) return;
		setIsRefreshingPreview(true);
		try {
			await requestPreviewScreenshot(true);
		} finally {
			setIsRefreshingPreview(false);
		}
	}, [isRefreshingPreview, requestPreviewScreenshot]);

	// If the service is running but we don't have a screenshot yet, generate one on-demand.
	React.useEffect(() => {
		if (!repo?.name || !serviceName) return;
		if (didRequestScreenshot) return;
		if (effectiveDeploymentStatus !== "running") return;
		if (screenshotUrl) return;
		// If there isn't a stored live URL, screenshot capture won't know what to render.
		if (!hasStoredLiveUrl) return;

		setDidRequestScreenshot(true);
		void requestPreviewScreenshot(false);
	}, [
		repo?.name,
		serviceName,
		didRequestScreenshot,
		effectiveDeploymentStatus,
		screenshotUrl,
		hasStoredLiveUrl,
		requestPreviewScreenshot,
	]);

	const formatTime = (seconds: number) => {
		const hrs = Math.floor(seconds / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;

		if (hrs > 0) {
			return `${hrs}h ${mins}m ${secs}s`;
		} else if (mins > 0) {
			return `${mins}m ${secs}s`;
		} else {
			return `${secs}s`;
		}
	};


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

	const fetchDeploymentHistory = React.useCallback(async () => {
		if (!repo?.name || !serviceName) return;
		setIsLoadingHistory(true);
		try {
			const res = await fetch(`/api/deployment-history?repoName=${encodeURIComponent(repo.name)}&serviceName=${encodeURIComponent(serviceName)}`);
			const data = await res.json();
			if (data.status === "success" && Array.isArray(data.history)) {
				setDeploymentHistory(data.history);
			}
		} catch (err) {
			console.error("Failed to fetch deployment history:", err);
		} finally {
			setIsLoadingHistory(false);
		}
	}, [repo?.name, serviceName]);

	React.useEffect(() => {
		if (!repo?.name || !serviceName) return;

		const prevStatus = prevDeployStatusForHistoryRef.current;
		const finishedDeployAttempt =
			prevStatus === "running" &&
			(deployStatus === "success" || deployStatus === "error");

		if (deploymentHistory === null) {
			fetchDeploymentHistory();
		} else if (finishedDeployAttempt) {
			fetchDeploymentHistory();
		}

		prevDeployStatusForHistoryRef.current = deployStatus;
	}, [deploymentHistory, deployStatus, fetchDeploymentHistory, repo?.name, serviceName]);

	React.useEffect(() => {
		setDeploymentHistory(null);
		prevDeployStatusForHistoryRef.current = undefined;
	}, [repo?.name, serviceName]);

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
			scan_results: effectiveScanResults || workingDeployment.scan_results,
			...(commitSha && { commitSha }),
		};

		const ownerFromUrl = payload.url?.match(/github\.com[/]([^/]+)/)?.[1];
		const repoNameFromUrl = payload.url?.split("/").filter(Boolean).pop()?.replace(/\.git$/, "");
		const owner = repo.owner?.login ?? ownerFromUrl;
		const repoName = repo.name ?? repoNameFromUrl;

		if (owner && repoName) {
			fetch("/api/commits/latest", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					owner,
					repo: repoName,
					branch: payload.branch,
				}),
			})
				.then((res) => res.json())
				.then((data) => {
					if (data.commit) {
						setDeployingCommitInfo({
							sha: data.commit.sha,
							message: data.commit.message,
							author: data.commit.author,
							date: data.commit.date,
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
			const res = await fetch("/api/repos/prefill-infra", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					url: workingDeployment.url,
					branch: workingDeployment.branch,
					...(analyzeServicePath && { package_path: analyzeServicePath }),
				}),
			});
			const data = await res.json();

			if (!res.ok) {
				throw new Error(data?.error || data?.details || "Failed to prefill infrastructure files");
			}

			if (!data?.found || !data?.results) {
				toast.info("No existing Dockerfiles or compose files were found in the repository.");
				return;
			}

			if (data?.branch && data.branch !== workingDeployment.branch) {
				await updateDeploymentById({
					repo_name: workingDeployment.repo_name,
					service_name: workingDeployment.service_name,
					branch: data.branch,
				});
			}

			setScanDuration(0);
			setScanResults(data.results);
			setScanMode("results");
			await onScanComplete(data.results);
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
								prefetchedData={deploymentHistory}
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
									{formatTime(elapsedTime)}
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
