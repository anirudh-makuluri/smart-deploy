import { Loader2 } from "lucide-react";

export function DeploymentHistoryLoading() {
	return (
		<div className="rounded-lg border border-border bg-card p-6 flex items-center gap-3 text-muted-foreground">
			<Loader2 className="size-5 animate-spin" />
			<span>Loading deployment history…</span>
		</div>
	);
}
