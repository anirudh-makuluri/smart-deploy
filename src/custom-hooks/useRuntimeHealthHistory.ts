"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { RuntimeHealthSample } from "@/app/types";

const EMPTY_RUNTIME_HEALTH_ENTRIES: RuntimeHealthSample[] = [];

export function useRuntimeHealthHistory(args: {
	repoName: string | undefined;
	serviceName: string | undefined;
}): {
	entries: RuntimeHealthSample[];
	isLoading: boolean;
} {
	const runtimeHealthTarget = React.useMemo(() => {
		const normalizedRepoName = args.repoName?.trim() ?? "";
		const normalizedServiceName = args.serviceName?.trim() ?? "";
		if (!normalizedRepoName || !normalizedServiceName) return null;
		return {
			repoName: normalizedRepoName,
			serviceName: normalizedServiceName,
		};
	}, [args.repoName, args.serviceName]);

	const { data, isLoading } = useQuery<RuntimeHealthSample[]>({
		queryKey: [
			"runtime-health-history",
			runtimeHealthTarget?.repoName ?? null,
			runtimeHealthTarget?.serviceName ?? null,
		],
		enabled: runtimeHealthTarget !== null,
		queryFn: async () => {
			if (!runtimeHealthTarget) return EMPTY_RUNTIME_HEALTH_ENTRIES;

			try {
				const params = new URLSearchParams(runtimeHealthTarget);
				const response = await fetch(`/api/deployments/runtime-health?${params.toString()}`, {
					cache: "no-store",
				});
				if (!response.ok) {
					return EMPTY_RUNTIME_HEALTH_ENTRIES;
				}
				const payload = (await response.json()) as { entries?: RuntimeHealthSample[] };
				return Array.isArray(payload.entries) ? payload.entries : EMPTY_RUNTIME_HEALTH_ENTRIES;
			} catch (error) {
				console.error("Failed to load runtime health history:", error);
				return EMPTY_RUNTIME_HEALTH_ENTRIES;
			}
		},
	});

	return {
		entries: data ?? EMPTY_RUNTIME_HEALTH_ENTRIES,
		isLoading: runtimeHealthTarget !== null && isLoading,
	};
}
