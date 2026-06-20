"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { DeploymentHistoryEntry } from "@/app/types";
import { fetchDeploymentHistoryPage } from "@/lib/graphqlClient";
import { doesEntryMatchActiveDeployment } from "@/components/deployment-history/deploymentHistoryUtils";
import { DEPLOYMENT_HISTORY_PAGE_LIMIT } from "@/components/deployment-history/deploymentHistoryConstants";
import type { DeploymentHistoryPageData, DeploymentHistoryProps } from "@/components/deployment-history/types";

export function useDeploymentHistory({
	repoName,
	serviceName,
	prefetchedData,
	isPrefetching,
	activeDeployment,
	activeDeploymentStatus,
}: Pick<
	DeploymentHistoryProps,
	"repoName" | "serviceName" | "prefetchedData" | "isPrefetching" | "activeDeployment" | "activeDeploymentStatus"
>) {
	const [analyzingId, setAnalyzingId] = React.useState<string | null>(null);
	const [analysisByEntryId, setAnalysisByEntryId] = React.useState<Record<string, string>>({});
	const [page, setPage] = React.useState(1);
	const limit = DEPLOYMENT_HISTORY_PAGE_LIMIT;

	const initialPageData = React.useMemo<DeploymentHistoryPageData | undefined>(() => {
		if (!prefetchedData) return undefined;
		if (Array.isArray(prefetchedData)) {
			return { history: prefetchedData, total: prefetchedData.length };
		}
		return {
			history: prefetchedData.history ?? [],
			total: prefetchedData.total ?? prefetchedData.history?.length ?? 0,
		};
	}, [prefetchedData]);

	const {
		data: historyPageData,
		isLoading: isLoadingHistory,
		error: historyQueryError,
	} = useQuery({
		queryKey: ["deployment-history", repoName, serviceName, page, limit],
		enabled: Boolean(repoName && serviceName),
		queryFn: async () => {
			const data = await fetchDeploymentHistoryPage(repoName, serviceName, page, limit);
			return {
				history: (data.history ?? []) as DeploymentHistoryEntry[],
				total: data.total ?? 0,
			};
		},
		initialData: page === 1 ? initialPageData : undefined,
	});

	const history = React.useMemo(() => historyPageData?.history ?? [], [historyPageData?.history]);
	const total = historyPageData?.total ?? 0;
	const loading =
		isLoadingHistory || (isPrefetching === true && page === 1 && !historyPageData);
	const error = historyQueryError instanceof Error ? historyQueryError.message : null;
	const activeEntryId = React.useMemo(
		() =>
			history.find((entry) =>
				doesEntryMatchActiveDeployment(entry, activeDeployment, activeDeploymentStatus)
			)?.id ?? null,
		[activeDeployment, activeDeploymentStatus, history]
	);

	const handleWhyDidItFail = React.useCallback(async (entry: DeploymentHistoryEntry) => {
		setAnalyzingId(entry.id);
		try {
			const res = await fetch("/api/llm/analyze-failure", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ runId: entry.id }),
			});
			const data = (await res.json().catch(() => ({}))) as {
				response?: string;
				error?: string;
				details?: string;
			};
			if (!res.ok) {
				throw new Error(data.error || data.details || "Analysis failed.");
			}
			setAnalysisByEntryId((prev) => ({
				...prev,
				[entry.id]: data.response || data.error || data.details || "Analysis failed.",
			}));
		} catch (err) {
			setAnalysisByEntryId((prev) => ({
				...prev,
				[entry.id]: err instanceof Error ? err.message : "Request failed.",
			}));
		} finally {
			setAnalyzingId(null);
		}
	}, []);

	return {
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
	};
}
