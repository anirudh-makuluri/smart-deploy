"use client";

import React from "react";
import { ScrollArea } from "./ui/scroll-area";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { ChevronDown, Search, X, Plus, Minus, Download } from "lucide-react";

type LogEntry = { timestamp?: string; message?: string };

function getLogType(message: string): "ERROR" | "WARN" | "SUCCESS" | "INFO" {
	const normalized = message.toLowerCase();
	if (normalized.includes("error") || normalized.includes("failed") || normalized.includes("exception")) {
		return "ERROR";
	}
	if (normalized.includes("warn")) {
		return "WARN";
	}
	if (normalized.includes("success") || normalized.includes("completed") || normalized.includes("deployed")) {
		return "SUCCESS";
	}
	return "INFO";
}

function formatTimeOnly(timestamp?: string): string {
	if (!timestamp) return "-";
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return "-";
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");
	return `${hours}:${minutes}:${seconds}`;
}

type LogFilter = "ALL" | "ERROR" | "WARN" | "BUILD" | "DEPLOY";

export default function ServiceLogs({
	logs,
	serviceName,
	repoName,
	deployStatus,
	displayLimit,
}: {
	logs: LogEntry[];
	serviceName?: string;
	repoName?: string;
	deployStatus?: string;
	displayLimit?: number;
	[key: string]: unknown;
}) {

	const containerRef = React.useRef<HTMLDivElement>(null);
	const prevLogsLengthRef = React.useRef(0);
	const shouldAutoScrollRef = React.useRef(true);
	const [showScrollToBottom, setShowScrollToBottom] = React.useState(false);
	const [selectedLog, setSelectedLog] = React.useState<LogEntry | null>(null);
	const [logFilter, setLogFilter] = React.useState<LogFilter>("ALL");

	type KeywordRule = { mode: "include" | "exclude"; keyword: string };

	const LOG_FILTER_STORAGE_KEY = "sd-log-keyword-filters";

	const [keywordRules, setKeywordRules] = React.useState<KeywordRule[]>(() => {
		if (typeof window === "undefined") return [];
		try {
			const stored = localStorage.getItem(LOG_FILTER_STORAGE_KEY);
			return stored ? JSON.parse(stored) : [];
		} catch {
			return [];
		}
	});
	const [ruleInput, setRuleInput] = React.useState("");
	const [ruleMode, setRuleMode] = React.useState<"include" | "exclude">("exclude");
	const [showFilterInput, setShowFilterInput] = React.useState(() => {
		if (typeof window === "undefined") return false;
		try {
			const stored = localStorage.getItem(LOG_FILTER_STORAGE_KEY);
			const rules: KeywordRule[] = stored ? JSON.parse(stored) : [];
			return rules.length > 0;
		} catch {
			return false;
		}
	});

	React.useEffect(() => {
		try {
			if (keywordRules.length > 0) {
				localStorage.setItem(LOG_FILTER_STORAGE_KEY, JSON.stringify(keywordRules));
			} else {
				localStorage.removeItem(LOG_FILTER_STORAGE_KEY);
			}
		} catch { /* quota or SSR */ }
	}, [keywordRules]);

	const addKeywordRule = () => {
		const trimmed = ruleInput.trim();
		if (!trimmed) return;
		if (keywordRules.some((r) => r.keyword.toLowerCase() === trimmed.toLowerCase() && r.mode === ruleMode)) return;
		setKeywordRules((prev) => [...prev, { mode: ruleMode, keyword: trimmed }]);
		setRuleInput("");
	};

	const removeKeywordRule = (index: number) => {
		setKeywordRules((prev) => prev.filter((_, i) => i !== index));
	};

	// Prepend older history as the user scrolls to the top.
	const [extraHistory, setExtraHistory] = React.useState<LogEntry[]>([]);
	const extraHistoryRef = React.useRef<LogEntry[]>([]);
	const logsRef = React.useRef<LogEntry[]>(logs);
	const PAGE_SIZE = 50;
	const hasMoreHistoryRef = React.useRef(true);
	const isLoadingHistoryRef = React.useRef(false);
	const [hasMoreHistory, setHasMoreHistory] = React.useState(true);
	const [isLoadingOlderLogs, setIsLoadingOlderLogs] = React.useState(false);

	React.useEffect(() => {
		logsRef.current = logs;
	}, [logs]);

	React.useEffect(() => {
		extraHistoryRef.current = extraHistory;
	}, [extraHistory]);

	React.useEffect(() => {
		hasMoreHistoryRef.current = hasMoreHistory;
	}, [hasMoreHistory]);

	// Reset paginated history when switching services.
	React.useEffect(() => {
		setExtraHistory([]);
		setHasMoreHistory(true);
		isLoadingHistoryRef.current = false;
		extraHistoryRef.current = [];
		hasMoreHistoryRef.current = true;
	}, [serviceName, repoName]);

	function logKey(log: LogEntry): string {
		const ts = log.timestamp ?? "";
		const msg = typeof log.message === "string" ? log.message : JSON.stringify(log.message);
		return `${ts}|${msg}`;
	}

	const combinedLogs = React.useMemo(() => {
		const seen = new Set<string>();
		const out: LogEntry[] = [];

		for (const l of extraHistory) {
			const k = logKey(l);
			if (seen.has(k)) continue;
			seen.add(k);
			out.push(l);
		}

		for (const l of logs) {
			const k = logKey(l);
			if (seen.has(k)) continue;
			seen.add(k);
			out.push(l);
		}

		return out;
	}, [extraHistory, logs]);

	const limitedLogs = React.useMemo(() => {
		if (!displayLimit || displayLimit <= 0) return combinedLogs;
		return combinedLogs.slice(-displayLimit);
	}, [combinedLogs, displayLimit]);

	const filteredLogs = React.useMemo(() => {
		const includeRules = keywordRules.filter((r) => r.mode === "include");
		const excludeRules = keywordRules.filter((r) => r.mode === "exclude");

		return limitedLogs.filter((log) => {
			const msg = typeof log.message === "string" ? log.message : JSON.stringify(log.message);
			const msgLower = (msg || "").toLowerCase();

			// Type-level filter
			if (logFilter !== "ALL") {
				const type = getLogType(msg || "");
				if (logFilter === "ERROR" && type !== "ERROR") return false;
				if (logFilter === "WARN" && type !== "WARN" && type !== "ERROR") return false;
				if (logFilter === "BUILD" && !(/build|codebuild|docker/i.test(msg))) return false;
				if (logFilter === "DEPLOY" && !(/deploy|ssm|ecr/i.test(msg))) return false;
			}

			// Include rules: if any exist, the line must match at least one
			if (includeRules.length > 0) {
				const matchesAny = includeRules.some((r) => msgLower.includes(r.keyword.toLowerCase()));
				if (!matchesAny) return false;
			}

			// Exclude rules: the line must not match any
			if (excludeRules.length > 0) {
				const matchesExclude = excludeRules.some((r) => msgLower.includes(r.keyword.toLowerCase()));
				if (matchesExclude) return false;
			}

			return true;
		});
	}, [limitedLogs, logFilter, keywordRules]);

	const firstErrorIndex = React.useMemo(() => {
		return filteredLogs.findIndex((log) => {
			const msg = typeof log.message === "string" ? log.message : "";
			return getLogType(msg) === "ERROR";
		});
	}, [filteredLogs]);

	const handleExportLogs = () => {
		if (logs.length === 0) return;
		const exportedAt = new Date();
		const contextLabel = serviceName || repoName || "deployment";
		const safeContext = contextLabel.replace(/[^a-zA-Z0-9-_]+/g, "-");
		const fileName = `smartdeploy-logs-${safeContext}-${exportedAt.toISOString().replace(/[:.]/g, "-")}.txt`;

		const lines = logs.map((log) => {
			const message = typeof log.message === "string" ? log.message : JSON.stringify(log.message);
			const type = getLogType(message || "");
			const time = log.timestamp ? new Date(log.timestamp).toISOString() : "-";
			return `[${time}] [${type}] ${message || "-"}`;
		});

		const header = [
			`SmartDeploy Logs Export`,
			`Context: ${contextLabel}`,
			`Exported at: ${exportedAt.toISOString()}`,
			`Filter: ${logFilter}`,
			`Total lines: ${logs.length}`,
			"",
		];

		const blob = new Blob([header.join("\n") + lines.join("\n")], { type: "text/plain;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = fileName;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	};

	const jumpToFirstError = () => {
		if (firstErrorIndex < 0) return;
		const viewport = containerRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
		if (!viewport) return;
		const rows = viewport.querySelectorAll("[data-log-row]");
		const row = rows[firstErrorIndex] as HTMLElement | undefined;
		if (row) {
			row.scrollIntoView({ behavior: "smooth", block: "center" });
			row.classList.add("ring-1", "ring-destructive/50");
			setTimeout(() => row.classList.remove("ring-1", "ring-destructive/50"), 2000);
		}
	};

	// Track whether the user is currently "close enough" to the bottom.
	// If they scrolled up, we do NOT force-scroll when new logs arrive.
	React.useEffect(() => {
		const container = containerRef.current;
		const viewport = container?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
		if (!viewport) return;

		const updateAutoScrollState = () => {
			// distance <= threshold means we're effectively at the bottom
			const thresholdPx = 40;
			const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
			shouldAutoScrollRef.current = distanceFromBottom <= thresholdPx;
			setShowScrollToBottom(distanceFromBottom > thresholdPx);
		};

		updateAutoScrollState();
		viewport.addEventListener("scroll", updateAutoScrollState, { passive: true });
		return () => viewport.removeEventListener("scroll", updateAutoScrollState);
	}, []);

	const handleScrollToBottom = () => {
		const viewport = containerRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
		if (!viewport) return;

		viewport.scrollTop = viewport.scrollHeight;
		shouldAutoScrollRef.current = true;
		setShowScrollToBottom(false);
	};

	React.useEffect(() => {
		const previousLength = prevLogsLengthRef.current;
		const currentLength = logs.length;

		if (currentLength > previousLength && shouldAutoScrollRef.current) {
			const viewport = containerRef.current?.querySelector<HTMLDivElement>(
				'[data-slot="scroll-area-viewport"]'
			);

			if (viewport) {
				viewport.scrollTop = viewport.scrollHeight;
			}
		}

		prevLogsLengthRef.current = currentLength;
	}, [logs.length]);

	async function loadMoreOlderLogs() {
		if (!serviceName) return;
		if (displayLimit && displayLimit > 0) return;
		if (!hasMoreHistoryRef.current) return;
		if (isLoadingHistoryRef.current) return;

		const viewport = containerRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
		if (!viewport) return;

		isLoadingHistoryRef.current = true;
		setIsLoadingOlderLogs(true);

		const prevScrollTop = viewport.scrollTop;
		const prevScrollHeight = viewport.scrollHeight;

		const loadedTotal = logsRef.current.length + extraHistoryRef.current.length;
		const desiredLimit = Math.min(loadedTotal + PAGE_SIZE, 5000);

		try {
			const res = await fetch(
				`/api/service-logs-history?repoName=${encodeURIComponent(repoName ?? "")}&serviceName=${encodeURIComponent(
					serviceName
				)}&limit=${encodeURIComponent(String(desiredLimit))}`
			);
			if (!res.ok) return;

			const data = await res.json();
			const fetchedLogs: LogEntry[] = Array.isArray(data?.logs) ? data.logs : [];

			const existingCombinedLogs = [...extraHistoryRef.current, ...logsRef.current];
			const existingKeys = new Set(existingCombinedLogs.map(logKey));

			const newOlderLogs = fetchedLogs.filter((l) => !existingKeys.has(logKey(l)));

			if (newOlderLogs.length > 0) {
				// fetchedLogs are chronological; the newOlderLogs are older than our current extraHistory.
				setExtraHistory((prev) => [...newOlderLogs, ...prev]);
			}

			if (fetchedLogs.length < desiredLimit) {
				setHasMoreHistory(false);
			} else if (desiredLimit >= 5000 && newOlderLogs.length === 0) {
				// Backend capped the response; no additional older logs can be loaded.
				setHasMoreHistory(false);
			}

			requestAnimationFrame(() => {
				const v = containerRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
				if (!v) return;
				const delta = v.scrollHeight - prevScrollHeight;
				v.scrollTop = prevScrollTop + delta;

				const thresholdPx = 40;
				const distanceFromBottom = v.scrollHeight - v.scrollTop - v.clientHeight;
				shouldAutoScrollRef.current = distanceFromBottom <= thresholdPx;
				setShowScrollToBottom(distanceFromBottom > thresholdPx);
			});
		} catch {
			// ignore pagination errors; live logs should still work
		} finally {
			isLoadingHistoryRef.current = false;
			setIsLoadingOlderLogs(false);
		}
	}

	// When the user scrolls near the very top, fetch the next chunk of older logs.
	React.useEffect(() => {
		const viewport = containerRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
		if (!viewport) return;
		if (!serviceName) return;
		if (displayLimit && displayLimit > 0) return;

		const onScroll = () => {
			if (viewport.scrollTop <= 20) {
				void loadMoreOlderLogs();
			}
		};

		viewport.addEventListener("scroll", onScroll, { passive: true });
		return () => viewport.removeEventListener("scroll", onScroll);
	}, [serviceName, repoName]);

	return (
		<>
			<div ref={containerRef} className="relative">
				{isLoadingOlderLogs && (
					<div
						className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-3 py-1.5 rounded-full border border-border/60 bg-background/80 text-xs font-medium text-muted-foreground shadow-sm"
						aria-live="polite"
					>
						Loading older logs...
					</div>
				)}
			{/* Filter toolbar */}
			<div className="flex flex-col border-b border-border/40 bg-card/80">
				<div className="flex items-center gap-2 px-3 py-2">
					{(["ALL", "ERROR", "WARN", "BUILD", "DEPLOY"] as LogFilter[]).map((f) => (
						<button
							key={f}
							type="button"
							className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
								logFilter === f
									? "bg-primary/15 text-primary border border-primary/30"
									: "text-muted-foreground hover:bg-muted/40 border border-transparent"
							}`}
							onClick={() => setLogFilter(f)}
						>
							{f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
							{f === "ERROR" && firstErrorIndex >= 0 && (
								<span className="ml-1 text-destructive">!</span>
							)}
						</button>
					))}

					<div className="ml-auto flex items-center gap-2">
						<button
							type="button"
							className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
								filteredLogs.length > 0
									? "text-muted-foreground hover:bg-muted/40 border border-transparent"
									: "text-muted-foreground/50 border border-transparent cursor-not-allowed"
							}`}
							onClick={handleExportLogs}
							disabled={filteredLogs.length === 0}
							title={filteredLogs.length === 0 ? "No logs to export" : "Export logs"}
						>
							<Download className="size-3" />
							Export
						</button>
						{firstErrorIndex >= 0 && (
							<button
								type="button"
								className="px-2.5 py-1 rounded-md text-xs font-medium text-destructive hover:bg-destructive/10 border border-destructive/30 transition-colors"
								onClick={jumpToFirstError}
							>
								Jump to error
							</button>
						)}
						<button
							type="button"
							className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
								showFilterInput || keywordRules.length > 0
									? "bg-primary/15 text-primary border border-primary/30"
									: "text-muted-foreground hover:bg-muted/40 border border-transparent"
							}`}
							onClick={() => setShowFilterInput((v) => !v)}
						>
							<Search className="size-3" />
							Filter
							{keywordRules.length > 0 && (
								<span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-[10px] font-bold">{keywordRules.length}</span>
							)}
						</button>
					</div>
				</div>

				{showFilterInput && (
					<div className="px-3 pb-2 space-y-2">
						<div className="flex items-center gap-2">
							<button
								type="button"
								className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
									ruleMode === "exclude"
										? "bg-destructive/15 text-destructive border border-destructive/30"
										: "text-muted-foreground hover:bg-muted/40 border border-transparent"
								}`}
								onClick={() => setRuleMode("exclude")}
							>
								<Minus className="size-3" />
								Exclude
							</button>
							<button
								type="button"
								className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
									ruleMode === "include"
										? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30"
										: "text-muted-foreground hover:bg-muted/40 border border-transparent"
								}`}
								onClick={() => setRuleMode("include")}
							>
								<Plus className="size-3" />
								Include
							</button>
							<input
								type="text"
								className="flex-1 bg-background/60 border border-border/50 rounded-md px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
								placeholder={ruleMode === "exclude" ? "Keyword to hide..." : "Keyword to show..."}
								value={ruleInput}
								onChange={(e) => setRuleInput(e.target.value)}
								onKeyDown={(e) => { if (e.key === "Enter") addKeywordRule(); }}
							/>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 px-2.5 text-xs"
								onClick={addKeywordRule}
								disabled={!ruleInput.trim()}
							>
								Add
							</Button>
						</div>
						{keywordRules.length > 0 && (
							<div className="flex flex-wrap gap-1.5">
								{keywordRules.map((rule, i) => (
									<span
										key={`${rule.mode}-${rule.keyword}-${i}`}
										className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
											rule.mode === "exclude"
												? "bg-destructive/10 text-destructive border border-destructive/20"
												: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
										}`}
									>
										{rule.mode === "exclude" ? "−" : "+"} {rule.keyword}
										<button type="button" className="hover:opacity-70" onClick={() => removeKeywordRule(i)}>
											<X className="size-3" />
										</button>
									</span>
								))}
								<button
									type="button"
									className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1"
									onClick={() => setKeywordRules([])}
								>
									Clear all
								</button>
							</div>
						)}
					</div>
				)}
			</div>

			<ScrollArea className="h-[70vh] w-full rounded-md border border-border bg-card" data-logs-scroll>
				<div className="min-w-full font-mono text-sm text-muted-foreground">
				{filteredLogs.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-20 px-4 text-center">
						{combinedLogs.length === 0 ? (
							deployStatus === "running" ? (
								<>
									<div className="size-10 mb-4 rounded-full bg-primary/10 flex items-center justify-center">
										<div className="size-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
									</div>
									<p className="text-lg font-medium text-muted-foreground/80">Waiting for logs...</p>
									<p className="text-sm text-muted-foreground/50 mt-1">Logs will appear here once the deployment starts producing output</p>
								</>
							) : (
								<>
									<p className="text-4xl mb-3">🚀</p>
									<p className="text-lg font-medium text-muted-foreground/80">Start a deploy to see logs</p>
									<p className="text-sm text-muted-foreground/50 mt-1">Deployment and service logs will appear here</p>
								</>
							)
						) : (
							<>
								<p className="text-lg font-medium text-muted-foreground/70">No matching logs</p>
								<p className="text-sm text-muted-foreground/50 mt-1">Try adjusting your filters</p>
							</>
						)}
					</div>
					) : (
						<>
							<div className="sticky top-0 z-0 grid grid-cols-[110px_160px_minmax(0,1fr)] gap-4 border-b border-border/60 bg-card px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground/90">
								<span>Type</span>
								<span>Time</span>
								<span>Message</span>
							</div>
							{filteredLogs.map((log, i) => {
								const message = typeof log.message === "string" ? log.message : JSON.stringify(log.message);
								const type = getLogType(message || "");
								const formattedTime = formatTimeOnly(log.timestamp);

								return (
									<div
										key={i}
										data-log-row
										className={`group grid w-full grid-cols-[110px_160px_minmax(0,1fr)] gap-4 border-b border-border/50 px-4 py-2 text-left transition-colors hover:bg-muted/40 cursor-pointer ${
											type === "ERROR" ? "bg-destructive/5" : ""
										}`}
										onClick={() => setSelectedLog(log)}
									>
										<span className={type === "ERROR" ? "text-destructive font-semibold" : "text-primary"}>{type}</span>
										<span className="truncate">{formattedTime}</span>
										<span className="flex items-center gap-2 truncate text-foreground">
											<span className="flex-1 truncate">{message || "-"}</span>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="opacity-0 group-hover:opacity-100 transition-opacity text-xs h-7 px-2 shrink-0"
												onClick={(e) => {
													e.stopPropagation();
													setSelectedLog(log);
												}}
											>
												Show full log
											</Button>
										</span>
									</div>
								);
							})}
						</>
					)}
				</div>
			</ScrollArea>

				{showScrollToBottom && limitedLogs.length > 0 && (
					<div className="absolute bottom-3 right-3 z-20">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="gap-2 shadow-lg bg-background/80 hover:bg-background/95"
							onClick={handleScrollToBottom}
						>
							<ChevronDown className="size-4" />
							Scroll to bottom
						</Button>
					</div>
				)}
			</div>

			<AlertDialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
				<AlertDialogContent className="w-[80vw] z-120">
					<AlertDialogHeader>
						<AlertDialogTitle>Log Message</AlertDialogTitle>
					</AlertDialogHeader>
					<div className="max-h-[60vh] overflow-auto rounded-md border border-border/60 bg-muted/20 p-3 font-mono text-sm text-foreground whitespace-pre-wrap wrap-break-word">
						{selectedLog
							? (typeof selectedLog.message === "string" ? selectedLog.message : JSON.stringify(selectedLog.message, null, 2))
							: ""}
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Close</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

