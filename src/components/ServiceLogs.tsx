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

export default function ServiceLogs({ logs }: { logs: LogEntry[] }) {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const prevLogsLengthRef = React.useRef(0);
	const [selectedLog, setSelectedLog] = React.useState<LogEntry | null>(null);

	React.useEffect(() => {
		const previousLength = prevLogsLengthRef.current;
		const currentLength = logs.length;

		if (currentLength > previousLength) {
			const viewport = containerRef.current?.querySelector<HTMLDivElement>(
				'[data-slot="scroll-area-viewport"]'
			);

			if (viewport) {
				viewport.scrollTop = viewport.scrollHeight;
			}
		}

		prevLogsLengthRef.current = currentLength;
	}, [logs.length]);

	return (
		<>
			<div ref={containerRef}>
				<ScrollArea className="h-[70vh] w-full rounded-md border border-border bg-card" data-logs-scroll>
					<div className="min-w-full font-mono text-sm text-muted-foreground">
						{logs.length === 0 ? (
							<p className="mt-10 text-center text-4xl text-muted-foreground/70">😴 No logs yet</p>
						) : (
							<>
								<div className="sticky top-0 z-10 grid grid-cols-[110px_160px_minmax(0,1fr)] gap-4 border-b border-border/60 bg-card px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground/90">
									<span>Type</span>
									<span>Time</span>
									<span>Message</span>
								</div>
								{logs.map((log, i) => {
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
													size="xs"
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

