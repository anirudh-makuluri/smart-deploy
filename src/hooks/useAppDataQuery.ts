"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAppData } from "@/store/useAppData";
import { fetchAppOverview, fetchRepoRecords } from "@/lib/graphqlClient";
import { authClient } from "@/lib/auth-client";

/**
 * Fetches app data in the background and syncs it to the Zustand store.
 */
export function useAppDataQuery() {
	const { data: session, isPending } = authClient.useSession();
	const userID = session?.user?.id;
	const { setAppData, unAuthenticated, setRepoRecords } = useAppData();
	const hasRehydrated = useRef(false);

	// Allow cache rehydration again whenever the signed-in user id changes (e.g. switch account / provider).
	useEffect(() => {
		hasRehydrated.current = false;
	}, [userID]);

	useEffect(() => {
		if (isPending || !userID || hasRehydrated.current) return;
		hasRehydrated.current = true;
	}, [isPending, userID, setAppData]);

	const { error: errorRepoRecords } = useQuery({
		queryKey: ["repo-records", userID],
		queryFn: async () => {
			const repoRecords = await fetchRepoRecords();
			setRepoRecords(repoRecords);
			return repoRecords
		},
		enabled: !isPending && Boolean(userID),
		staleTime: 60_000,
	});

	const { error: errorAppData } = useQuery({
		queryKey: ["app-data", userID],
		queryFn: async () => {
			const { repoList, deployments, repoRecords } = await fetchAppOverview();
			setAppData(repoList, deployments, repoRecords)
			return repoList
		},
		staleTime: 60_000
	})

	// Clear store and cache when user logs out
	useEffect(() => {
		if (!isPending && !userID) {
			hasRehydrated.current = false;
			unAuthenticated();
		}
	}, [isPending, unAuthenticated, userID]);
}
