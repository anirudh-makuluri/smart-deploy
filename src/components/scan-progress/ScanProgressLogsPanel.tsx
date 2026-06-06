import * as React from "react";
import { Card } from "@/components/ui/card";

type ScanProgressLogsPanelProps = {
	logs: string[];
	progress: number;
	logsEndRef: React.RefObject<HTMLDivElement | null>;
};

export function ScanProgressLogsPanel({ logs, progress, logsEndRef }: ScanProgressLogsPanelProps) {
	return (
		<div className="w-full lg:w-2/3 flex flex-col flex-1">
			<div className="flex items-center justify-between mb-2">
				<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Analysis Stream</h3>
				<div className="flex items-center gap-2">
					<span className="relative flex h-2 w-2">
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
						<span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
					</span>
					<span className="text-[10px] text-muted-foreground uppercase tracking-wider">Live Feed</span>
				</div>
			</div>

			<Card className="flex-1 min-h-[400px] flex flex-col bg-[#0d0d0d] border-[#1e1e1e] overflow-hidden">
				<div className="flex-1 p-4 font-mono text-xs md:text-sm text-gray-300 overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
					{logs.map((log) => (
						<div key={log} className="wrap-break-word">
							{log.includes("info:") ? (
								<span className="text-blue-400">{log}</span>
							) : log.includes("error:") ? (
								<span className="text-red-400">{log}</span>
							) : log.includes("event: progress") ? (
								<span className="text-purple-400">{log}</span>
							) : log.includes(">") ? (
								<span className="text-white font-semibold">{log}</span>
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
	);
}
