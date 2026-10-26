import { ProgressStreamFooter } from "@/components/progress/ProgressStreamFooter";
import * as React from "react";
import { Card } from "@/components/ui/card";

type FeedbackStreamPanelProps = {
	logs: string[];
	progress: number;
	logsEndRef: React.RefObject<HTMLDivElement | null>;
};

function FeedbackLogLine({ log }: { log: string }) {
	if (log.includes("info:")) {
		return <span className="text-blue-400">{log}</span>;
	}
	if (log.includes("error:")) {
		return <span className="text-red-400">{log}</span>;
	}
	if (log.includes("event: progress")) {
		return <span className="text-purple-400">{log}</span>;
	}
	return <span className="text-gray-400">{log}</span>;
}

export function FeedbackStreamPanel({ logs, progress, logsEndRef }: FeedbackStreamPanelProps) {
	return (
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
					{logs.map((log) => (
						<div key={log} className="wrap-break-word">
							<FeedbackLogLine log={log} />
						</div>
					))}
					<div ref={logsEndRef} />
				</div>

				<ProgressStreamFooter progress={progress} />
			</Card>
		</div>
	);
}
