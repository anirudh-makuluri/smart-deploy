/**
 * useDeploymentHistoryWithSync
 * Manages deployment history fetching and refetching on deploy complete
 */

import { useCallback } from "react";
import { fetchDeploymentHistoryPage } from "@/lib/graphqlClient";
import { useQuery } from "@tanstack/react-query";
import type { DeploymentHistoryEntry } from "@/app/types";

interface DeploymentHistoryState {
	history: DeploymentHistoryEntry[];
	total: number;
}

interface UseDeploymentHistoryWithSyncProps {
	repoName: string | undefined;
	serviceName: string | undefined;
	deployStatus: "not-started" | "running" | "success" | "error";
}

export function useDeploymentHistoryWithSync({
	repoName,
	serviceName,
	deployStatus,
}: UseDeploymentHistoryWithSyncProps) {
	const fetchHistory = useCallback(async (): Promise<DeploymentHistoryState> => {
		if (!repoName || !serviceName) {
			throw new Error("Missing repository context for deployment history");
		}
		const data = await fetchDeploymentHistoryPage(repoName, serviceName, 1, 10);
		console.debug(`[History] Fetched ${data.history.length} entries for ${repoName}/${serviceName}`);
		return {
			history: data.history as DeploymentHistoryEntry[],
			total: data.total ?? data.history.length,
		};
	}, [repoName, serviceName]);

	const deployRefreshBucket = deployStatus === "success" || deployStatus === "error" ? "post-deploy" : "normal";

	const historyQuery = useQuery({
		queryKey: ["deployment-history-sync", repoName, serviceName, deployRefreshBucket],
		enabled: Boolean(repoName && serviceName),
		queryFn: fetchHistory,
	});

	return {
		history: historyQuery.data?.history ?? [],
		total: historyQuery.data?.total ?? 0,
		isLoading: historyQuery.isLoading,
		refetch: historyQuery.refetch,
	};
}
