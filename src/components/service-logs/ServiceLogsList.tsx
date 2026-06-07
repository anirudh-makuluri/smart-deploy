import { formatTimeOnly, getLogType, logKey } from "@/components/service-logs/serviceLogsUtils";
import type { LogEntry } from "@/components/service-logs/types";

type ServiceLogsListProps = {
	logs: LogEntry[];
	onSelectLog: (log: LogEntry) => void;
};

export function ServiceLogsList({ logs, onSelectLog }: ServiceLogsListProps) {
	return (
		<>
			<div className="sticky top-0 z-0 grid grid-cols-[110px_160px_minmax(0,1fr)] gap-4 border-b border-border/60 bg-card px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground/90">
				<span>Type</span>
				<span>Time</span>
				<span>Message</span>
			</div>
			{logs.map((log) => {
				const message = typeof log.message === "string" ? log.message : JSON.stringify(log.message);
				const type = getLogType(message || "");
				const formattedTime = formatTimeOnly(log.timestamp);

				return (
					<button
						type="button"
						key={logKey(log)}
						data-log-row
						className={`group grid w-full grid-cols-[110px_160px_minmax(0,1fr)] gap-4 border-b border-border/50 px-4 py-2 text-left transition-colors hover:bg-muted/40 cursor-pointer ${
							type === "ERROR" ? "bg-destructive/5" : ""
						}`}
						onClick={() => onSelectLog(log)}
					>
						<span className={type === "ERROR" ? "text-destructive font-semibold" : "text-primary"}>{type}</span>
						<span className="truncate">{formattedTime}</span>
						<span className="flex items-center gap-2 truncate text-foreground">
							<span className="flex-1 truncate">{message || "-"}</span>
							<span className="opacity-0 group-hover:opacity-100 transition-opacity text-xs h-7 px-2 shrink-0 text-muted-foreground">
								Show full log
							</span>
						</span>
					</button>
				);
			})}
		</>
	);
}
