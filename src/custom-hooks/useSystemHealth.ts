"use client";

import * as React from "react";

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

export function useSystemHealth(pollMs: number = 30000): SystemHealthState {
	const [state, setState] = React.useState<SystemHealthState>(DEFAULT_STATE);

	React.useEffect(() => {
		let cancelled = false;

		const checkHealth = async () => {
			setState((prev) => (prev.status === "healthy" ? prev : DEFAULT_STATE));

			try {
				const response = await fetch("/api/system-health", {
					method: "GET",
					cache: "no-store",
				});

				if (response.status === 401) {
					throw new Error("Sign in to view service health");
				}

				if (!response.ok) {
					throw new Error(`Health check returned ${response.status}`);
				}

				const payload = (await response.json()) as {
					status?: "healthy" | "degraded";
					services?: SystemHealthService[];
				};
				const nextStatus = payload.status === "healthy" ? "healthy" : "degraded";

				if (!cancelled) {
					setState({
						status: nextStatus,
						message: nextStatus === "healthy" ? "All systems online" : "One or more services need attention",
						services: payload.services ?? [],
					});
				}
			} catch (error) {
				if (!cancelled) {
					setState({
						status: "unavailable",
						message: error instanceof Error ? error.message : "System health unavailable",
						services: [],
					});
				}
			}
		};

		void checkHealth();
		const interval = window.setInterval(() => {
			void checkHealth();
		}, pollMs);

		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, [pollMs]);

	return state;
}
