import * as React from "react";
import ServiceLogs from "@/components/ServiceLogs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Clock } from "lucide-react";

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
	const [elapsedTime, setElapsedTime] = React.useState(0);

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
					{showDeployLogs && elapsedTime > 0 && (
						<div className="flex items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-1.5">
							<Clock className="h-4 w-4 text-muted-foreground" />
							<span className="text-sm font-mono text-muted-foreground">{formatTime(elapsedTime)}</span>
						</div>
					)}
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
