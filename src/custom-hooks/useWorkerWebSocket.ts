import { CloudResources, DeployConfig, DeploymentTarget } from "@/app/types";
import { authClient } from "@/lib/auth-client";
import { useAppData } from "@/store/useAppData";
import { useCallback, useEffect, useReducer, useRef } from "react";
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

type SocketStatus = "connecting" | "open" | "closed" | "error";
type DeployStatus = "not-started" | "running" | "success" | "error";
type ServiceLogEntry = { timestamp: string; message?: string };
type DeployLogEntry = { id?: string; timestamp?: string; message?: string };
type DeployCompleteEvent = {
	payload: DeployCompleteWsPayload;
	receivedAt: number;
};
type WorkerWebSocketState = {
	deployStatus: DeployStatus;
	deployError: string | null;
	deployLogEntries: DeployLogEntry[];
	serviceLogs: ServiceLogEntry[];
	liveDeployConfig: DeployConfig | null;
	deployCompleteEvent: DeployCompleteEvent | null;
};
const WORKER_RECONNECT_DELAY_MS = 1000;

const INITIAL_WORKER_WEBSOCKET_STATE: WorkerWebSocketState = {
	deployStatus: "not-started",
	deployError: null,
	deployLogEntries: [],
	serviceLogs: [],
	liveDeployConfig: null,
	deployCompleteEvent: null,
};

function workerWebSocketReducer(
	state: WorkerWebSocketState,
	action:
		| { type: "start_deploy"; deployConfig: DeployConfig }
		| { type: "append_deploy_log"; entry: DeployLogEntry }
		| { type: "set_service_logs"; logs: ServiceLogEntry[] }
		| { type: "set_live_deploy_config"; deployConfig: DeployConfig | null }
		| { type: "set_deploy_complete"; event: DeployCompleteEvent }
		| { type: "set_status"; status: DeployStatus }
		| { type: "set_error"; error: string | null; status?: DeployStatus }
): WorkerWebSocketState {
	switch (action.type) {
		case "start_deploy":
			return {
				...state,
				deployStatus: "running",
				deployError: null,
				deployLogEntries: [],
				serviceLogs: [],
				liveDeployConfig: action.deployConfig,
				deployCompleteEvent: null,
			};
		case "append_deploy_log":
			return {
				...state,
				deployStatus: "running",
				deployError: null,
				deployLogEntries: [...state.deployLogEntries, action.entry],
			};
		case "set_service_logs":
			return {
				...state,
				serviceLogs: action.logs,
			};
		case "set_live_deploy_config":
			return {
				...state,
				liveDeployConfig: action.deployConfig,
			};
		case "set_deploy_complete":
			return {
				...state,
				deployStatus: action.event.payload.success ? "success" : "error",
				deployError: action.event.payload.success
					? null
					: action.event.payload.error ?? "Deployment failed",
				deployCompleteEvent: action.event,
			};
		case "set_status":
			return {
				...state,
				deployStatus: action.status,
				deployError: action.status === "running" || action.status === "not-started" ? null : state.deployError,
			};
		case "set_error":
			return {
				...state,
				deployStatus: action.status ?? state.deployStatus,
				deployError: action.error,
			};
		default:
			return state;
	}
}

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
	if (typeof window !== "undefined") {
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		return `${protocol}//${window.location.host}`;
	}

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
export function useWorkerWebSocketSession() {
	const { data: session } = authClient.useSession();
	const connectionEnabled = Boolean(session?.user?.id);
	const repoName = useAppData((s) => s.activeRepo)?.name ?? null;
	const serviceName = useAppData((s) => s.activeServiceName) ?? null;

	const [workerState, dispatchWorkerState] = useReducer(
		workerWebSocketReducer,
		INITIAL_WORKER_WEBSOCKET_STATE
	);
	const [, rerenderSocket] = useReducer((count: number) => count + 1, 0);

	const isDeployingRef = useRef(false);
	const socketHasErrorRef = useRef(false);
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const manualDisconnectRef = useRef(false);

	const disconnectSocket = useCallback(() => {
		manualDisconnectRef.current = true;
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}
		socketHasErrorRef.current = false;
		wsRef.current?.close();
		wsRef.current = null;
		rerenderSocket();
	}, []);

	const deployLogs = useCallback(({ id, msg, time }: { id: string; msg: string; time?: string }) => {
		dispatchWorkerState({
			type: "append_deploy_log",
			entry: {
				id,
				timestamp: time,
				message: msg,
			},
		});
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

	const createWebSocket = useCallback(function createWebSocket() {
		manualDisconnectRef.current = false;
		socketHasErrorRef.current = false;
		void (async () => {
			try {
				const authToken = await fetchWebSocketAuthToken();
				const wsUrl = new URL(getAuthenticatedWebSocketHealthUrl(authToken));
				const ws = new WebSocket(wsUrl.toString());
				wsRef.current = ws;
				rerenderSocket();

				ws.onopen = () => {
					if (reconnectTimeoutRef.current) {
						clearTimeout(reconnectTimeoutRef.current);
						reconnectTimeoutRef.current = null;
					}
					socketHasErrorRef.current = false;
					rerenderSocket();
					dispatchWorkerState({ type: "set_error", error: null });
					initiateServiceLogs();
				};

				ws.onmessage = (event) => {
					const data = JSON.parse(event.data) as { type: string; payload?: unknown };
					const payload = data.payload;

					switch (data.type) {
						case "initial_logs":
							dispatchWorkerState({
								type: "set_service_logs",
								logs: (payload as { logs?: ServiceLogEntry[] } | undefined)?.logs ?? [],
							});
							break;
						case "deploy_logs":
							deployLogs(payload as { id: string; msg: string; time: string });
							break;
						case "deploy_complete": {
							const completePayload = payload as DeployCompleteWsPayload;
							isDeployingRef.current = false;
							dispatchWorkerState({
								type: "set_deploy_complete",
								event: {
									payload: completePayload,
									receivedAt: Date.now(),
								},
							});
							initiateServiceLogs();
							break;
						}
						default:
							break;
					}
				};

				ws.onerror = () => {
					socketHasErrorRef.current = true;
					rerenderSocket();
					if (isDeployingRef.current) {
						dispatchWorkerState({
							type: "set_error",
							error: "Worker connection error during deployment.",
							status: "error",
						});
					}
				};

				ws.onclose = (event) => {
					const closeMessage = getWebSocketCloseMessage(event);
					if (isDeployingRef.current) {
						dispatchWorkerState({
							type: "set_error",
							error: closeMessage,
							status: "error",
						});
					}
					isDeployingRef.current = false;
					wsRef.current = null;
					rerenderSocket();
					if (!manualDisconnectRef.current && connectionEnabled && !reconnectTimeoutRef.current) {
						reconnectTimeoutRef.current = setTimeout(() => {
							reconnectTimeoutRef.current = null;
							createWebSocket();
						}, WORKER_RECONNECT_DELAY_MS);
					}
				};
			} catch (error) {
				socketHasErrorRef.current = true;
				wsRef.current = null;
				rerenderSocket();
				const message = error instanceof Error ? error.message : "Failed to authenticate websocket connection";
				dispatchWorkerState({ type: "set_error", error: message });
				if (connectionEnabled && !reconnectTimeoutRef.current) {
					reconnectTimeoutRef.current = setTimeout(() => {
						reconnectTimeoutRef.current = null;
						createWebSocket();
					}, WORKER_RECONNECT_DELAY_MS);
				}
			}
		})();
	}, [connectionEnabled, deployLogs, initiateServiceLogs]);

	useEffect(() => {
		if (!connectionEnabled) {
			disconnectSocket();
			return;
		}

		const existing = wsRef.current;
		if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
			return;
		}

		createWebSocket();
	}, [connectionEnabled, createWebSocket, disconnectSocket]);

	useEffect(() => {
		return () => {
			disconnectSocket();
		};
	}, [disconnectSocket]);

	const sendDeployConfig = (deployConfig: DeployConfig, token: string, userID: string) => {
		isDeployingRef.current = true;
		dispatchWorkerState({ type: "start_deploy", deployConfig });

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
			dispatchWorkerState({
				type: "set_error",
				error: "Error occured. Refresh the page and try again.",
				status: "not-started",
			});
		}
	};

	const socketReadyState = wsRef.current?.readyState ?? null;
	const socketStatus: SocketStatus = !connectionEnabled
		? "closed"
		: socketHasErrorRef.current
			? "error"
			: socketReadyState === WebSocket.OPEN
				? "open"
				: socketReadyState === WebSocket.CONNECTING
					? "connecting"
					: "closed";

	return {
		deployLogEntries: workerState.deployLogEntries,
		socketStatus,
		sendDeployConfig,
		liveDeployConfig: workerState.liveDeployConfig,
		deployStatus: workerState.deployStatus,
		deployError: workerState.deployError,
		deployCompleteEvent: workerState.deployCompleteEvent,
		initiateServiceLogs,
		serviceLogs: workerState.serviceLogs,
	};
}
