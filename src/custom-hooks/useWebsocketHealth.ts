"use client";

import * as React from "react";
import { fetchWebSocketAuthToken, getAuthenticatedWebSocketHealthUrl } from "./useWorkerWebSocket";

export type WorkerHealthStatus = "checking" | "healthy" | "unavailable";

type WorkerHealthState = {
	status: WorkerHealthStatus;
	message: string;
};

const DEFAULT_STATE: WorkerHealthState = {
	status: "checking",
	message: "Checking deploy worker",
};

const PROBE_TIMEOUT_MS = 10_000;

function probeBrowserWebSocket(url: string, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let opened = false;
		let ws: WebSocket | undefined;

		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			fn();
		};

		const timer = window.setTimeout(() => {
			try {
				ws?.close();
			} catch {
				/* ignore */
			}
			finish(() => reject(new Error("WebSocket connection timed out")));
		}, timeoutMs);

		try {
			ws = new WebSocket(url);
		} catch (e) {
			finish(() => reject(e instanceof Error ? e : new Error("Invalid WebSocket URL")));
			return;
		}

		ws.onopen = () => {
			opened = true;
			try {
				ws?.close();
			} catch {
				/* ignore */
			}
			finish(() => resolve());
		};

		ws.onerror = () => {
			if (!opened) {
				finish(() => reject(new Error("WebSocket connection failed")));
			}
		};

		ws.onclose = () => {
			if (!opened) {
				finish(() => reject(new Error("WebSocket closed before handshake")));
			}
		};
	});
}

export function useWebsocketHealth(pollMs: number = 30000): WorkerHealthState {
	const [state, setState] = React.useState<WorkerHealthState>(DEFAULT_STATE);

	React.useEffect(() => {
		let cancelled = false;

		const checkHealth = async () => {
			setState((prev) => (prev.status === "healthy" ? prev : DEFAULT_STATE));
			try {
				const authToken = await fetchWebSocketAuthToken();
				const url = getAuthenticatedWebSocketHealthUrl(authToken);
				await probeBrowserWebSocket(url, PROBE_TIMEOUT_MS);

				if (!cancelled) {
					setState({
						status: "healthy",
						message: "Deploy worker online",
					});
				}
			} catch {
				if (!cancelled) {
					setState({
						status: "unavailable",
						message: "Deploy worker offline",
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
