import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { LogEntry } from "@/components/service-logs/types";

type ServiceLogsDetailDialogProps = {
	selectedLog: LogEntry | null;
	onClose: () => void;
};

export function ServiceLogsDetailDialog({ selectedLog, onClose }: ServiceLogsDetailDialogProps) {
	return (
		<AlertDialog open={!!selectedLog} onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent className="w-[80vw] z-120">
				<AlertDialogHeader>
					<AlertDialogTitle>Log Message</AlertDialogTitle>
				</AlertDialogHeader>
				<div className="max-h-[60vh] overflow-auto rounded-md border border-border/60 bg-muted/20 p-3 font-mono text-sm text-foreground whitespace-pre-wrap wrap-break-word">
					{selectedLog
						? typeof selectedLog.message === "string"
							? selectedLog.message
							: JSON.stringify(selectedLog.message, null, 2)
						: ""}
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel>Close</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
