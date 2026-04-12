import { DeployConfig, DeployStep } from "@/app/types";
import { getDeploymentDisplayUrl } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";

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

export type UseDeployLogsOptions = {
	onDeployFinished?: (payload: DeployCompleteWsPayload) => void;
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

export function getWebSocketUrl(): string {
	const env = process.env.NEXT_PUBLIC_WS_URL;
	if (typeof env === "string" && env) {
		return env.replace(/^https?/, (p) => (p === "https" ? "wss" : "ws"));
	}
	if (typeof window !== "undefined" && window.location.host) {
		const protocol = window.location.protocol === "https:" ? "wss" : "ws";
		return `${protocol}://${window.location.host}/ws`;
	}
	return "ws://localhost:4001";
}

export function getWebSocketHealthUrl(): string {
	const wsUrl = getWebSocketUrl();
	return wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/ws$/, "/health");
}

export function getAuthenticatedWebSocketHealthUrl(token: string): string {
	const wsUrl = getWebSocketUrl();
	const healthUrl = new URL(wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/ws$/, "/healthz"));
	healthUrl.searchParams.set("auth", token);
	return healthUrl.toString();
}

export async function fetchWebSocketAuthToken(): Promise<string> {
	const response = await fetch("/api/ws-token", {
		method: "GET",
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

export function useDeployLogs(serviceName: string, repoName: string, options: UseDeployLogsOptions) {
	const [steps, setSteps] = useState<DeployStep[]>(() => [...defaultSteps]);
	const [deployLogEntries, setDeployLogEntries] = useState<DeployLogEntry[]>([]);
	const [socketStatus, setSocketStatus] = useState<SocketStatus>("connecting");
	const [deployStatus, setDeployStatus] = useState<DeployStatus>("not-started");
	const [deployError, setDeployError] = useState<string | null>(null);
	const [vercelDnsStatus, setVercelDnsStatus] = useState<"idle" | "adding" | "success" | "error">("idle");
	const [vercelDnsError, setVercelDnsError] = useState<string | null>(null);
	const [serviceLogs, setServiceLogs] = useState<ServiceLogEntry[]>([]);

	const deployConfigRef = useRef<DeployConfig | null>(null);
	const wasDeployingRef = useRef(false);
	const wsRef = useRef<WebSocket | null>(null);
	const onDeployFinishedRef = useRef(options?.onDeployFinished);

	useEffect(() => {
		onDeployFinishedRef.current = options?.onDeployFinished;
	}, [options?.onDeployFinished]);

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

	const createWebSocket = useCallback((onReady?: () => void) => {
		setSocketStatus("connecting");
		void (async () => {
			try {
				const authToken = await fetchWebSocketAuthToken();
				const wsUrl = new URL(getWebSocketUrl());
				wsUrl.searchParams.set("auth", authToken);

				const ws = new WebSocket(wsUrl.toString());
				wsRef.current = ws;

				ws.onopen = () => {
					setSocketStatus("open");
					initiateServiceLogs();
					onReady?.();
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
					setSocketStatus("closed");
					if (wasDeployingRef.current) {
						setDeployStatus("error");
						setDeployError("Connection lost - deployment may have failed. Check if the deploy server is running.");
					}
					wasDeployingRef.current = false;
				};
			} catch (error) {
				setSocketStatus("error");
				setDeployError(error instanceof Error ? error.message : "Failed to authenticate websocket connection");
			}
		})();

		return null;
	}, [deployLogs, initiateServiceLogs, processServiceLogs]);

	const openSocket = useCallback((onReady?: () => void) => {
		const existing = wsRef.current;
		if (existing && existing.readyState === WebSocket.OPEN) {
			onReady?.();
			return existing;
		}
		return createWebSocket(onReady);
	}, [createWebSocket]);

	useEffect(() => {
		if (!repoName || !serviceName || typeof window === "undefined") return;

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
	}, [openSocket, repoName, serviceName]);

	useEffect(() => {
		return () => {
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
	};
}
