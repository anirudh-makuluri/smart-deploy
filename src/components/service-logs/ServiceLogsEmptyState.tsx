import type { LogEntry } from "@/components/service-logs/types";

type ServiceLogsEmptyStateProps = {
	combinedLogsCount: number;
	deployStatus?: string;
};

export function ServiceLogsEmptyState({ combinedLogsCount, deployStatus }: ServiceLogsEmptyStateProps) {
	return (
		<div className="flex flex-col items-center justify-center py-20 px-4 text-center">
			{combinedLogsCount === 0 ? (
				deployStatus === "running" ? (
					<>
						<div className="size-10 mb-4 rounded-full bg-primary/10 flex items-center justify-center">
							<div className="size-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
						</div>
						<p className="text-lg font-medium text-muted-foreground/80">Waiting for logs...</p>
						<p className="text-sm text-muted-foreground/50 mt-1">
							Logs will appear here once the deployment starts producing output
						</p>
					</>
				) : (
					<>
						<p className="text-4xl mb-3">🚀</p>
						<p className="text-lg font-medium text-muted-foreground/80">Start a deploy to see logs</p>
						<p className="text-sm text-muted-foreground/50 mt-1">
							Deployment and service logs will appear here
						</p>
					</>
				)
			) : (
				<>
					<p className="text-lg font-medium text-muted-foreground/70">No matching logs</p>
					<p className="text-sm text-muted-foreground/50 mt-1">Try adjusting your filters</p>
				</>
			)}
		</div>
	);
}
