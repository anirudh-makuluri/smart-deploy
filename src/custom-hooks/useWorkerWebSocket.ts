import { DeployConfig, DeployStep } from "@/app/types";
import { buildWebSocketHealthUrl } from "@/lib/wsUrls";
import { getDeploymentDisplayUrl } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type DeployCompleteWsPayload = {
	success: boolean;
	deployUrl?: string | null;
	deploymentTarget?: string | null;
	ec2?: DeployConfig["ec2"];
	error?: string;
	vercelDnsAdded?: boolean;
	vercelDnsError?: string | null;
	customUrl?: string | null;
};

export type UseWorkerWebSocketSessionParams = {
	/**
	 * When true, opens and keeps a WebSocket to the deploy worker (after fetching `/api/ws-token`).
	 * Use `Boolean(session?.user?.id)` for the global session, or `true` for a modal-scoped viewer.
	 */
	connectionEnabled: boolean;
	repoName: string;
	serviceName: string;
	/**
	 * When true, show a toast if the worker reports in-memory running deploys for this user on connect.
	 * Use only for the global `WorkerWebSocketProvider` session so a second modal socket does not duplicate toasts.
	 */
	announceActiveDeployments?: boolean;
};

type SocketStatus = "connecting" | "open" | "closed" | "error";
type DeployStatus = "not-started" | "running" | "success" | "error";
type ServiceLogEntry = { timestamp: string; message?: string };
type DeployLogEntry = { timestamp?: string; message?: string };

const defaultSteps: DeployStep[] = [
	{ id: "auth", label: "Authentication", logs: [], status: "pending" },
	{ id: "clone", label: "Cloning repository", logs: [], status: "pending" },
	{ id: "setup", label: "Setup", logs: [], status: "pending" },
	{ id: "docker", label: "Build", logs: [], status: "pending" },
	{ id: "deploy", label: "Deploy", logs: [], status: "pending" },
	{ id: "done", label: "Done", logs: [], status: "pending" },
];

const ACTIVE_DEPLOYMENT_KEY = "smart-deploy-active-deployment";

export function getActiveDeployment(): { repoName: string; serviceName: string; userID?: string } | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = sessionStorage.getItem(ACTIVE_DEPLOYMENT_KEY);
		if (!raw) return null;
		return JSON.parse(raw) as { repoName: string; serviceName: string; userID?: string };
	} catch {
		return null;
	}
}

export function clearActiveDeployment(): void {
	if (typeof window === "undefined") return;
	sessionStorage.removeItem(ACTIVE_DEPLOYMENT_KEY);
}

function isLocalhostHost(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".local");
}

export function getWebSocketUrl(): string {
	const env = process.env.NEXT_PUBLIC_WS_URL;
	if (typeof env === "string" && env) {
		return env.replace(/^https?/, (p) => (p === "https" ? "wss" : "ws"));
	}
	if (typeof window !== "undefined" && window.location.host) {
		if (!isLocalhostHost(window.location.hostname)) {
			return "";
		}
		const protocol = window.location.protocol === "https:" ? "wss" : "ws";
		return `${protocol}://${window.location.host}/ws`;
	}
	return "ws://localhost:4001";
}

export function getWebSocketHealthUrl(): string {
	return buildWebSocketHealthUrl(getWebSocketUrl(), "/health");
}

/** Authenticated worker WebSocket URL (same path used for deploy logs). */
export function getAuthenticatedWebSocketHealthUrl(token: string): string {
	const url = new URL(getWebSocketUrl());
	url.searchParams.set("auth", token);
	return url.toString();
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
 * One WebSocket session to the deploy worker (auth + optional repo/service subscriptions).
 * The app uses a single provider-scoped instance when logged in; modals may mount another for arbitrary repo/service.
 */
export function useWorkerWebSocketSession({
	connectionEnabled,
	repoName,
	serviceName,
	announceActiveDeployments = false,
}: UseWorkerWebSocketSessionParams) {
	const [steps, setSteps] = useState<DeployStep[]>(() => [...defaultSteps]);
	const [deployLogEntries, setDeployLogEntries] = useState<DeployLogEntry[]>([]);
	const [socketStatus, setSocketStatus] = useState<SocketStatus>("connecting");
	const [deployStatus, setDeployStatus] = useState<DeployStatus>("not-started");
	const [deployError, setDeployError] = useState<string | null>(null);
	const [vercelDnsStatus, setVercelDnsStatus] = useState<"idle" | "adding" | "success" | "error">("idle");
	const [vercelDnsError, setVercelDnsError] = useState<string | null>(null);
	const [serviceLogs, setServiceLogs] = useState<ServiceLogEntry[]>([]);
	const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

	const deployConfigRef = useRef<DeployConfig | null>(null);
	const wasDeployingRef = useRef(false);
	const wsRef = useRef<WebSocket | null>(null);
	const activeDeploymentToastShownRef = useRef(false);
	const onDeployFinishedRef = useRef<((payload: DeployCompleteWsPayload) => void) | undefined>(undefined);
	const connectionEnabledRef = useRef(connectionEnabled);
	const connectInFlightRef = useRef(false);
	const connectionAttemptedRef = useRef(false);
	const onReadyQueueRef = useRef<Array<() => void>>([]);
	const openSocketRef = useRef<(onReady?: () => void) => WebSocket | null>(() => null);

	const flushOnReadyQueue = useCallback(() => {
		const queue = onReadyQueueRef.current;
		onReadyQueueRef.current = [];
		queue.forEach((handler) => handler());
	}, []);

	const setOnDeployFinished = useCallback((handler: ((payload: DeployCompleteWsPayload) => void) | undefined) => {
		onDeployFinishedRef.current = handler;
	}, []);

	const processServiceLogs = useCallback((logs: ServiceLogEntry[]) => {
		setServiceLogs((prev) => [...prev, ...logs]);
	}, []);

	const deployLogs = useCallback(({ id, msg, time }: { id: string; msg: string; time?: string }) => {
		setDeployStatus("running");
		setDeployLogEntries((prev) => [
			...prev,
			{
				timestamp: time,
				message: msg,
			},
		]);

		setSteps((prev) => {
			const existing = prev.find((step) => step.id === id);
			if (!existing) {
				return [...prev, { id, label: id, logs: [msg], status: "in_progress" }];
			}
			return prev.map((step) =>
				step.id === id
					? {
						...step,
						status: msg.includes("success")
							? "success"
							: msg.includes("error")
								? "error"
								: step.status === "pending"
									? "in_progress"
									: step.status,
						logs: [...step.logs, msg],
					}
					: step
			);
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

	const createWebSocket = useCallback(() => {
		if (connectInFlightRef.current) {
			return null;
		}
		if (connectionAttemptedRef.current) {
			return wsRef.current;
		}
		connectionAttemptedRef.current = true;
		connectInFlightRef.current = true;
		setSocketStatus("connecting");
		activeDeploymentToastShownRef.current = false;
		void (async () => {
			try {
				const wsBaseUrl = getWebSocketUrl();
				if (!wsBaseUrl) {
					throw new Error("NEXT_PUBLIC_WS_URL is not configured for this deployment");
				}
				const authToken = await fetchWebSocketAuthToken();
				const wsUrl = new URL(wsBaseUrl);
				wsUrl.searchParams.set("auth", authToken);

				const ws = new WebSocket(wsUrl.toString());
				wsRef.current = ws;

				ws.onopen = () => {
					connectInFlightRef.current = false;
					setHasConnectedOnce(true);
					setSocketStatus("open");
					initiateServiceLogs();
					flushOnReadyQueue();
				};

				ws.onmessage = (event) => {
					let data: { type: string; payload?: unknown };
					try {
						data = JSON.parse(event.data);
					} catch {
						const message = typeof event.data === "string" ? event.data : "Deployment failed";
						setDeployStatus("error");
						setDeployError(message.startsWith("Error:") ? message.slice(6).trim() : message);
						return;
					}

					const payload = data.payload;
					switch (data.type) {
						case "active_deployments": {
							if (!announceActiveDeployments || activeDeploymentToastShownRef.current) break;
							const deployments = (payload as { deployments?: { repoName: string; serviceName: string }[] } | undefined)
								?.deployments ?? [];
							if (deployments.length === 0) break;
							activeDeploymentToastShownRef.current = true;
							const d0 = deployments[0]!;
							const description =
								deployments.length === 1
									? `${d0.serviceName} · ${d0.repoName}`
									: `${deployments.length} deployments running (e.g. ${d0.serviceName} · ${d0.repoName})`;
							toast.info("Deployment in progress", { description });
							break;
						}
						case "initial_logs":
							processServiceLogs((payload as { logs?: ServiceLogEntry[] } | undefined)?.logs ?? []);
							break;
						case "stream_logs": {
							const log = (payload as { log?: ServiceLogEntry } | undefined)?.log;
							processServiceLogs(log ? [log] : []);
							break;
						}
						case "deploy_logs":
							if (payload && typeof payload === "object") {
								deployLogs(payload as { id: string; msg: string; time?: string });
							}
							break;
						case "deploy_steps": {
							const nextSteps = (payload as { steps?: { id: string; label: string }[] } | undefined)?.steps ?? [];
							setSteps((prev) => {
								const byId = new Map(prev.map((step) => [step.id, step]));
								return nextSteps.map((step) => ({
									id: step.id,
									label: step.label,
									logs: byId.get(step.id)?.logs ?? [],
									status: byId.get(step.id)?.status ?? "pending",
								}));
							});
							break;
						}
						case "deploy_logs_snapshot": {
							const snapshot = (payload as { steps?: DeployStep[]; status?: DeployStatus; error?: string | null } | undefined) ?? {};
							const hasNoStoredLogsError = snapshot.error === "No logs found for this deployment";
							if (Array.isArray(snapshot.steps) && snapshot.steps.length > 0) {
								setSteps(snapshot.steps);
								const entries: DeployLogEntry[] = [];
								snapshot.steps.forEach((step) => {
									step.logs.forEach((log) => {
										entries.push({
											timestamp: step.startedAt,
											message: log,
										});
									});
								});
								setDeployLogEntries(entries);
							}
							if (snapshot.status && !hasNoStoredLogsError) {
								setDeployStatus(snapshot.status);
								if (snapshot.status === "running") {
									wasDeployingRef.current = true;
								}
							} else if (hasNoStoredLogsError) {
								setDeployStatus("not-started");
							}
							setDeployError(snapshot.error != null && !hasNoStoredLogsError ? snapshot.error : null);
							if (snapshot.status === "success" || snapshot.status === "error") {
								clearActiveDeployment();
							}
							break;
						}
						case "deploy_complete": {
							const completePayload = (payload as DeployCompleteWsPayload | undefined) ?? { success: false, error: "Deployment failed" };
							wasDeployingRef.current = false;
							clearActiveDeployment();
							setDeployStatus(completePayload.success ? "success" : "error");

							if (!completePayload.success) {
								setDeployError(completePayload.error ?? "Deployment failed");
								setVercelDnsStatus("idle");
								setVercelDnsError(null);
								if (deployConfigRef.current && completePayload.ec2 != null) {
									const currentConfig = deployConfigRef.current;
									const deploymentTarget = completePayload.deploymentTarget;
									deployConfigRef.current = {
										...currentConfig,
										...(typeof deploymentTarget === "string" && deploymentTarget
											? { deploymentTarget: deploymentTarget as DeployConfig["deploymentTarget"] }
											: {}),
										ec2: completePayload.ec2,
										status: "failed",
									};
								}
							} else {
								setDeployError(null);
								if (deployConfigRef.current) {
									const currentConfig = deployConfigRef.current;
									const deployUrlFromPayload =
										typeof completePayload.deployUrl === "string" && completePayload.deployUrl.trim() !== ""
											? completePayload.deployUrl.trim()
											: undefined;
									const deploymentTarget =
										(completePayload.deploymentTarget as DeployConfig["deploymentTarget"] | null | undefined) ??
										currentConfig.deploymentTarget;
									const updated: DeployConfig = {
										...currentConfig,
										...(deployUrlFromPayload != null ? { liveUrl: deployUrlFromPayload } : {}),
										status: "running",
										...(deploymentTarget ? { deploymentTarget } : {}),
										...(completePayload.ec2 != null ? { ec2: completePayload.ec2 } : {}),
									};
									const customUrl = typeof completePayload.customUrl === "string" ? completePayload.customUrl.trim() : "";
									const displayUrl = getDeploymentDisplayUrl(updated)?.trim() ?? "";
									updated.liveUrl = customUrl || displayUrl || deployUrlFromPayload || currentConfig.liveUrl || null;
									deployConfigRef.current = updated;
								}
								setSteps((prev) => prev.map((step) => (step.id === "done" ? { ...step, status: "success" } : step)));
								if (completePayload.vercelDnsAdded === true) {
									setVercelDnsStatus("success");
									setVercelDnsError(null);
								} else if (completePayload.vercelDnsError) {
									setVercelDnsStatus("error");
									setVercelDnsError(completePayload.vercelDnsError);
								} else {
									setVercelDnsStatus("idle");
									setVercelDnsError(null);
								}
							}

							onDeployFinishedRef.current?.(completePayload);
							break;
						}
						default:
							break;
					}
				};

				ws.onerror = () => {
					setSocketStatus("error");
					if (wasDeployingRef.current) {
						setDeployStatus("error");
						setDeployError("Connection lost - deployment may have failed. Check if the deploy server is running.");
					}
				};

				ws.onclose = () => {
					connectInFlightRef.current = false;
					setSocketStatus("closed");
					if (wasDeployingRef.current) {
						setDeployStatus("error");
						setDeployError("Connection lost - deployment may have failed. Check if the deploy server is running.");
					}
					wasDeployingRef.current = false;
				};
			} catch (error) {
				connectInFlightRef.current = false;
				setSocketStatus("error");
				const message = error instanceof Error ? error.message : "Failed to authenticate websocket connection";
				setDeployError(message);
			}
		})();

		return null;
	}, [announceActiveDeployments, deployLogs, flushOnReadyQueue, initiateServiceLogs, processServiceLogs]);

	const openSocket = useCallback((onReady?: () => void) => {
		const existing = wsRef.current;
		if (existing && existing.readyState === WebSocket.OPEN) {
			if (onReady) {
				onReady();
			}
			return existing;
		}
		if (onReady) {
			onReadyQueueRef.current.push(onReady);
		}
		if (existing && existing.readyState === WebSocket.CONNECTING) {
			return existing;
		}
		if (connectInFlightRef.current) {
			return null;
		}
		return createWebSocket();
	}, [createWebSocket]);

	useEffect(() => {
		openSocketRef.current = openSocket;
		return () => {
			openSocketRef.current = () => null;
		};
	}, [openSocket]);

	useEffect(() => {
		connectionEnabledRef.current = connectionEnabled;
		if (typeof window === "undefined") return;

		if (!connectionEnabled) {
			connectInFlightRef.current = false;
			connectionAttemptedRef.current = false;
			onReadyQueueRef.current = [];
			wsRef.current?.close();
			wsRef.current = null;
				setHasConnectedOnce(false);
			setSocketStatus("closed");
			return;
		}

		openSocket();
	}, [connectionEnabled, openSocket]);

	useEffect(() => {
		if (!connectionEnabled || !repoName || !serviceName || typeof window === "undefined") return;

		const active = getActiveDeployment();
		const payloadUserId =
			active?.repoName === repoName && active?.serviceName === serviceName ? active.userID : undefined;

		openSocket(() => {
			const socket = wsRef.current;
			if (socket?.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({
					type: "get_deploy_logs",
					payload: { repoName, serviceName, userID: payloadUserId },
				}));
				socket.send(JSON.stringify({
					type: "service_logs",
					payload: { serviceName, repoName },
				}));
			}
		});
	}, [connectionEnabled, openSocket, repoName, serviceName]);

	useEffect(() => {
		return () => {
			connectInFlightRef.current = false;
			onReadyQueueRef.current = [];
			wsRef.current?.close();
		};
	}, []);

	const sendDeployConfig = (deployConfig: DeployConfig, token: string, userID?: string) => {
		deployConfigRef.current = deployConfig;
		wasDeployingRef.current = true;
		setDeployError(null);
		setDeployStatus("running");
		setSteps([...defaultSteps]);
		setDeployLogEntries([]);

		if (typeof window !== "undefined") {
			try {
				sessionStorage.setItem(
					ACTIVE_DEPLOYMENT_KEY,
					JSON.stringify({ repoName: deployConfig.repoName, serviceName: deployConfig.serviceName, userID })
				);
			} catch {
				// ignore
			}
		}

		openSocket(() => {
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
			}
		});
	};

	return {
		steps,
		deployLogEntries,
		socketStatus,
		sendDeployConfig,
		openSocket,
		deployConfigRef,
		deployStatus,
		deployError,
		vercelDnsStatus,
		vercelDnsError,
		initiateServiceLogs,
		serviceLogs,
		hasConnectedOnce,
		setOnDeployFinished,
	};
}
