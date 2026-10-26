"use client";

import * as React from "react";
import ServiceLogs from "@/components/ServiceLogs";
import { Alert } from "@/components/ui/alert";
import { AlertDescription, AlertTitle } from "@/components/ui/alert-parts";
import { Button } from "@/components/ui/button";
import {
	Calendar,
	CheckCircle2,
	Clock,
	GitCommit,
	HelpCircle,
	Loader2,
	RefreshCw,
	User,
	XCircle,
} from "lucide-react";
import { DeployStep } from "@/app/types";
import { formatRecentDeployLogs } from "@/components/deploy-workspace/deployLogsUtils";
import { requestFailureAnalysis } from "@/lib/failureAnalysis";

export type DeployStatus = "not-started" | "queued" | "running" | "success" | "error";

type LogEntry = { timestamp?: string; message?: string };
type CommitInfo = { sha: string; message: string; author: string; date: string };

type DeployLogsViewProps = {
	isDeploymentLive: boolean;
	showDeployLogs: boolean;
	deployLogEntries: LogEntry[];
	serviceLogs: LogEntry[];
	deployStatus: DeployStatus;
	deployError?: string | null;
	deploymentRunId?: string | null;
	deployingCommitInfo?: CommitInfo | null;
	steps?: DeployStep[];
	repoUrl?: string;
	commitSha?: string;
	packagePath?: string;
	onStartImproveScan?: (payload: {
		repoUrl: string;
		commitSha?: string;
		packagePath?: string;
		feedback: string;
		failureSummary?: string;
		failureLogs?: string;
		failedArtifactScope?: string;
	}) => void;
	repoNameForLogs?: string;
	serviceNameForLogs?: string;
};

export default function DeployLogsView({
	isDeploymentLive,
	showDeployLogs,
	deployLogEntries,
	serviceLogs,
	deployStatus,
	deployError,
	deploymentRunId,
	deployingCommitInfo,
	steps,
	repoUrl,
	commitSha,
	packagePath,
	onStartImproveScan,
	repoNameForLogs,
	serviceNameForLogs,
}: DeployLogsViewProps) {
	const logsContainerRef = React.useRef<HTMLDivElement>(null);
	const [analyzing, setAnalyzing] = React.useState(false);
	const [analysisResult, setAnalysisResult] = React.useState<string | null>(null);

	const handleWhyDidItFail = async () => {
		if (!deploymentRunId) {
			setAnalysisResult("This deployment run is still syncing. Please retry in a moment.");
			return;
		}
		setAnalyzing(true);
		setAnalysisResult(null);
		try {
			setAnalysisResult(await requestFailureAnalysis(deploymentRunId));
		} catch (err) {
			setAnalysisResult(err instanceof Error ? err.message : "Request failed.");
		} finally {
			setAnalyzing(false);
		}
	};

	function handleImproveScanResults() {
		if (!analysisResult || !repoUrl || !onStartImproveScan) return;
		const recentLogs = formatRecentDeployLogs(deployLogEntries);
		onStartImproveScan({
			repoUrl,
			commitSha,
			packagePath,
			feedback: analysisResult,
			failureSummary: analysisResult,
			failureLogs: recentLogs || undefined,
			failedArtifactScope: "general",
		});
	}

	const showingDeployLogs =
		deployStatus === "queued" ||
		deployStatus === "running" ||
		(showDeployLogs &&
			deployLogEntries.length > 0 &&
			(deployStatus === "success" || deployStatus === "error"));
	const logsToRender = showingDeployLogs
		? deployStatus === "running"
			? deployLogEntries
			: [...deployLogEntries, ...serviceLogs]
		: serviceLogs;
	const showDeploymentHeader = showDeployLogs;


	return (
		<div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-4 sm:gap-6">
			<DeploymentLogHeader showDeploymentHeader={showDeploymentHeader} deployStatus={deployStatus} isDeploymentLive={isDeploymentLive} steps={steps} deployingCommitInfo={deployingCommitInfo} />

			<DeploymentFailurePanel showDeployLogs={showDeployLogs} deployError={deployError} steps={steps} analyzing={analyzing} analysisResult={analysisResult} repoUrl={repoUrl} onStartImproveScan={onStartImproveScan} handleWhyDidItFail={handleWhyDidItFail} handleImproveScanResults={handleImproveScanResults} />

			<div
				ref={logsContainerRef}
				className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/5 bg-[#0A0A0F] shadow-2xl"
			>
				<ServiceLogs
					logs={logsToRender}
					repoName={repoNameForLogs}
					serviceName={serviceNameForLogs}
					deployStatus={deployStatus}
					displayLimit={14}
					scrollable={true}
				/>
			</div>
		</div>
	);
}

function DeploymentLogHeader({
	showDeploymentHeader,
	deployStatus,
	isDeploymentLive,
	steps,
	deployingCommitInfo,
}: Pick<DeployLogsViewProps, "deployStatus" | "isDeploymentLive" | "steps" | "deployingCommitInfo"> & {
	showDeploymentHeader: boolean;
}) {
	const deploymentSteps = showDeploymentHeader ? (steps ?? []) : [];
	const hasDeploymentSteps = deploymentSteps.length > 0;
	const completedSteps = hasDeploymentSteps
		? deploymentSteps.filter((step) => step.status === "success").length
		: 0;
	const totalSteps = deploymentSteps.length;
	const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

	const metadata = DEPLOYMENT_LOG_STATUS[deployStatus];
	const headerTitle = showDeploymentHeader
		? metadata.title
		: isDeploymentLive
			? "Live Service Logs"
			: "Start a new deployment";
	const runningSubtitle = hasDeploymentSteps
		? `Step ${Math.min(completedSteps + 1, totalSteps)} of ${totalSteps}`
		: "Deployment is running";
	const deploymentSubtitle = deployStatus === "running" ? runningSubtitle : metadata.subtitle;
	const headerSubtitle = showDeploymentHeader
		? deploymentSubtitle
		: isDeploymentLive
			? "Live service output"
			: "Logs will appear here once the deployment starts producing output";

	return (
		<div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-white/2 p-4 shadow-xl backdrop-blur-sm sm:p-6">
			{showDeploymentHeader && (
				<div className="absolute left-0 top-0 h-[2px] w-full bg-white/5">
					<div
						className={`h-full transition-[width,background-color] duration-1000 ease-out ${deployStatus === "error" ? "bg-destructive" : "bg-primary"}`}
						style={{ width: `${progress}%` }}
					/>
				</div>
			)}

			<div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
				<div className="flex-1 space-y-4">
					<div className="flex items-center gap-3">
						<DeploymentLogStatusIcon
							showDeploymentHeader={showDeploymentHeader}
							deployStatus={deployStatus}
						/>
						<div>
							<h3 className="flex items-center gap-2 text-lg font-bold text-foreground">{headerTitle}</h3>
							<p className="flex items-center gap-2 text-sm text-muted-foreground/60">{headerSubtitle}</p>
						</div>
					</div>

					<DeployingCommitDetails deployingCommitInfo={deployingCommitInfo} />
				</div>

				<div className="flex shrink-0 flex-col items-start gap-3 md:items-end">
					<DeploymentStepIndicators showDeploymentHeader={showDeploymentHeader} steps={steps} />
					{deployStatus === "running" && (
						<span className="animate-pulse text-[10px] font-bold uppercase tracking-widest text-primary">
							Live
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

const DEPLOYMENT_LOG_STATUS = {
	"not-started": { title: "Awaiting Deployment", subtitle: "Ready to deploy", icon: Clock, iconClass: "bg-muted text-muted-foreground" },
	queued: { title: "Deployment queued", subtitle: "Waiting for the deployment worker to begin processing", icon: Clock, iconClass: "animate-pulse bg-primary/10 text-primary" },
	running: { title: "Deployment in Progress", subtitle: "Deployment is running", icon: Loader2, iconClass: "animate-pulse bg-primary/10 text-primary" },
	success: { title: "Deployment Successful", subtitle: "All steps completed successfully", icon: CheckCircle2, iconClass: "bg-emerald-500/10 text-emerald-500" },
	error: { title: "Deployment Failed", subtitle: "An error occurred during deployment", icon: XCircle, iconClass: "bg-destructive/10 text-destructive" },
} satisfies Record<DeployStatus, { title: string; subtitle: string; icon: typeof Clock; iconClass: string }>;

function DeploymentLogStatusIcon({
	showDeploymentHeader,
	deployStatus,
}: {
	showDeploymentHeader: boolean;
	deployStatus: DeployStatus;
}) {
	const metadata = showDeploymentHeader
		? DEPLOYMENT_LOG_STATUS[deployStatus]
		: DEPLOYMENT_LOG_STATUS["not-started"];
	const Icon = metadata.icon;
	return (
		<div className={`rounded-xl p-2 ${metadata.iconClass}`}>
			<Icon
				className={deployStatus === "running" && showDeploymentHeader ? "size-6 animate-spin" : "size-6"}
			/>
		</div>
	);
}

function DeploymentStepIndicators({
	showDeploymentHeader,
	steps,
}: Pick<DeployLogsViewProps, "steps"> & { showDeploymentHeader: boolean }) {
	return (
		<>
			{showDeploymentHeader && steps && (
				<div className="flex items-center gap-2">
					{steps.map((step) => (
						<div
							key={step.id}
							className={`size-2 rounded-full transition-[background-color,box-shadow,scale] duration-300 ${
								step.status === "success"
									? "bg-emerald-500"
									: step.status === "in_progress"
										? "scale-125 animate-pulse bg-primary"
										: step.status === "error"
											? "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.5)]"
											: "bg-white/10"
							}`}
							title={step.label}
						/>
					))}
				</div>
			)}
		</>
	);
}

function DeploymentFailurePanel({
	showDeployLogs,
	deployError,
	steps,
	analyzing,
	analysisResult,
	repoUrl,
	onStartImproveScan,
	handleWhyDidItFail,
	handleImproveScanResults,
}: Pick<
	DeployLogsViewProps,
	"showDeployLogs" | "deployError" | "steps" | "repoUrl" | "onStartImproveScan"
> & {
	analyzing: boolean;
	analysisResult: string | null;
	handleWhyDidItFail: () => Promise<void>;
	handleImproveScanResults: () => void;
}) {
	return (
		<>
			{showDeployLogs && deployError && (
				<Alert className="flex flex-col gap-3 border-destructive/50 bg-destructive/10 text-foreground">
					<div>
						<AlertTitle className="font-bold text-destructive/80">Deployment failed</AlertTitle>
						<AlertDescription className="overflow-x-auto text-sm">{deployError}</AlertDescription>
					</div>
					{steps && (
						<div className="mt-2 space-y-3">
							<div className="text-right">
								<Button
									variant="outline"
									size="sm"
									className="border-destructive/30 bg-background/50 font-semibold text-foreground hover:bg-destructive/20"
									onClick={handleWhyDidItFail}
									disabled={analyzing}
								>
									{analyzing ? (
										<>
											<Loader2 className="mr-2 size-4 animate-spin" />
											Analyzing logs...
										</>
									) : (
										<>
											<HelpCircle className="mr-2 size-4" />
											Explain root cause
										</>
									)}
								</Button>
							</div>
							{analysisResult && (
								<div className="border-border/60 bg-background/70 w-full text-foreground">
									<div className="flex flex-col gap-3 px-4 py-2">
										<div>
											<div className="mt-2 whitespace-pre-wrap text-sm">{analysisResult}</div>
										</div>
										{repoUrl && onStartImproveScan && (
											<div className="flex justify-end">
												<Button
													variant="outline"
													size="sm"
													className="border-border hidden bg-background/80 text-foreground hover:bg-secondary"
													onClick={handleImproveScanResults}
												>
													<RefreshCw className="mr-2 size-4" />
													Use in improve scan
												</Button>
											</div>
										)}
									</div>
								</div>
							)}
						</div>
					)}
				</Alert>
			)}
		</>
	);
}

function DeployingCommitDetails({ deployingCommitInfo }: Pick<DeployLogsViewProps, "deployingCommitInfo">) {
	return (
		<>
			{deployingCommitInfo && (
				<div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-3">
					<div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs font-medium text-muted-foreground/80">
						<GitCommit className="size-3.5 text-primary" />
						<span className="font-mono">{deployingCommitInfo.sha.substring(0, 7)}</span>
					</div>
					<div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs font-medium text-muted-foreground/80">
						<User className="size-3.5 text-primary" />
						<span className="truncate">{deployingCommitInfo.author}</span>
					</div>
					<div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs font-medium text-muted-foreground/80">
						<Calendar className="size-3.5 text-primary" />
						<span>
							{new Date(deployingCommitInfo.date).toLocaleTimeString("en-US", {
								hour: "2-digit",
								minute: "2-digit",
								timeZone: "UTC",
							})}
						</span>
					</div>
				</div>
			)}
		</>
	);
}
