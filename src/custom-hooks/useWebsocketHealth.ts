"use client";

import * as React from "react";
import { fetchWebSocketAuthToken, getAuthenticatedWebSocketHealthUrl } from "./useDeployLogs";

export type WorkerHealthStatus = "checking" | "healthy" | "unavailable";

type WorkerHealthState = {
	status: WorkerHealthStatus;
	message: string;
};

const DEFAULT_STATE: WorkerHealthState = {
	status: "checking",
	message: "Checking deploy worker",
};

export function useWebsocketHealth(pollMs: number = 30000): WorkerHealthState {
	const [state, setState] = React.useState<WorkerHealthState>(DEFAULT_STATE);

	React.useEffect(() => {
		let cancelled = false;

		const checkHealth = async () => {
			setState((prev) => (prev.status === "healthy" ? prev : DEFAULT_STATE));
			try {
				const authToken = await fetchWebSocketAuthToken();
				const response = await fetch(getAuthenticatedWebSocketHealthUrl(authToken), {
					method: "GET",
					cache: "no-store",
				});

				if (!response.ok) {
					throw new Error(`Health check returned ${response.status}`);
				}

				const payload = (await response.json()) as { ok?: boolean; service?: string };
				if (!cancelled) {
					setState({
						status: payload.ok ? "healthy" : "unavailable",
						message: payload.ok ? "Deploy worker online" : "Deploy worker unhealthy",
					});
				}
			} catch {
				if (!cancelled) {
					setState({
						status: "unavailable",
						message: "Deploy worker unavailable",
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
