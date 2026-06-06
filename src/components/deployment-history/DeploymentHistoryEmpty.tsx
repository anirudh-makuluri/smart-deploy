import { History } from "lucide-react";

export function DeploymentHistoryEmpty() {
	return (
		<div className="rounded-lg border border-border bg-card p-6 text-muted-foreground text-sm">
			<p className="flex items-center gap-2">
				<History className="size-4" />
				No deployment history yet. Deploy once to see success/failure logs here.
			</p>
		</div>
	);
}
