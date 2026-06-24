import { CloudResources, DeployConfig, DeploymentTarget } from "@/app/types";
import { useAppData } from "@/store/useAppData";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type DeployCompleteWsPayload = {
	success: boolean;
	hosted_subdomain: string;
	deploymentTarget: DeploymentTarget;
	finalStatus: DeployConfig["status"];
	cloudResources: CloudResources;
	rolledBack: boolean; // TODO: REMOVE THIS
	error?: string;
};

export type UseWorkerWebSocketSessionParams = {
	connectionEnabled: boolean;
};

type SocketStatus = "connecting" | "open" | "closed" | "error";
type DeployStatus = "not-started" | "running" | "success" | "error";
type ServiceLogEntry = { timestamp: string; message?: string };
type DeployLogEntry = { id?: string; timestamp?: string; message?: string };
const WORKER_RECONNECT_DELAY_MS = 1000;

function getWebSocketCloseMessage(event: CloseEvent) {
	const reason = event.reason?.trim();
	if (event.code === 1008) {
		if (/unauthorized/i.test(reason)) {
			return "Worker connection rejected as unauthorized. Check BETTER_AUTH_SECRET parity between app and worker.";
		}
		if (/forbidden/i.test(reason)) {
			return "Worker connection rejected by origin policy. Check WS_ALLOWED_ORIGINS includes your frontend origin.";
		}
		return reason ? `Worker rejected connection: ${reason}` : "Worker rejected the connection (policy/auth failure).";
	}

	if (event.code === 1006) {
		return "Worker connection closed unexpectedly. Check worker availability, TLS, and reverse proxy settings.";
	}

	if (reason) {
		return `Worker connection closed: ${reason}`;
	}

	return `Worker connection closed (code ${event.code || "unknown"}).`;
}

export function getWebSocketUrl(): string {
	const override = process.env.NEXT_PUBLIC_WS_URL?.trim();
	if (override) return override;

	return "ws://localhost:4001";
}

export function getWebSocketHealthUrl(): string {
	const wsUrl = new URL(getWebSocketUrl());
	wsUrl.protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
	wsUrl.pathname = "/health";
	wsUrl.search = "";
	return wsUrl.toString();
}

export function getAuthenticatedWebSocketHealthUrl(authToken: string): string {
	const wsUrl = new URL(getWebSocketUrl());
	wsUrl.searchParams.set("auth", authToken);
	return wsUrl.toString();
}

export async function fetchWebSocketAuthToken(): Promise<string> {
	const response = await fetch("/api/ws-token", {
		method: "GET",
		credentials: "include",
		cache: "no-store",
	});

	if (!response.ok) {
		throw new Error("Failed to authenticate websocket connection");
	}

	const payload = (await response.json()) as { token?: string };
	if (!payload.token) {
		throw new Error("Missing websocket auth token");
	}

	return payload.token;
}

/**
 * One WebSocket session to the deploy worker scoped by the active workspace in app state.
 */
export function useWorkerWebSocketSession({
	connectionEnabled,
}: UseWorkerWebSocketSessionParams) {
	const repoName = useAppData((s) => s.activeRepo)?.name ?? null;
	const serviceName = useAppData((s) => s.activeServiceName) ?? null;

	const [deployLogEntries, setDeployLogEntries] = useState<DeployLogEntry[]>([]);
	const [socketStatus, setSocketStatus] = useState<SocketStatus>("connecting");
	const [deployStatus, setDeployStatus] = useState<DeployStatus>("not-started");
	const [deployError, setDeployError] = useState<string | null>(null);
	const [serviceLogs, setServiceLogs] = useState<ServiceLogEntry[]>([]);
	const [liveDeployConfig, setLiveDeployConfig] = useState<DeployConfig | null>(null);

	const isDeployingRef = useRef(false);
	const wsRef = useRef<WebSocket | null>(null);
	const onDeployFinishedRef = useRef<((payload: DeployCompleteWsPayload) => void) | undefined>(undefined);
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const manualDisconnectRef = useRef(false);

	const assignDeployConfig = useCallback((config: DeployConfig | null) => {
		setLiveDeployConfig(config);
	}, []);

	const disconnectSocket = useCallback(() => {
		manualDisconnectRef.current = true;
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}
		wsRef.current?.close();
		wsRef.current = null;
	}, []);

	const setOnDeployFinished = useCallback((handler: ((payload: DeployCompleteWsPayload) => void) | undefined) => {
		onDeployFinishedRef.current = handler;
	}, []);

	const replaceServiceLogs = useCallback((logs: ServiceLogEntry[]) => {
		setServiceLogs(logs);
	}, []);

	const deployLogs = useCallback(({ id, msg, time }: { id: string; msg: string; time?: string }) => {
		setDeployStatus("running");
		setDeployLogEntries((prev) => [
			...prev,
			{
				id,
				timestamp: time,
				message: msg,
			},
		]);
	}, []);

	const initiateServiceLogs = useCallback(() => {
		if (!serviceName && !repoName) return;

		const socket = wsRef.current;
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({
				type: "service_logs",
				payload: { serviceName, repoName },
			}));
		}
	}, [repoName, serviceName]);

	const createWebSocketRef = useRef<() => void>(() => {});

	const scheduleReconnect = useCallback(() => {
		if (!connectionEnabled || reconnectTimeoutRef.current) return;
		reconnectTimeoutRef.current = setTimeout(() => {
			reconnectTimeoutRef.current = null;
			createWebSocketRef.current();
		}, WORKER_RECONNECT_DELAY_MS);
	}, [connectionEnabled]);

	const createWebSocket = useCallback(() => {
		manualDisconnectRef.current = false;
		setSocketStatus("connecting");
		void (async () => {
			try {
				const authToken = await fetchWebSocketAuthToken();
				const wsUrl = new URL(getAuthenticatedWebSocketHealthUrl(authToken));
				const ws = new WebSocket(wsUrl.toString());
				wsRef.current = ws;

				ws.onopen = () => {
					if (reconnectTimeoutRef.current) {
						clearTimeout(reconnectTimeoutRef.current);
						reconnectTimeoutRef.current = null;
					}
					setSocketStatus("open");
					setDeployError(null);
					initiateServiceLogs();
				};

				ws.onmessage = (event) => {
					const data = JSON.parse(event.data) as { type: string; payload?: unknown };
					const payload = data.payload;

					switch (data.type) {
						case "initial_logs":
							replaceServiceLogs((payload as { logs?: ServiceLogEntry[] } | undefined)?.logs ?? []);
							break;
						case "deploy_logs":
							deployLogs(payload as { id: string; msg: string; time: string });
							break;
						case "deploy_complete": {
							const completePayload = payload as DeployCompleteWsPayload;
							isDeployingRef.current = false;
							setDeployStatus(completePayload.success ? "success" : "error");

							if (!completePayload.success) {
								setDeployError(completePayload.error ?? "Deployment failed");
							}

							onDeployFinishedRef.current?.(completePayload);
							initiateServiceLogs();
							break;
						}
						default:
							break;
					}
				};

				ws.onerror = () => {
					setSocketStatus("error");
					if (isDeployingRef.current) {
						setDeployStatus("error");
						setDeployError("Worker connection error during deployment.");
					}
				};

				ws.onclose = (event) => {
					setSocketStatus("closed");
					const closeMessage = getWebSocketCloseMessage(event);
					if (isDeployingRef.current) {
						setDeployStatus("error");
						setDeployError(closeMessage);
					}
					isDeployingRef.current = false;
					wsRef.current = null;
					if (!manualDisconnectRef.current) {
						scheduleReconnect();
					}
				};
			} catch (error) {
				setSocketStatus("error");
				const message = error instanceof Error ? error.message : "Failed to authenticate websocket connection";
				setDeployError(message);
				scheduleReconnect();
			}
		})();
	}, [deployLogs, initiateServiceLogs, replaceServiceLogs, scheduleReconnect]);

	createWebSocketRef.current = createWebSocket;

	const openSocket = useCallback(() => {
		const existing = wsRef.current;
		if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
			return existing;
		}

		createWebSocket();
		return null;
	}, [createWebSocket]);

	useEffect(() => {
		if (!connectionEnabled) {
			disconnectSocket();
			setSocketStatus("closed");
			return;
		}

		openSocket();
	}, [connectionEnabled, disconnectSocket, openSocket]);

	useEffect(() => {
		return () => {
			disconnectSocket();
		};
	}, [disconnectSocket]);

	const sendDeployConfig = (deployConfig: DeployConfig, token: string, userID: string) => {
		assignDeployConfig(deployConfig);
		isDeployingRef.current = true;
		setDeployError(null);
		setDeployStatus("running");
		setDeployLogEntries([]);
		setServiceLogs([]);

		const socket = wsRef.current;
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({
				type: "deploy",
				payload: {
					deployConfig,
					token,
					userID,
				},
			}));
		} else {
			toast.error("Error occured. Refresh the page and try again.");
			isDeployingRef.current = false;
			setDeployError("Error occured. Refresh the page and try again.");
			setDeployStatus("not-started");
		}
	};

	return {
		deployLogEntries,
		socketStatus,
		sendDeployConfig,
		openSocket,
		liveDeployConfig,
		deployStatus,
		deployError,
		initiateServiceLogs,
		serviceLogs,
		setOnDeployFinished,
	};
}
