import * as React from "react";
import { useEffect, useRef } from "react";
import ServiceLogs from "@/components/ServiceLogs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, HelpCircle } from "lucide-react";
import { DeployStep } from "@/app/types";

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
	steps?: DeployStep[];
	configSnapshot?: any;
};

export default function DeployLogsView({
	showDeployLogs,
	deployLogEntries,
	serviceLogs,
	deployStatus,
	deployError,
	deployingCommitInfo,
	steps,
	configSnapshot,
}: DeployLogsViewProps) {
	const logsContainerRef = useRef<HTMLDivElement>(null);
	const [analyzing, setAnalyzing] = React.useState(false);
	const [analysisResult, setAnalysisResult] = React.useState<string | null>(null);

	const handleWhyDidItFail = async () => {
		if (!steps || !configSnapshot) return;
		setAnalyzing(true);
		setAnalysisResult(null);
		try {
			const res = await fetch("/api/llm/analyze-failure", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ steps, configSnapshot }),
			});
			const data = await res.json();
			if (data.response) {
				setAnalysisResult(data.response);
			} else {
				setAnalysisResult(data.error || data.details || "Analysis failed.");
			}
		} catch (err) {
			setAnalysisResult(err instanceof Error ? err.message : "Request failed.");
		} finally {
			setAnalyzing(false);
		}
	};

	// Auto-scroll to bottom when new logs arrive
	useEffect(() => {
		if (logsContainerRef.current) {
			const scrollElement = logsContainerRef.current.querySelector("[data-logs-scroll]");
			if (scrollElement) {
				setTimeout(() => {
					scrollElement.scrollTop = scrollElement.scrollHeight;
				}, 0);
			}
		}
	}, [deployLogEntries, serviceLogs]);

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
				<Alert className="border-destructive/50 bg-destructive/10 text-foreground flex flex-col gap-3">
					<div>
						<AlertTitle className="text-destructive/80">Deployment failed</AlertTitle>
						<AlertDescription className="overflow-x-auto">{deployError}</AlertDescription>
					</div>
					{steps && configSnapshot && (
						<div className="mt-2">
							<Button
								variant="outline"
								size="sm"
								className="border-destructive/30 bg-background/50 text-foreground hover:bg-destructive/20"
								onClick={handleWhyDidItFail}
								disabled={analyzing}
							>
								{analyzing ? (
									<>
										<Loader2 className="size-4 animate-spin mr-2" />
										Analyzing logs…
									</>
								) : (
									<>
										<HelpCircle className="size-4 mr-2" />
										Why did it fail?
									</>
								)}
							</Button>
							{analysisResult && (
								<Alert className="mt-3 border-destructive/30 bg-background/50 text-foreground">
									<AlertDescription className="text-sm pb-0 whitespace-pre-wrap">
										{analysisResult}
									</AlertDescription>
								</Alert>
							)}
						</div>
					)}
				</Alert>
			)}
			<div ref={logsContainerRef}>
				<ServiceLogs logs={[...deployLogEntries]} />
			</div>
		</div>
	);
}
