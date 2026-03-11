import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Loader2, XCircle, Terminal, RefreshCw } from "lucide-react";
import { SDArtifactsResponse } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type FeedbackProgressPayload = {
	repoUrl: string;
	commitSha?: string;
	feedback: string;
};

type FeedbackProgressProps = {
	payload: FeedbackProgressPayload;
	onComplete: (data: SDArtifactsResponse) => void;
	onCancel: () => void;
};

const NODES = [
	{ id: "feedback_coordinator", label: "Feedback Coordinator", desc: "Orchestrating improvements" },
	{ id: "dockerfile_improver", label: "Dockerfile Improver", desc: "Optimizing Dockerfiles" },
	{ id: "compose_improver", label: "Compose Improver", desc: "Updating compose configuration" },
	{ id: "nginx_improver", label: "Nginx Improver", desc: "Improving routing and proxy" },
	{ id: "feedback_verifier", label: "Feedback Verifier", desc: "Validating improved artifacts" },
];

export default function FeedbackProgress({ payload, onComplete, onCancel }: FeedbackProgressProps) {
	const { repoUrl, commitSha, feedback } = payload;
	const [activeNode, setActiveNode] = useState<string>("feedback_coordinator");
	const [completedNodes, setCompletedNodes] = useState<string[]>([]);
	const [failedNode, setFailedNode] = useState<string | null>(null);
	const [logs, setLogs] = useState<string[]>([]);
	const [progress, setProgress] = useState(0);
	const logsEndRef = useRef<HTMLDivElement>(null);
	const abortControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		if (logsEndRef.current) {
			logsEndRef.current.scrollIntoView({ behavior: "smooth" });
		}
	}, [logs]);

	useEffect(() => {
		abortControllerRef.current = new AbortController();

		const startStream = async () => {
			try {
				const response = await fetch("/api/feedback/stream", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						repo_url: repoUrl,
						...(commitSha && { commit_sha: commitSha }),
						feedback,
					}),
					signal: abortControllerRef.current?.signal,
				});

				if (!response.ok) {
					const data = await response.json().catch(() => ({}));
					throw new Error(data.error || data.details || "Failed to start feedback stream");
				}

				if (!response.body) {
					throw new Error("No response body");
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";

				const appendLog = (msg: string) => {
					setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
				};

				appendLog("info: feedback workflow started");

				const processMessage = (message: string) => {
					const lines = message.split(/\r?\n/);
					let eventType = "message";
					let dataStr = "";

					for (const line of lines) {
						if (!line.trim()) continue;
						const colonIndex = line.indexOf(":");
						if (colonIndex === -1) continue;
						const field = line.slice(0, colonIndex).trim();
						const value = line.slice(colonIndex + 1).replace(/^ /, "");
						if (field === "event") eventType = value;
						else if (field === "data") dataStr += (dataStr ? "\n" : "") + value;
					}

					if (dataStr) {
						try {
							const data = JSON.parse(dataStr);
							if (eventType === "progress") {
								const { node, status } = data;
								appendLog(`event: progress data: {"node": "${node}", "status": "${status}"}`);
								if (status === "started") {
									setActiveNode(node);
								} else if (status === "completed") {
									setCompletedNodes(prev => [...new Set([...prev, node])]);
									const nodeIndex = NODES.findIndex(n => n.id === node);
									if (nodeIndex >= 0) {
										setProgress(Math.round(((nodeIndex + 1) / NODES.length) * 100));
									}
								} else if (status === "error") {
									setFailedNode(node);
									appendLog(`error: ${data.message || "Unknown error in node " + node}`);
								}
							} else if (eventType === "complete") {
								appendLog("event: feedback complete");
								setProgress(100);
								onComplete(data as SDArtifactsResponse);
							} else if (eventType === "error") {
								const errorMsg = data.detail || data.message || "Unknown error";
								appendLog(`error: ${errorMsg}`);
								setFailedNode(activeNode);
							}
						} catch (e) {
							console.error("Failed to parse SSE JSON data", e, dataStr);
							appendLog(`error: JSON parse failed for ${eventType}`);
						}
					}
				};

				while (true) {
					const { done, value } = await reader.read();
					if (value) {
						const chunk = decoder.decode(value, { stream: true });
						buffer += chunk;
						const messages = buffer.split("\n\n");
						buffer = messages.pop() || "";
						for (const msg of messages) {
							if (msg.trim()) processMessage(msg);
						}
					}
					if (done) {
						if (buffer.trim()) processMessage(buffer);
						break;
					}
				}
			} catch (error: unknown) {
				if (error instanceof Error && error.name !== "AbortError") {
					console.error("Feedback stream error:", error);
					setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] error: ${error.message}`]);
				}
			}
		};

		startStream();

		return () => {
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}
		};
	}, [repoUrl, commitSha, feedback]);

	return (
		<div className="w-full flex-1 flex flex-col min-h-[600px] bg-background/50 animate-in fade-in duration-500">
			<div className="flex items-center gap-3 mb-6">
				<div className="p-2 bg-primary/10 rounded-lg">
					<RefreshCw className="size-5 text-primary" />
				</div>
				<div>
					<h2 className="text-xl font-semibold text-foreground tracking-tight">Improving Scan Results</h2>
					<p className="text-sm text-muted-foreground">SmartDeploy is applying your feedback to improve Dockerfiles, compose, and nginx</p>
				</div>
			</div>

			<div className="flex flex-col lg:flex-row gap-6 h-full">
				<div className="w-full lg:w-1/3 flex flex-col gap-4">
					<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Workflow Chain</h3>
					<div className="flex flex-col gap-3">
						{NODES.map((node) => {
							const isCompleted = completedNodes.includes(node.id);
							const isActive = activeNode === node.id && !isCompleted && !failedNode;
							const isFailed = failedNode === node.id;
							return (
								<Card
									key={node.id}
									className={`p-4 border transition-all duration-300 ${
										isActive
											? "border-primary/50 shadow-[0_0_15px_rgba(var(--primary),0.1)] bg-card/80"
											: isCompleted
												? "border-emerald-500/20 bg-background/40"
												: isFailed
													? "border-destructive/50 bg-destructive/10"
													: "border-border/30 bg-background/20 opacity-60"
									}`}
								>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-3">
											{isCompleted ? (
												<CheckCircle2 className="size-5 text-emerald-500" />
											) : isActive ? (
												<Loader2 className="size-5 text-primary animate-spin" />
											) : isFailed ? (
												<XCircle className="size-5 text-destructive" />
											) : (
												<Circle className="size-5 text-muted-foreground/50" />
											)}
											<div className="flex flex-col">
												<span
													className={`font-medium text-sm ${isActive ? "text-primary" : isCompleted ? "text-foreground" : "text-muted-foreground"}`}
												>
													{node.label}
												</span>
												<span className="text-xs text-muted-foreground/80">{node.desc}</span>
											</div>
										</div>
										{isCompleted && (
											<span className="text-[10px] uppercase font-bold text-emerald-500/80 bg-emerald-500/10 px-2 py-0.5 rounded">
												Done
											</span>
										)}
									</div>
								</Card>
							);
						})}
					</div>
				</div>

				<div className="w-full lg:w-2/3 flex flex-col flex-1">
					<div className="flex items-center justify-between mb-2">
						<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Feedback Stream</h3>
						<div className="flex items-center gap-2">
							<span className="relative flex h-2 w-2">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
								<span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
							</span>
							<span className="text-[10px] text-muted-foreground uppercase tracking-wider">Live Feed</span>
						</div>
					</div>

					<Card className="flex-1 min-h-[400px] flex flex-col bg-[#0d0d0d] border-[#1e1e1e] overflow-hidden">
						<div
							className="flex-1 p-4 font-mono text-xs md:text-sm text-gray-300 overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
							data-logs-scroll
						>
							{logs.map((log, i) => (
								<div key={i} className="break-words">
									{log.includes("info:") ? (
										<span className="text-blue-400">{log}</span>
									) : log.includes("error:") ? (
										<span className="text-red-400">{log}</span>
									) : log.includes("event: progress") ? (
										<span className="text-purple-400">{log}</span>
									) : (
										<span className="text-gray-400">{log}</span>
									)}
								</div>
							))}
							<div ref={logsEndRef} />
						</div>

						<div className="p-4 border-t border-[#1e1e1e]/50 bg-[#0a0a0a]">
							<div className="flex items-center justify-between mb-2">
								<span className="text-xs text-gray-400 font-medium">Total Progress</span>
								<span className="text-xs text-white font-mono">{progress}%</span>
							</div>
							<div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
								<div
									className="h-full bg-primary transition-all duration-500 ease-out"
									style={{ width: `${progress}%` }}
								/>
							</div>
						</div>
					</Card>
				</div>
			</div>

			<div className="flex items-center justify-end gap-3 mt-8 pt-6 border-t border-border/30">
				<Button variant="outline" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
					Cancel
				</Button>
				<Button disabled className="bg-primary/20 text-primary-foreground opacity-50">
					Improving…
				</Button>
			</div>
		</div>
	);
}
