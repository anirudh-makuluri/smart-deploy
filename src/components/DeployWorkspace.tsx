"use client";

import * as React from "react";
import ConfigTabs from "@/components/ConfigTabs";
import DeploymentHistory from "@/components/DeploymentHistory";
import DeployWorkspaceMenu, { MenuSection } from "@/components/deploy-workspace/DeployWorkspaceMenu";
import DeployOverview from "@/components/deploy-workspace/DeployOverview";
import DeployLogsView, { DeployStatus } from "@/components/deploy-workspace/DeployLogsView";

import { useDeployLogs } from "@/custom-hooks/useDeployLogs";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { DeployConfig, repoType, SDArtifactsResponse } from "@/app/types";
import { parseEnvVarsToStore, configSnapshotFromDeployConfig, normalizeRepoUrl } from "@/lib/utils";
import { useAppData } from "@/store/useAppData";
import { isEqual } from "lodash";
import { Clock, Rocket, Search, ShieldCheck, AlertCircle, Trash2, Layers } from "lucide-react";
import ScanProgress from "@/components/ScanProgress";
import FeedbackProgress, { type FeedbackProgressPayload } from "@/components/FeedbackProgress";
import PostScanResults from "@/components/PostScanResults";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type DeployWorkspaceProps = {
	serviceName?: string;
	repoName?: string;
	/** GitHub HTTPS URL for this repo; required for correct scan/config when there is no deployment row yet */
	repoUrl?: string;
};

export default function DeployWorkspace({ serviceName, repoName, repoUrl }: DeployWorkspaceProps) {
	const { deployments, updateDeploymentById, repoList, isLoading } = useAppData();
	const { data: session } = useSession();
	const deploymentFromRepoService = (repoName && serviceName)
		? deployments.find((dep) => dep.repo_name === repoName && dep.service_name === serviceName)
		: undefined;
	const deploymentFromServiceName = serviceName
		? deployments.find((dep) => dep.service_name === serviceName)
		: undefined;
	const deployment = deploymentFromRepoService ?? deploymentFromServiceName;

	const repo = React.useMemo(() => {
		if (deployment) {
			const fromDep = repoList.find((rep) => rep.id === deployment.id || rep.html_url === deployment.url);
			if (fromDep) return fromDep;
		}
		const normalizedTarget = repoUrl ? normalizeRepoUrl(repoUrl) : null;
		if (normalizedTarget) {
			const byUrl = repoList.find((rep) => normalizeRepoUrl(rep.html_url) === normalizedTarget);
			if (byUrl) return byUrl;
		}
		if (repoName) {
			return repoList.find(
				(rep) =>
					rep.name === repoName ||
					rep.full_name?.split("/").pop()?.toLowerCase() === repoName.toLowerCase()
			);
		}
		return undefined;
	}, [repoList, deployment, repoName, repoUrl]);

	const effectiveRepoUrl = (deployment?.url || repoUrl || "").trim();
	const [isDeploying, setIsDeploying] = React.useState(false);
	const [deployingCommitInfo, setDeployingCommitInfo] = React.useState<{ sha: string; message: string; author: string; date: string } | null>(null);
	const [activeSection, setActiveSection] = React.useState<MenuSection>(deployment && deployment.status !== "didnt_deploy" ? "overview" : "setup");
	const [deploymentHistory, setDeploymentHistory] = React.useState<any[] | null>(null);
	const [isLoadingHistory, setIsLoadingHistory] = React.useState(false);
	const [editMode, setEditMode] = React.useState(false);
	const [elapsedTime, setElapsedTime] = React.useState(0);

	// Scan state
	const [scanMode, setScanMode] = React.useState<"idle" | "scanning" | "results">("idle");
	const [scanResults, setScanResults] = React.useState<SDArtifactsResponse | null>(null);
	const [scanStartTime, setScanStartTime] = React.useState<number>(0);
	const [scanDuration, setScanDuration] = React.useState<number>(0);
	const [showRejectConfirm, setShowRejectConfirm] = React.useState(false);
	const [improveScanPayload, setImproveScanPayload] = React.useState<FeedbackProgressPayload | null>(null);

	const serviceNameForLogs = deployment?.service_name ?? serviceName ?? repo?.name;
	const repoNameForLogs = deployment?.repo_name ?? repoName;
	const { steps, sendDeployConfig, deployConfigRef, deployStatus, deployError, serviceLogs, deployLogEntries } = useDeployLogs(serviceNameForLogs, repoNameForLogs);
	const showDeployLogs = (isDeploying || deployStatus === "running" || deployStatus === "error");
	const effectiveDeployStatus: DeployStatus = deployStatus === "not-started" ? "not-started" :
		deployStatus === "running" ? "running" :
			deployStatus === "success" ? "success" :
				deployStatus === "error" ? "error" : "not-started";

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

	const resolvedRepo: repoType = repo ?? (() => {
		const fallbackName = repoName ?? deployment?.service_name ?? serviceName ?? "service";
		const defaultBranch = deployment?.branch ?? "main";
		const url = effectiveRepoUrl;
		const ownerFromUrl = url.match(/github\.com[/]([^/]+)/)?.[1] ?? "unknown";
		const repoNameFromUrl = url.split("/").filter(Boolean).pop()?.replace(/\.git$/, "") ?? fallbackName;
		const fullName = `${ownerFromUrl}/${repoNameFromUrl}`;
		const now = new Date(0).toISOString();
		return {
			id: deployment?.id ?? "",
			name: repoNameFromUrl,
			full_name: fullName,
			html_url: url,
			language: "",
			languages_url: "",
			created_at: now,
			updated_at: now,
			pushed_at: now,
			default_branch: defaultBranch,
			private: false,
			description: null,
			visibility: "public",
			license: null,
			forks_count: 0,
			watchers_count: 0,
			open_issues_count: 0,
			owner: { login: ownerFromUrl },
			latest_commit: null,
			branches: [
				{ name: defaultBranch, commit_sha: deployment?.commitSha ?? "", protected: false },
			],
		};
	})();

	const resolvedRepoName = deployment?.repo_name ?? repoName ?? resolvedRepo.name;
	const resolvedServiceName = deployment?.service_name ?? serviceName ?? "";
	// Ensure required fields are always present even if the persisted deployment row is partial.
	const resolvedDeploymentBase: DeployConfig = {
		id: deployment?.id ?? "",
		repo_name: resolvedRepoName,
		service_name: resolvedServiceName,
		url: resolvedRepo.html_url ?? "",
		branch: resolvedRepo.default_branch || "main",
		status: "didnt_deploy",
	};

	const resolvedDeployment = ({
		...resolvedDeploymentBase,
		...(deployment as Partial<DeployConfig> | undefined),
	} as DeployConfig);

	// Backend expects `url` to always be a string.
	resolvedDeployment.url = resolvedDeployment.url ?? resolvedDeploymentBase.url ?? "";

	// Fetch deployment history once when page loads
	React.useEffect(() => {
		if (!resolvedRepoName || !resolvedServiceName || deploymentHistory !== null) return;

		setIsLoadingHistory(true);
		fetch(`/api/deployment-history?repoName=${encodeURIComponent(resolvedRepoName)}&serviceName=${encodeURIComponent(resolvedServiceName)}`)
			.then((res) => res.json())
			.then((data) => {
				if (data.status === "success" && Array.isArray(data.history)) {
					setDeploymentHistory(data.history);
				}
			})
			.catch((err) => {
				console.error("Failed to fetch deployment history:", err);
			})
			.finally(() => setIsLoadingHistory(false));
	}, [resolvedRepoName, resolvedServiceName, deploymentHistory]);

	// Refetch history after deployment completes
	React.useEffect(() => {
		if ((deployStatus === "success" || deployStatus === "error") && resolvedRepoName && resolvedServiceName) {
			fetch(`/api/deployment-history?repoName=${encodeURIComponent(resolvedRepoName)}&serviceName=${encodeURIComponent(resolvedServiceName)}`)
				.then((res) => res.json())
				.then((data) => {
					if (data.status === "success" && Array.isArray(data.history)) {
						setDeploymentHistory(data.history);
					}
				})
				.catch((err) => {
					console.error("Failed to refetch deployment history:", err);
				});
		}
	}, [deployStatus, resolvedRepoName, resolvedServiceName]);

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
		if (!session?.user) return;

		await updateDeploymentById({
			repo_name: resolvedRepoName,
			service_name: resolvedServiceName,
			scan_results: results,
		});
		setScanResults(results);
		setScanMode("results");
		toast.success("Scan saved to configuration");
	}

	async function handleConfirmRejectScan() {
		if (!resolvedDeployment) return;

		// 1. Clear backend cache
		try {
			await fetch("/api/cache", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					repo_url: resolvedDeployment.url,
					commit_sha: resolvedDeployment.scan_results?.commit_sha || resolvedDeployment.commitSha,
				}),
			});
		} catch (err) {
			console.error("Failed to clear backend cache:", err);
		}

		// 2. Clear frontend state and DB
		const cleared: DeployConfig = {
			...resolvedDeployment,
			scan_results: undefined,
		};

		await updateDeploymentById(cleared);
		setScanResults(null);
		setScanMode("idle");
		toast.info("Analysis results cleared and cache invalidated");
		setShowRejectConfirm(false);
	}

	async function handleRejectScan() {
		setShowRejectConfirm(true);
	}

	const hasScanResults = !!(deployment?.scan_results || scanResults);
	const isDraft = !deployment || deployment.status === "didnt_deploy";

	async function handleRedeploy(commitSha?: string) {
		const token = session?.accessToken;
		if (!token || !resolvedDeployment) {
			return console.log("Unauthenticated or no deployment");
		}

		const payload: DeployConfig = {
			...resolvedDeployment,
			...(commitSha && { commitSha }),
		};

		const ownerFromUrl = payload.url?.match(/github\.com[/]([^/]+)/)?.[1];
		const repoNameFromUrl = payload.url?.split("/").filter(Boolean).pop()?.replace(/\.git$/, "");
		const owner = resolvedRepo.owner?.login ?? ownerFromUrl;
		const repoName = resolvedRepo.name ?? repoNameFromUrl;

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
								repoFullName={resolvedRepo.full_name}
								branch={deployment?.branch ?? resolvedRepo.default_branch ?? "main"}
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
								results={(scanResults || deployment?.scan_results) as SDArtifactsResponse}
								onUpdateResults={(updated) => {
									setScanResults(updated);
									onScanComplete(updated);
								}}
								scanTime={scanDuration}
								deployment={resolvedDeployment!}
								onStartDeployment={() => handleRedeploy()}
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
								<Button size="lg" onClick={startScan} className="px-8 font-bold gap-2">
									<Rocket className="size-5" />
									Start Smart Analysis
								</Button>
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
						{resolvedDeployment && (
							<DeploymentHistory
								repoName={resolvedDeployment.repo_name}
								serviceName={resolvedDeployment.service_name}
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
							configSnapshot={deployConfigRef.current ? configSnapshotFromDeployConfig(deployConfigRef.current) : (resolvedDeployment ? configSnapshotFromDeployConfig(resolvedDeployment) : {})}
							repoUrl={resolvedDeployment?.url}
							commitSha={resolvedDeployment?.scan_results?.commit_sha ?? resolvedDeployment?.commitSha}
							onStartImproveScan={onStartImproveScan}
						/>
					</div>
				);
			case "setup":
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
						<ConfigTabs
							repoFullName={resolvedRepo.full_name}
							onConfigChange={(partial) => {
									updateDeploymentById({
										repo_name: resolvedDeployment.repo_name,
										service_name: resolvedDeployment.service_name,
										...partial,
									});
							}}
							deployment={resolvedDeployment}
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
						{resolvedDeployment && (
							<DeployOverview
								deployment={resolvedDeployment}
								isDeploying={isDeploying}
								onRedeploy={handleRedeploy}
								onEditConfiguration={() => { setActiveSection("setup"); setEditMode(true); }}
								repo={resolvedRepo}
							/>
						)}
					</div>
				);
		}
	}

	if (!isLoading && !deployment && !repo && !effectiveRepoUrl) {
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
							<span className="text-muted-foreground/60">{resolvedRepoName}</span>
							<span className="text-border">/</span>
							<span className="text-foreground">{resolvedServiceName}</span>
						</div>
						{!isDraft && (
							<div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-bold tracking-widest uppercase text-emerald-400">
								<div className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
								Live
							</div>
						)}
					</div>

					<div className="flex items-center gap-3">
						<div className="relative group">
							<Button
								disabled={!hasScanResults || isDeploying}
								onClick={() => handleRedeploy()}
								className="h-9 px-6 font-bold gap-2 shadow-lg shadow-primary/20 relative overflow-hidden"
								title={!hasScanResults ? "Run smart scan first" : ""}
							>
								<Rocket className="size-4 relative z-10" />
								<span className="relative z-10">Deploy</span>
							</Button>
							{!hasScanResults && (
								<div className="absolute top-full right-0 mt-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
									<div className="bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-1 rounded shadow-lg whitespace-nowrap border border-destructive/20">
										Run smart scan first
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
