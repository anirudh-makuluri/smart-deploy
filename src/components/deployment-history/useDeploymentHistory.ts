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

	const historyQuery = useQuery({
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

	const history = React.useMemo(() => historyQuery.data?.history ?? [], [historyQuery.data?.history]);
	const total = historyQuery.data?.total ?? 0;
	const loading =
		historyQuery.isLoading || (isPrefetching === true && page === 1 && !historyQuery.data);
	const error = historyQuery.error instanceof Error ? historyQuery.error.message : null;
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
				body: JSON.stringify({
					steps: entry.steps,
					configSnapshot: entry.configSnapshot,
				}),
			});
			const data = await res.json();
			if (data.response) {
				setAnalysisByEntryId((prev) => ({ ...prev, [entry.id]: data.response }));
			} else {
				setAnalysisByEntryId((prev) => ({
					...prev,
					[entry.id]: data.error || data.details || "Analysis failed.",
				}));
			}
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
