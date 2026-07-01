import { DeployConfig } from "@/app/types";
import { authClient } from "@/lib/auth-client";
import { EMPTY_AGENT_STRUCTURED_DATA } from "@/lib/deploymentAgent/structuredData";
import {
	type AgentSocketMessagePayload,
	type AgentRunPayload,
	type DeployCompleteWsPayload,
	type DeployLogEntry,
	type DeploySnapshotPayload,
	type DeploymentStatusChangedPayload,
	type ServiceLogEntry,
	type WorkerSocketStatus,
	resolveWorkerSocketIoPath,
	resolveWorkerSocketIoServerUrl,
	WORKER_SOCKET_CLIENT_EVENTS,
	WORKER_SOCKET_SERVER_EVENTS,
} from "@/lib/workerSocketEvents";
import { useAppData } from "@/store/useAppData";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";

export type { DeployCompleteWsPayload } from "@/lib/workerSocketEvents";

type SocketStatus = "connecting" | "open" | "closed" | "error";
type DeployStatus = "not-started" | "running" | "success" | "error";
type DeployCompleteEvent = {
	payload: DeployCompleteWsPayload;
	receivedAt: number;
};
type AgentEventKind =
	| "accepted"
	| "status"
	| "tool_started"
	| "tool_completed"
	| "message"
	| "complete"
	| "error";
type AgentEvent = {
	kind: AgentEventKind;
	payload: AgentSocketMessagePayload;
	receivedAt: number;
};
type CachedWebSocketAuthToken = {
	token: string;
	expiresAt: number;
};
type WorkspaceSubscription = {
	repoName: string;
	serviceName: string;
};
type WorkerWebSocketState = {
	deployStatus: DeployStatus;
	deployError: string | null;
	deployLogEntries: DeployLogEntry[];
	serviceLogs: ServiceLogEntry[];
	liveDeployConfig: DeployConfig | null;
	deployCompleteEvent: DeployCompleteEvent | null;
	latestAgentEvent: AgentEvent | null;
};

const WORKER_RECONNECT_BASE_DELAY_MS = 1000;
const WORKER_RECONNECT_MAX_DELAY_MS = 30000;
const WS_TOKEN_REFRESH_BUFFER_MS = 30000;

const INITIAL_WORKER_WEBSOCKET_STATE: WorkerWebSocketState = {
	deployStatus: "not-started",
	deployError: null,
	deployLogEntries: [],
	serviceLogs: [],
	liveDeployConfig: null,
	deployCompleteEvent: null,
	latestAgentEvent: null,
};

function deployStatusFromSocketStatus(status: WorkerSocketStatus): DeployStatus {
	if (status === "running") return "running";
	if (status === "success") return "success";
	return "error";
}

function workerWebSocketReducer(
	state: WorkerWebSocketState,
	action:
		| { type: "start_deploy"; deployConfig: DeployConfig }
		| { type: "append_deploy_log"; entry: DeployLogEntry }
		| { type: "set_deploy_snapshot"; snapshot: DeploySnapshotPayload }
		| { type: "set_service_logs"; logs: ServiceLogEntry[] }
		| { type: "set_live_deploy_config"; deployConfig: DeployConfig | null }
		| { type: "set_deploy_complete"; event: DeployCompleteEvent }
		| { type: "set_agent_event"; event: AgentEvent }
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
		case "set_deploy_snapshot":
			return {
				...state,
				deployStatus: deployStatusFromSocketStatus(action.snapshot.status),
				deployError: action.snapshot.error,
				deployLogEntries: action.snapshot.logEntries,
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
		case "set_agent_event":
			return {
				...state,
				latestAgentEvent: action.event,
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

function getSocketConnectErrorMessage(message: string) {
	const reason = message.trim();
	if (/unauthorized/i.test(reason)) {
		return "Worker connection rejected as unauthorized. Check BETTER_AUTH_SECRET parity between app and worker.";
	}
	if (/forbidden/i.test(reason)) {
		return "Worker connection rejected by origin policy. Check WS_ALLOWED_ORIGINS includes your frontend origin.";
	}
	return reason || "Failed to connect to deploy worker.";
}

function getSocketDisconnectMessage(reason: string) {
	if (reason === "ping timeout" || reason === "transport close") {
		return "Worker connection closed unexpectedly. Check worker availability, TLS, and reverse proxy settings.";
	}
	if (reason === "io server disconnect") {
		return "Worker closed the connection.";
	}
	return reason ? `Worker connection closed: ${reason}` : "Worker connection closed.";
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

function getWorkerSocketIoConnectionConfig() {
	const wsBase = getWebSocketUrl();
	return {
		path: resolveWorkerSocketIoPath(wsBase),
		url: resolveWorkerSocketIoServerUrl(wsBase),
	};
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

function parseWebSocketAuthTokenExpiry(token: string): number | null {
	const [encodedPayload] = token.split(".");
	if (!encodedPayload) {
		return null;
	}

	try {
		const normalizedPayload = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
		const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, "=");
		const decodedPayload = window.atob(paddedPayload);
		const payload = JSON.parse(decodedPayload) as { exp?: number };
		return typeof payload.exp === "number" ? payload.exp : null;
	} catch {
		return null;
	}
}

/**
 * One Socket.IO session to the deploy worker scoped by the active workspace in app state.
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
	const [socketConnectionStatus, setSocketStatus] = useReducer(
		(_state: SocketStatus, nextStatus: SocketStatus) => nextStatus,
		"closed" as SocketStatus
	);

	const isDeployingRef = useRef(false);
	const socketRef = useRef<Socket | null>(null);
	const manualDisconnectRef = useRef(false);
	const authTokenRef = useRef<CachedWebSocketAuthToken | null>(null);
	const subscribedWorkspaceRef = useRef<WorkspaceSubscription | null>(null);
	const activeAgentRunIdRef = useRef<string | null>(null);
	const pendingAgentRequestRef = useRef(false);

	const getWebSocketAuthToken = useCallback(async () => {
		const cachedToken = authTokenRef.current;
		if (cachedToken && cachedToken.expiresAt > Date.now() + WS_TOKEN_REFRESH_BUFFER_MS) {
			return cachedToken.token;
		}

		const token = await fetchWebSocketAuthToken();
		const expiresAt = parseWebSocketAuthTokenExpiry(token);
		authTokenRef.current = expiresAt
			? {
					token,
					expiresAt,
				}
			: null;
		return token;
	}, []);

	const subscribeWorkspace = useCallback(
		(socket: Socket | null) => {
			if (!socket?.connected) return;

			const previousWorkspace = subscribedWorkspaceRef.current;
			const nextWorkspace =
				repoName && serviceName
					? {
							repoName,
							serviceName,
						}
					: null;

			if (
				previousWorkspace &&
				(!nextWorkspace ||
					previousWorkspace.repoName !== nextWorkspace.repoName ||
					previousWorkspace.serviceName !== nextWorkspace.serviceName)
			) {
				socket.emit(WORKER_SOCKET_CLIENT_EVENTS.workspaceUnsubscribe, previousWorkspace);
			}

			subscribedWorkspaceRef.current = nextWorkspace;
			if (!nextWorkspace) return;

			socket.emit(WORKER_SOCKET_CLIENT_EVENTS.workspaceSubscribe, nextWorkspace);
		},
		[repoName, serviceName]
	);

	const disconnectSocket = useCallback(() => {
		manualDisconnectRef.current = true;
		subscribedWorkspaceRef.current = null;
		setSocketStatus("closed");

		const socket = socketRef.current;
		if (socket) {
			socket.removeAllListeners();
			socket.io.removeAllListeners();
			socket.disconnect();
		}

		socketRef.current = null;
	}, []);

	const deployLogs = useCallback(({ id, msg, time }: { id?: string; msg?: string; time?: string }) => {
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
		subscribeWorkspace(socketRef.current);
	}, [subscribeWorkspace]);

	const createSocket = useCallback(() => {
		if (socketRef.current) {
			return;
		}

		manualDisconnectRef.current = false;
		setSocketStatus("connecting");
		const { path, url } = getWorkerSocketIoConnectionConfig();
		const socket = io(url, {
			autoConnect: false,
			path,
			reconnection: true,
			reconnectionDelay: WORKER_RECONNECT_BASE_DELAY_MS,
			reconnectionDelayMax: WORKER_RECONNECT_MAX_DELAY_MS,
			auth: (cb) => {
				void getWebSocketAuthToken()
					.then((token) => {
						cb({ token });
					})
					.catch(() => {
						authTokenRef.current = null;
						cb({ token: "" });
					});
			},
		});

		socketRef.current = socket;

		socket.on("connect", () => {
			setSocketStatus("open");
			dispatchWorkerState({ type: "set_error", error: null });
			subscribeWorkspace(socket);
		});

		socket.on("disconnect", (reason) => {
			const disconnectMessage = getSocketDisconnectMessage(reason);
			if (isDeployingRef.current) {
				dispatchWorkerState({
					type: "set_error",
					error: disconnectMessage,
					status: "error",
				});
			}
			if (pendingAgentRequestRef.current) {
				dispatchWorkerState({
					type: "set_agent_event",
					event: {
						kind: "error",
						payload: {
							runId: activeAgentRunIdRef.current ?? "",
							message: disconnectMessage,
							docCitations: [],
							structuredData: EMPTY_AGENT_STRUCTURED_DATA,
						},
						receivedAt: Date.now(),
					},
				});
				pendingAgentRequestRef.current = false;
			}
			isDeployingRef.current = false;
			setSocketStatus(manualDisconnectRef.current ? "closed" : "connecting");
		});

		socket.on("connect_error", (error) => {
			const message = getSocketConnectErrorMessage(error.message);
			if (/unauthorized/i.test(error.message)) {
				authTokenRef.current = null;
			}
			dispatchWorkerState({
				type: "set_error",
				error: message,
				...(isDeployingRef.current ? { status: "error" as const } : {}),
			});
			if (pendingAgentRequestRef.current) {
				dispatchWorkerState({
					type: "set_agent_event",
					event: {
						kind: "error",
						payload: {
							runId: activeAgentRunIdRef.current ?? "",
							message,
							docCitations: [],
							structuredData: EMPTY_AGENT_STRUCTURED_DATA,
						},
						receivedAt: Date.now(),
					},
				});
				pendingAgentRequestRef.current = false;
			}
			setSocketStatus("error");
		});

		socket.io.on("reconnect_attempt", () => {
			setSocketStatus("connecting");
		});

		socket.on(WORKER_SOCKET_SERVER_EVENTS.serviceLogs, (payload) => {
			dispatchWorkerState({
				type: "set_service_logs",
				logs: (payload as { logs?: ServiceLogEntry[] } | undefined)?.logs ?? [],
			});
		});

		socket.on(WORKER_SOCKET_SERVER_EVENTS.deployLog, (payload) => {
			deployLogs(payload as { id?: string; msg?: string; time?: string });
		});

		socket.on(WORKER_SOCKET_SERVER_EVENTS.deploySnapshot, (payload) => {
			dispatchWorkerState({
				type: "set_deploy_snapshot",
				snapshot: payload as DeploySnapshotPayload,
			});
		});

		socket.on(WORKER_SOCKET_SERVER_EVENTS.deployComplete, (payload) => {
			const completePayload = payload as DeployCompleteWsPayload;
			isDeployingRef.current = false;
			dispatchWorkerState({
				type: "set_deploy_complete",
				event: {
					payload: completePayload,
					receivedAt: Date.now(),
				},
			});
			subscribeWorkspace(socket);
		});

		socket.on(WORKER_SOCKET_SERVER_EVENTS.deploymentStatusChanged, (payload) => {
			const update = payload as DeploymentStatusChangedPayload;
			if (update.repoName === repoName) {
				void useAppData.getState().fetchRepoDeployments(update.repoName);
			}
		});

		const handleAgentEvent = (kind: AgentEventKind) => (payload: unknown) => {
			const typedPayload = (payload as AgentSocketMessagePayload | undefined) ?? {
				runId: "",
				message: "",
				docCitations: [],
				structuredData: EMPTY_AGENT_STRUCTURED_DATA,
			};
			if (!Array.isArray(typedPayload.docCitations)) {
				typedPayload.docCitations = [];
			}
			if (!typedPayload.structuredData || !Array.isArray(typedPayload.structuredData.blocks)) {
				typedPayload.structuredData = EMPTY_AGENT_STRUCTURED_DATA;
			}
			if (typedPayload.runId) {
				activeAgentRunIdRef.current = typedPayload.runId;
			}
			if (kind === "complete" || kind === "error") {
				pendingAgentRequestRef.current = false;
			}
			dispatchWorkerState({
				type: "set_agent_event",
				event: {
					kind,
					payload: typedPayload,
					receivedAt: Date.now(),
				},
			});
		};

		socket.on(WORKER_SOCKET_SERVER_EVENTS.agentAccepted, handleAgentEvent("accepted"));
		socket.on(WORKER_SOCKET_SERVER_EVENTS.agentStatus, handleAgentEvent("status"));
		socket.on(WORKER_SOCKET_SERVER_EVENTS.agentToolStarted, handleAgentEvent("tool_started"));
		socket.on(WORKER_SOCKET_SERVER_EVENTS.agentToolCompleted, handleAgentEvent("tool_completed"));
		socket.on(WORKER_SOCKET_SERVER_EVENTS.agentMessage, handleAgentEvent("message"));
		socket.on(WORKER_SOCKET_SERVER_EVENTS.agentComplete, handleAgentEvent("complete"));
		socket.on(WORKER_SOCKET_SERVER_EVENTS.agentError, handleAgentEvent("error"));

		socket.on(WORKER_SOCKET_SERVER_EVENTS.workerError, (payload) => {
			const message = (payload as { error?: string } | undefined)?.error ?? "Request failed";
			dispatchWorkerState({
				type: "set_error",
				error: message,
				...(isDeployingRef.current ? { status: "error" as const } : {}),
			});
		});

		socket.connect();
	}, [deployLogs, getWebSocketAuthToken, repoName, setSocketStatus, subscribeWorkspace]);

	useEffect(() => {
		if (!connectionEnabled) {
			disconnectSocket();
			return;
		}

		createSocket();
	}, [connectionEnabled, createSocket, disconnectSocket]);

	useEffect(() => {
		subscribeWorkspace(socketRef.current);
	}, [repoName, serviceName, subscribeWorkspace]);

	useEffect(() => {
		return () => {
			disconnectSocket();
		};
	}, [disconnectSocket]);

	const runAgent = useCallback((conversationId: string, message: string) => {
		const trimmedConversationId = conversationId.trim();
		const trimmed = message.trim();
		if (!trimmedConversationId) {
			return { ok: false as const, error: "Agent conversationId is required." };
		}
		if (!trimmed) {
			return { ok: false as const, error: "Agent message is required." };
		}

		const socket = socketRef.current;
		if (!socket?.connected) {
			return {
				ok: false as const,
				error: "The deployment agent is offline right now. Refresh the page and try again.",
			};
		}

		activeAgentRunIdRef.current = null;
		pendingAgentRequestRef.current = true;
		socket.emit(WORKER_SOCKET_CLIENT_EVENTS.agentRun, {
			conversationId: trimmedConversationId,
			message: trimmed,
		} satisfies AgentRunPayload);
		return { ok: true as const };
	}, []);

	const sendDeployConfig = (deployConfig: DeployConfig, token: string, userID: string) => {
		isDeployingRef.current = true;
		dispatchWorkerState({ type: "start_deploy", deployConfig });

		const socket = socketRef.current;
		if (socket?.connected) {
			socket.emit(WORKER_SOCKET_CLIENT_EVENTS.deploy, {
				deployConfig,
				token,
				userID,
			});
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

	const socketStatus: SocketStatus = !connectionEnabled
		? "closed"
		: socketConnectionStatus;

	return {
		deployLogEntries: workerState.deployLogEntries,
		socketStatus,
		runAgent,
		sendDeployConfig,
		liveDeployConfig: workerState.liveDeployConfig,
		deployStatus: workerState.deployStatus,
		deployError: workerState.deployError,
		deployCompleteEvent: workerState.deployCompleteEvent,
		initiateServiceLogs,
		serviceLogs: workerState.serviceLogs,
		latestAgentEvent: workerState.latestAgentEvent,
	};
}
