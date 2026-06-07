"use client";

import { Accordion } from "@/components/ui/accordion";
import { DeploymentHistoryEmpty } from "@/components/deployment-history/DeploymentHistoryEmpty";
import { DeploymentHistoryEntryItem } from "@/components/deployment-history/DeploymentHistoryEntryItem";
import { DeploymentHistoryError } from "@/components/deployment-history/DeploymentHistoryError";
import { DeploymentHistoryLoading } from "@/components/deployment-history/DeploymentHistoryLoading";
import { DeploymentHistoryPagination } from "@/components/deployment-history/DeploymentHistoryPagination";
import { useDeploymentHistory } from "@/components/deployment-history/useDeploymentHistory";
import type { DeploymentHistoryProps } from "@/components/deployment-history/types";

export default function DeploymentHistory(props: DeploymentHistoryProps) {
	const {
		history,
		total,
		loading,
		error,
		page,
		setPage,
		limit,
		activeEntryId,
		analyzingId,
		analysisByEntryId,
		handleWhyDidItFail,
	} = useDeploymentHistory(props);

	if (loading) {
		return <DeploymentHistoryLoading />;
	}

	if (error) {
		return <DeploymentHistoryError message={error} />;
	}

	if (history.length === 0) {
		return <DeploymentHistoryEmpty />;
	}

	return (
		<div className="rounded-lg border border-border bg-card overflow-hidden">
			<Accordion type="multiple" className="w-full">
				{history.map((entry) => (
					<DeploymentHistoryEntryItem
						key={entry.id}
						entry={entry}
						isActiveRelease={activeEntryId === entry.id}
						analyzingId={analyzingId}
						analysisText={analysisByEntryId[entry.id]}
						rollbackingEntryId={props.rollbackingEntryId}
						onWhyDidItFail={handleWhyDidItFail}
						onRollback={props.onRollback}
					/>
				))}
			</Accordion>
			<DeploymentHistoryPagination
				page={page}
				total={total}
				limit={limit}
				loading={loading}
				onPrevious={() => setPage((current) => Math.max(1, current - 1))}
				onNext={() => setPage((current) => current + 1)}
			/>
		</div>
	);
}
