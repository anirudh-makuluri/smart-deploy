import * as React from "react";
import ServiceLogs from "@/components/ServiceLogs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export type DeployStatus = "not-started" | "running" | "success" | "error";

type LogEntry = { timestamp?: string; message?: string };
type CommitInfo = { sha: string; message: string; author: string; date: string };

type DeployLogsViewProps = {
	showDeployLogs: boolean;
	deployLogEntries: LogEntry[];
	serviceLogs: LogEntry[];
	deployStatus: DeployStatus;
	deployError?: string | null;
	deployingCommitInfo?: CommitInfo | null;
};

export default function DeployLogsView({
	showDeployLogs,
	deployLogEntries,
	serviceLogs,
	deployStatus,
	deployError,
	deployingCommitInfo,
}: DeployLogsViewProps) {
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div>
					<p className="text-xl font-semibold text-foreground">Logs</p>
					{showDeployLogs && deployingCommitInfo && (
						<p className="text-sm text-muted-foreground">
							{deployingCommitInfo.sha.substring(0, 7)}: {deployingCommitInfo.message.split("\n")[0]}
						</p>
					)}
				</div>
				<div className="flex items-center gap-4">
					{showDeployLogs && deployStatus === "success" && (
						<span className="text-xs uppercase tracking-wide text-emerald-400">Deployment complete</span>
					)}
				</div>
			</div>
			{showDeployLogs && deployError && (
				<Alert className="border-destructive/50 bg-destructive/10 text-foreground">
					<AlertTitle className="text-destructive/80">Deployment failed</AlertTitle>
					<AlertDescription className="overflow-x-auto">{deployError}</AlertDescription>
				</Alert>
			)}
			<ServiceLogs logs={[...deployLogEntries, ...serviceLogs]} />
		</div>
	);
}
