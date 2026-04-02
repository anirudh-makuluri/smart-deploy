/**
 * useDeploymentHistoryWithSync
 * Manages deployment history fetching and refetching on deploy complete
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { fetchDeploymentHistoryPage } from "@/lib/graphqlClient";

interface DeploymentHistoryState {
	history: unknown[];
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
	const [history, setHistory] = useState<DeploymentHistoryState | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const prevDeployStatusRef = useRef<typeof deployStatus>("not-started");

	const fetchHistory = useCallback(async () => {
		if (!repoName || !serviceName) return;
		setIsLoading(true);
		try {
			const data = await fetchDeploymentHistoryPage(repoName, serviceName, 1, 10);
			setHistory({
				history: data.history,
				total: data.total ?? data.history.length,
			});
			console.debug(`[History] Fetched ${data.history.length} entries for ${repoName}/${serviceName}`);
		} catch (err) {
			console.error("Failed to fetch deployment history:", err);
		} finally {
			setIsLoading(false);
		}
	}, [repoName, serviceName]);

	// Auto-fetch on mount or when repo/service changes
	useEffect(() => {
		setHistory(null);
		prevDeployStatusRef.current = "not-started";
	}, [repoName, serviceName]);

	// Re-fetch when deployment completes
	useEffect(() => {
		const prevStatus = prevDeployStatusRef.current;
		const deployFinished =
			prevStatus === "running" &&
			(deployStatus === "success" || deployStatus === "error");

		if (!history) {
			// First time - fetch
			void fetchHistory();
		} else if (deployFinished) {
			// Deployment just completed - refetch
			console.debug("[History] Deploy completed, refetching history");
			void fetchHistory();
		}

		prevDeployStatusRef.current = deployStatus;
	}, [deployStatus, history, fetchHistory]);

	return {
		history: history?.history ?? [],
		total: history?.total ?? 0,
		isLoading,
		refetch: fetchHistory,
	};
}
