import * as React from "react";
import ConfigTabs from "@/components/ConfigTabs";
import DeploymentHistory from "@/components/DeploymentHistory";
import type { MenuSection } from "@/components/deploy-workspace/DeployWorkspaceMenu";
import DeployOverview from "@/components/deploy-workspace/DeployOverview";
import DeployLogsView, { type DeployStatus } from "@/components/deploy-workspace/DeployLogsView";
import BlueprintView from "@/components/blueprint/BlueprintView";
import ScanProgress from "@/components/ScanProgress";
import FeedbackProgress, { type FeedbackProgressPayload } from "@/components/FeedbackProgress";
import SdArtifactsScanResults from "@/components/SdArtifactsScanResults";
import type {
	DeployConfig,
	DeploymentHistoryEntry,
	DeployStep,
	repoType,
	ScanResultsPayload,
	SDArtifactsResponse,
} from "@/app/types";
import { branchNamesFromRepo } from "@/lib/repoBranch";
import { configSnapshotFromDeployConfig } from "@/lib/utils";
import { isDraftDeploymentStatus, isLiveDeploymentStatus } from "@/lib/deploymentStatus";
import { isSdArtifactsAnalyzeScan } from "@/lib/scanResultNormalization";
import { AlertCircle, Layers, Rocket, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
type DeployWorkspaceActiveSectionProps = {
	activeSection: MenuSection;
	improveScanPayload: FeedbackProgressPayload | null;
	scanMode: "idle" | "scanning" | "results";
	repoUrl: string;
	analyzeServicePath: string | undefined;
	effectiveBranch: string;
	repoName: string;
	serviceName: string;
	onScanComplete: (data: ScanResultsPayload, branchOverride?: string) => void;
	onScanProgressComplete: (data: SDArtifactsResponse) => void;
	onScanCancel: () => void;
	onImproveScanComplete: (data: ScanResultsPayload) => Promise<void>;
	onImproveScanCancel: () => void;
	hasScanResults: boolean;
	effectiveScanResults: ScanResultsPayload | null;
	scanDuration: number;
	deployment: DeployConfig;
	onStartDeployment: () => void;
	onRejectScan: () => void;
	onStartImproveScan: (payload: FeedbackProgressPayload) => void;
	onStartScan: () => void;
	deploymentHistory: DeploymentHistoryEntry[] | null | undefined;
	historyTotal: number;
	isLoadingHistory: boolean;
	onRollbackEntrySelect: (entry: DeploymentHistoryEntry) => void;
	rollbackingEntryId: string | null;
	effectiveDeploymentStatus: DeployConfig["status"];
	repoRecord: repoType;
	repoIdentifier: string;
	currentServiceName: string;
	onConfigChange: (partial: Partial<DeployConfig>) => void;
	onPersistScanResults: (results: ScanResultsPayload) => Promise<void>;
	showDeployLogs: boolean;
	deployLogEntries: Array<{ timestamp?: string; message?: string }>;
	serviceLogs: Array<{ timestamp?: string; message?: string }>;
	effectiveDeployStatus: DeployStatus;
	deployError: string | null;
	deployingCommitInfo: { sha: string; message: string; author: string; date: string } | null;
	steps: DeployStep[];
	liveDeployConfig: DeployConfig | null;
	isDeploying: boolean;
	isRefreshingPreview: boolean;
	onRedeploy: (commitSha?: string) => void;
	onRefreshPreview: () => void;
	onEditConfiguration: () => void;
	onOpenScanSection: () => void;
	onPauseResumeDeployment: () => void;
	onDeleteDeployment: () => void;
	isChangingDeploymentState: boolean;
	activeRepo: repoType;
	deployDisabled: boolean;
	deployDisabledMessage: string;
};

export default function DeployWorkspaceActiveSection({
	activeSection,
	improveScanPayload,
	scanMode,
	repoUrl,
	analyzeServicePath,
	effectiveBranch,
	repoName,
	serviceName,
	onScanComplete,
	onScanProgressComplete,
	onScanCancel,
	onImproveScanComplete,
	onImproveScanCancel,
	hasScanResults,
	effectiveScanResults,
	scanDuration,
	deployment,
	onStartDeployment,
	onRejectScan,
	onStartImproveScan,
	onStartScan,
	deploymentHistory,
	historyTotal,
	isLoadingHistory,
	onRollbackEntrySelect,
	rollbackingEntryId,
	effectiveDeploymentStatus,
	repoRecord,
	repoIdentifier,
	currentServiceName,
	onConfigChange,
	onPersistScanResults,
	showDeployLogs,
	deployLogEntries,
	serviceLogs,
	effectiveDeployStatus,
	deployError,
	deployingCommitInfo,
	steps,
	liveDeployConfig,
	isDeploying,
	isRefreshingPreview,
	onRedeploy,
	onRefreshPreview,
	onEditConfiguration,
	onOpenScanSection,
	onPauseResumeDeployment,
	onDeleteDeployment,
	isChangingDeploymentState,
	activeRepo,
	deployDisabled,
	deployDisabledMessage,
}: DeployWorkspaceActiveSectionProps) {
	const isDraft = isDraftDeploymentStatus(effectiveDeploymentStatus);

	switch (activeSection) {
		case "scan":
			if (improveScanPayload) {
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
						<FeedbackProgress
							payload={improveScanPayload}
							repoName={repoName}
							serviceName={serviceName}
							onComplete={onImproveScanComplete}
							onCancel={onImproveScanCancel}
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
							serviceName={serviceName}
							onComplete={(data) => {
								onScanProgressComplete(data);
								onScanComplete(data);
							}}
							onCancel={onScanCancel}
						/>
					</div>
				);
			}
			if ((scanMode === "results" || hasScanResults) && isSdArtifactsAnalyzeScan(effectiveScanResults)) {
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
						<SdArtifactsScanResults
							key={`${deployment.repoName}:${deployment.serviceName}`}
							results={effectiveScanResults as SDArtifactsResponse}
							packagePath={analyzeServicePath}
							scanTime={scanDuration}
							deployment={deployment}
							onStartDeployment={onStartDeployment}
							onCancel={onRejectScan}
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
								SmartDeploy analyzes your repository to automatically generate build plans,
								optimize build layers, and audit security before deployment.
							</p>
						</div>
						<div className="pt-4">
							<div className="flex flex-wrap items-center justify-center gap-3">
								<Button type="button" size="lg" onClick={onStartScan} className="px-8 font-bold gap-2">
									<Rocket className="size-5" />
									Start Smart Analysis
								</Button>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-4 pt-8 border-t border-border/50">
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
					<DeploymentHistory
						key={`${deployment.repoName}:${deployment.serviceName}`}
						repoName={deployment.repoName}
						serviceName={deployment.serviceName}
						prefetchedData={deploymentHistory ? { history: deploymentHistory, total: historyTotal } : null}
						isPrefetching={isLoadingHistory}
						onRollback={onRollbackEntrySelect}
						rollbackingEntryId={rollbackingEntryId}
						activeDeployment={deployment}
						activeDeploymentStatus={effectiveDeploymentStatus}
					/>
				</div>
			);
		case "blueprint":
			return (
				<div className="flex h-full flex-1">
					<BlueprintView
						deployment={deployment}
						scanResults={effectiveScanResults as SDArtifactsResponse | null}
						onStartScan={onStartScan}
						branchOptions={branchNamesFromRepo(repoRecord)}
						onUpdateDeployment={onConfigChange}
						onUpdateScanResults={async (updater) => {
							const current = effectiveScanResults as SDArtifactsResponse | null;
							if (!current) return;
							const next = updater(current);
							await onPersistScanResults(next);
						}}
					/>
				</div>
			);
		case "logs":
			return (
				<div className="w-full mx-auto p-6 flex-1 max-w-6xl min-h-0 overflow-hidden">
					<DeployLogsView
						isDeploymentLive={isLiveDeploymentStatus(effectiveDeploymentStatus)}
						showDeployLogs={showDeployLogs}
						deployLogEntries={deployLogEntries}
						serviceLogs={serviceLogs}
						deployStatus={effectiveDeployStatus}
						deployError={deployError}
						deployingCommitInfo={deployingCommitInfo}
						steps={steps}
						repoNameForLogs={repoName}
						serviceNameForLogs={currentServiceName}
						configSnapshot={configSnapshotFromDeployConfig(liveDeployConfig ?? deployment)}
						repoUrl={deployment.repoUrl}
						commitSha={
							(deployment.scanResults as { commit_sha?: string } | null)?.commit_sha ??
							deployment.commitSha ??
							undefined
						}
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
						onConfigChange={onConfigChange}
						deployment={deployment}
						onStartScan={onStartScan}
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
									This service is currently in draft mode. Configure your environment and run a smart scan to prepare for your first deployment.
								</p>
							</div>
							<div className="pt-4 flex items-center justify-center gap-4">
								<Button variant="outline" onClick={onEditConfiguration} className="font-bold">
									Configure Environment
								</Button>
								<Button onClick={onOpenScanSection} className="font-bold">
									Run Smart Analysis
								</Button>
							</div>
						</div>
					</div>
				);
			}
			return (
				<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
					<DeployOverview
						deployment={deployment}
						isDeploying={isDeploying}
						isRefreshingPreview={isRefreshingPreview}
						onRedeploy={onRedeploy}
						onRefreshPreview={onRefreshPreview}
						onEditConfiguration={onEditConfiguration}
						onPauseResumeDeployment={onPauseResumeDeployment}
						onDeleteDeployment={onDeleteDeployment}
						isChangingDeploymentState={isChangingDeploymentState}
						repo={activeRepo}
						deployDisabled={deployDisabled}
						deployDisabledReason={deployDisabledMessage}
					/>
				</div>
			);
	}
}
