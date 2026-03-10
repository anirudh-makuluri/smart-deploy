"use client";

import * as React from "react";
import { useEffect, useRef } from "react";
import ServiceLogs from "@/components/ServiceLogs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, HelpCircle, CheckCircle2, XCircle, Clock, GitCommit, User, Calendar } from "lucide-react";
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

	const completedSteps = steps?.filter(s => s.status === "success").length || 0;
	const totalSteps = steps?.length || 1;
	const progress = (completedSteps / totalSteps) * 100;

	return (
		<div className="space-y-6">
			{/* Live Status Header */}
			<div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 shadow-xl backdrop-blur-sm overflow-hidden relative group">
				<div className="absolute top-0 left-0 w-full h-[2px] bg-white/5">
					<div
						className={`h-full transition-all duration-1000 ease-out ${deployStatus === "error" ? "bg-destructive" : "bg-primary"
							}`}
						style={{ width: `${progress}%` }}
					/>
				</div>

				<div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
					<div className="space-y-4 flex-1">
						<div className="flex items-center gap-3">
							<div className={`p-2 rounded-xl ${deployStatus === "running" ? "bg-primary/10 text-primary animate-pulse" :
									deployStatus === "success" ? "bg-emerald-500/10 text-emerald-500" :
										deployStatus === "error" ? "bg-destructive/10 text-destructive" :
											"bg-muted text-muted-foreground"
								}`}>
								{deployStatus === "running" && <Loader2 className="size-6 animate-spin" />}
								{deployStatus === "success" && <CheckCircle2 className="size-6" />}
								{deployStatus === "error" && <XCircle className="size-6" />}
								{deployStatus === "not-started" && <Clock className="size-6" />}
							</div>
							<div>
								<h3 className="text-lg font-bold text-foreground flex items-center gap-2">
									{deployStatus === "running" ? "Deployment in Progress" :
										deployStatus === "success" ? "Deployment Successful" :
											deployStatus === "error" ? "Deployment Failed" : "Awaiting Deployment"}
								</h3>
								<p className="text-sm text-muted-foreground/60 flex items-center gap-2">
									{deployStatus === "running" ? `Step ${completedSteps + 1} of ${totalSteps}` :
										deployStatus === "success" ? "All steps completed successfully" :
											deployStatus === "error" ? "An error occurred during deployment" : "Ready to deploy"}
								</p>
							</div>
						</div>

						{deployingCommitInfo && (
							<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
								<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground/80 bg-white/5 border border-white/5 rounded-lg px-3 py-2">
									<GitCommit className="size-3.5 text-primary" />
									<span className="font-mono">{deployingCommitInfo.sha.substring(0, 7)}</span>
								</div>
								<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground/80 bg-white/5 border border-white/5 rounded-lg px-3 py-2">
									<User className="size-3.5 text-primary" />
									<span className="truncate">{deployingCommitInfo.author}</span>
								</div>
								<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground/80 bg-white/5 border border-white/5 rounded-lg px-3 py-2">
									<Calendar className="size-3.5 text-primary" />
									<span>{new Date(deployingCommitInfo.date).toLocaleTimeString()}</span>
								</div>
							</div>
						)}
					</div>

					<div className="flex flex-col items-end gap-3 shrink-0">
						<div className="flex items-center gap-2">
							{steps?.map((step, i) => (
								<div
									key={step.id}
									className={`size-2 rounded-full transition-all duration-300 ${step.status === "success" ? "bg-emerald-500" :
											step.status === "in_progress" ? "bg-primary animate-pulse scale-125" :
												step.status === "error" ? "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.5)]" :
													"bg-white/10"
										}`}
									title={step.label}
								/>
							))}
						</div>
						{deployStatus === "running" && (
							<span className="text-[10px] font-bold text-primary uppercase tracking-widest animate-pulse">Live</span>
						)}
					</div>
				</div>
			</div>

			{showDeployLogs && deployError && (
				<Alert className="border-destructive/50 bg-destructive/10 text-foreground flex flex-col gap-3">
					<div>
						<AlertTitle className="text-destructive/80 font-bold">Deployment failed</AlertTitle>
						<AlertDescription className="overflow-x-auto text-sm">{deployError}</AlertDescription>
					</div>
					{steps && configSnapshot && (
						<div className="mt-2 text-right">
							<Button
								variant="outline"
								size="sm"
								className="border-destructive/30 bg-background/50 text-foreground hover:bg-destructive/20 font-semibold"
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
										Explain root cause
									</>
								)}
							</Button>
							{analysisResult && (
								<Alert className="mt-3 border-destructive/30 bg-background/50 text-foreground text-left transition-all">
									<AlertDescription className="text-sm pb-0 whitespace-pre-wrap leading-relaxed">
										{analysisResult}
									</AlertDescription>
								</Alert>
							)}
						</div>
					)}
				</Alert>
			)}

			<div ref={logsContainerRef} className="rounded-2xl border border-white/5 bg-[#0A0A0F] overflow-hidden shadow-2xl">
				<ServiceLogs logs={[...deployLogEntries]} />
			</div>
		</div>
	);
}
