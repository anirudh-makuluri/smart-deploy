"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useEffect, useRef } from "react";
import { useAppData } from "@/store/useAppData";
import type { DeployConfig, repoType, RepoServicesRecord } from "@/app/types";

const CACHE_KEY = "smart-deploy-app-data";
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type CachedAppData = {
	userID: string;
	repoList: repoType[];
	deployments: DeployConfig[];
	repoServices?: RepoServicesRecord[];
	timestamp: number;
};

function readCache(userID: string): { repoList: repoType[]; deployments: DeployConfig[]; repoServices: RepoServicesRecord[] } | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const data: CachedAppData = JSON.parse(raw);
		if (data.userID !== userID) return null;
		if (Date.now() - data.timestamp > CACHE_MAX_AGE_MS) return null;
		return { repoList: data.repoList ?? [], deployments: data.deployments ?? [], repoServices: data.repoServices ?? [] };
	} catch {
		return null;
	}
}

function writeCache(userID: string, repoList: repoType[], deployments: DeployConfig[], repoServices: RepoServicesRecord[] = []) {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(
			CACHE_KEY,
			JSON.stringify({ userID, repoList, deployments, repoServices, timestamp: Date.now() } satisfies CachedAppData)
		);
	} catch {
		// ignore quota / private mode
	}
}

function clearCache() {
	if (typeof window === "undefined") return;
	try {
		localStorage.removeItem(CACHE_KEY);
	} catch {
		// ignore
	}
}

async function fetchAppData(): Promise<{ repoList: repoType[]; deployments: DeployConfig[]; repoServices: RepoServicesRecord[] }> {
	const [sessionRes, deploymentsRes, servicesRes] = await Promise.all([
		fetch("/api/session").then((r) => r.json()),
		fetch("/api/get-deployments").then((r) => r.json()),
		fetch("/api/repos/services").then((r) => r.json()),
	]);
	const repoList = sessionRes?.repoList ?? [];
	const deployments = deploymentsRes?.deployments ?? [];
	const repoServices = servicesRes?.services ?? [];
	return { repoList, deployments, repoServices };
}

/**
 * Fetches app data in the background and syncs it to the Zustand store.
 * On refresh, rehydrates from localStorage first (same user, cache under 7 days) so you don't see a loading state.
 */
export function useAppDataQuery() {
	const { status, data: session } = useSession();
	const userID = (session as { userID?: string } | null)?.userID;
	const { setAppData, unAuthenticated } = useAppData();
	const hasRehydrated = useRef(false);

	// Rehydrate from cache as soon as we have an authenticated user (before query runs)
	useEffect(() => {
		if (status !== "authenticated" || !userID || hasRehydrated.current) return;
		hasRehydrated.current = true;
		const cached = readCache(userID);
		if (cached) {
			setAppData(cached.repoList, cached.deployments, false, cached.repoServices);
		}
	}, [status, userID, setAppData]);

	const query = useQuery({
		queryKey: ["app-data", userID],
		queryFn: fetchAppData,
		enabled: status === "authenticated",
		staleTime: 60 * 1000,
	});

	// Sync query result to Zustand and persist to localStorage
	useEffect(() => {
		if (!query.data || !userID) return;
		setAppData(query.data.repoList, query.data.deployments, false, query.data.repoServices);
		writeCache(userID, query.data.repoList, query.data.deployments, query.data.repoServices ?? []);
	}, [query.data, userID, setAppData]);

	// Clear store and cache when user logs out
	useEffect(() => {
		if (status === "unauthenticated") {
			hasRehydrated.current = false;
			unAuthenticated();
			clearCache();
		}
	}, [status, unAuthenticated]);

	return query;
}
