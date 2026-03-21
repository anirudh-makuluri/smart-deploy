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
import { ChevronDown } from "lucide-react";

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

export default function ServiceLogs({
	logs,
	serviceName,
	repoName,
}: {
	logs: LogEntry[];
	serviceName?: string;
	repoName?: string;
	[key: string]: unknown;
}) {

	const containerRef = React.useRef<HTMLDivElement>(null);
	const prevLogsLengthRef = React.useRef(0);
	const shouldAutoScrollRef = React.useRef(true);
	const [showScrollToBottom, setShowScrollToBottom] = React.useState(false);
	const [selectedLog, setSelectedLog] = React.useState<LogEntry | null>(null);

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
				<ScrollArea className="h-[70vh] w-full rounded-md border border-border bg-card" data-logs-scroll>
					<div className="min-w-full font-mono text-sm text-muted-foreground">
						{combinedLogs.length === 0 ? (
							<p className="mt-10 text-center text-4xl text-muted-foreground/70">😴 No logs yet</p>
						) : (
							<>
								<div className="sticky top-0 z-0 grid grid-cols-[110px_160px_minmax(0,1fr)] gap-4 border-b border-border/60 bg-card px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground/90">
									<span>Type</span>
									<span>Time</span>
									<span>Message</span>
								</div>
								{combinedLogs.map((log, i) => {
									const message = typeof log.message === "string" ? log.message : JSON.stringify(log.message);
									const type = getLogType(message || "");
									const formattedTime = formatTimeOnly(log.timestamp);

									return (
										<div
											key={i}
											className="group grid w-full grid-cols-[110px_160px_minmax(0,1fr)] gap-4 border-b border-border/50 px-4 py-2 text-left transition-colors hover:bg-muted/40 cursor-pointer"
											onClick={() => setSelectedLog(log)}
										>
											<span className="text-primary">{type}</span>
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

				{showScrollToBottom && combinedLogs.length > 0 && (
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

