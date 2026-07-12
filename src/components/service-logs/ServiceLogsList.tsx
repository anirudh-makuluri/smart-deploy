import { formatTimeOnly, getLogType, logKey } from "@/components/service-logs/serviceLogsUtils";
import type { LogEntry } from "@/components/service-logs/types";

type ServiceLogsListProps = {
	logs: LogEntry[];
	onSelectLog: (log: LogEntry) => void;
};

export function ServiceLogsList({ logs, onSelectLog }: ServiceLogsListProps) {
	return (
		<>
			<div className="sticky top-0 z-0 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 border-b border-border/60 bg-card px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground/90 sm:grid-cols-[110px_160px_minmax(0,1fr)] sm:gap-4 sm:px-4">
				<span>Type</span>
				<span className="hidden sm:block">Time</span>
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
						className={`group grid w-full grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 border-b border-border/50 px-3 py-2 text-left transition-colors hover:bg-muted/40 cursor-pointer sm:grid-cols-[110px_160px_minmax(0,1fr)] sm:gap-4 sm:px-4 ${
							type === "ERROR" ? "bg-destructive/5" : ""
						}`}
						onClick={() => onSelectLog(log)}
					>
						<span className={type === "ERROR" ? "text-destructive font-semibold" : "text-primary"}>{type}</span>
						<span className="hidden truncate sm:block">{formattedTime}</span>
						<span className="flex min-w-0 items-start gap-2 whitespace-normal break-words text-foreground sm:items-center sm:truncate">
							<span className="flex min-w-0 flex-1 flex-col gap-1 sm:block">
								<span className="text-xs text-muted-foreground sm:hidden">{formattedTime}</span>
								<span className="sm:truncate">{message || "-"}</span>
							</span>
							<span className="hidden shrink-0 px-2 text-xs text-muted-foreground transition-opacity group-hover:opacity-100 sm:block sm:h-7 sm:opacity-0">
								Show full log
							</span>
						</span>
					</button>
				);
			})}
		</>
	);
}
