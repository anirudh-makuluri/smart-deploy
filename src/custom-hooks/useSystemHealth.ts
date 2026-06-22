"use client";

import { useQuery } from "@tanstack/react-query";

export type SystemHealthStatus = "checking" | "healthy" | "degraded" | "unavailable";

export type SystemHealthService = {
	name: string;
	status: "healthy" | "unavailable";
	message: string;
};

type SystemHealthState = {
	status: SystemHealthStatus;
	message: string;
	services: SystemHealthService[];
};

const DEFAULT_STATE: SystemHealthState = {
	status: "checking",
	message: "Checking system health",
	services: [],
};

async function fetchSystemHealth(): Promise<SystemHealthState> {
	const response = await fetch("/api/system-health", {
		method: "GET",
		cache: "no-store",
	});

	if (response.status === 401) {
		return {
			status: "unavailable",
			message: "Sign in to view system health",
			services: [],
		};
	}

	if (!response.ok) {
		return {
			status: "unavailable",
			message: "System health check failed",
			services: [],
		};
	}

	const data = (await response.json()) as {
		status?: SystemHealthStatus;
		message?: string;
		services?: SystemHealthService[];
	};

	return {
		status: data.status ?? "degraded",
		message: data.message ?? "System health updated",
		services: Array.isArray(data.services) ? data.services : [],
	};
}

export function useSystemHealth(): SystemHealthState {
	const { data } = useQuery({
		queryKey: ["system-health"],
		queryFn: fetchSystemHealth
	});

	return data ?? DEFAULT_STATE;
}
