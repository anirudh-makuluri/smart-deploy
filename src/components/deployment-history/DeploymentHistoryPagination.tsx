import { Button } from "@/components/ui/button";

type DeploymentHistoryPaginationProps = {
	page: number;
	total: number;
	limit: number;
	loading: boolean;
	onPrevious: () => void;
	onNext: () => void;
};

export function DeploymentHistoryPagination({
	page,
	total,
	limit,
	loading,
	onPrevious,
	onNext,
}: DeploymentHistoryPaginationProps) {
	const totalPages = Math.max(1, Math.ceil(total / limit));

	return (
		<div className="flex items-center justify-between border-t border-border px-4 py-3">
			<p className="text-xs text-muted-foreground">
				Page {page} of {totalPages}
			</p>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					className="border-border bg-transparent"
					disabled={page === 1 || loading}
					onClick={onPrevious}
				>
					Previous
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="border-border bg-transparent"
					disabled={page >= totalPages || loading}
					onClick={onNext}
				>
					Next
				</Button>
			</div>
		</div>
	);
}
