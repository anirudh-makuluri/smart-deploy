"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { useAppData } from "@/store/useAppData";
import type { DeployConfig, repoType } from "@/app/types";

async function fetchAppData(): Promise<{ repoList: repoType[]; deployments: DeployConfig[] }> {
	const [sessionRes, deploymentsRes] = await Promise.all([
		fetch("/api/session").then((r) => r.json()),
		fetch("/api/get-deployments").then((r) => r.json()),
	]);
	const repoList = sessionRes?.repoList ?? [];
	const deployments = deploymentsRes?.deployments ?? [];
	return { repoList, deployments };
}

/**
 * Fetches app data in the background and syncs it to the Zustand store.
 * Enable this when authenticated so the dashboard can render immediately
 * and show data when the query resolves (no full-screen loader).
 */
export function useAppDataQuery() {
	const { status } = useSession();
	const { setAppData, unAuthenticated } = useAppData();

	const query = useQuery({
		queryKey: ["app-data"],
		queryFn: fetchAppData,
		enabled: status === "authenticated",
		staleTime: 60 * 1000,
	});

	// Sync query result to Zustand so all useAppData() consumers get the data
	useEffect(() => {
		if (query.data) {
			setAppData(query.data.repoList, query.data.deployments, false);
		}
	}, [query.data, setAppData]);

	// Clear store when user logs out
	useEffect(() => {
		if (status === "unauthenticated") {
			unAuthenticated();
		}
	}, [status, unAuthenticated]);

	return query;
}
