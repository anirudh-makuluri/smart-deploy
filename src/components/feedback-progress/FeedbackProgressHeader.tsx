import { RefreshCw } from "lucide-react";

export function FeedbackProgressHeader() {
	return (
		<div className="flex items-center gap-3 mb-6">
			<div className="p-2 bg-primary/10 rounded-lg">
				<RefreshCw className="size-5 text-primary" />
			</div>
			<div>
				<h2 className="text-xl font-semibold text-foreground tracking-tight">Improving Scan Results</h2>
				<p className="text-sm text-muted-foreground">
					sd-artifacts re-runs clone → Railpack build/repair → finalize on your cached analysis (no full rescan)
				</p>
			</div>
		</div>
	);
}
