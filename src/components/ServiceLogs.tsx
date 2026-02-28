"use client";

import React from "react";
import { ScrollArea } from "./ui/scroll-area";
import { formatLogTimestamp } from "@/lib/utils";

type LogEntry = { timestamp?: string; message?: string };

export default function ServiceLogs({ logs }: { logs: LogEntry[] }) {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const prevLogsLengthRef = React.useRef(0);

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
		<div ref={containerRef}>
			<ScrollArea className="h-[70vh] w-full rounded-md border border-border bg-card p-4" data-logs-scroll>
				<div className="space-y-2 font-mono text-sm text-muted-foreground">
					{logs.length == 0 ? (
						<p className="text-center text-4xl mt-10 text-muted-foreground/70">😴 No logs yet</p>
					) : (
						logs.map((log, i) => (
							<div key={i} className="wrap-break-word whitespace-pre-wrap w-full">
								{log.timestamp && !Number.isNaN(new Date(log.timestamp).getTime()) && (
									<>
										<span className="text-primary">{formatLogTimestamp(log.timestamp)}</span>
										{" - "}
									</>
								)}
								<span className="wrap-break-word whitespace-pre-wrap text-foreground">
									{typeof log.message === "string" ? log.message : JSON.stringify(log.message)}
								</span>
							</div>
						))
					)}
				</div>
			</ScrollArea>
		</div>
	);
}

