import { DeployConfig, DeployStep } from "@/app/types";
import { readDockerfile, getDeploymentDisplayUrl } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

type SocketStatus = "connecting" | "open" | "closed" | "error";
type DeployStatus = "not-started" | "running" | "success" | "error"

/** Fallback when server doesn't send deploy_steps (e.g. older backend). IDs must match backend log ids. */
const defaultSteps: DeployStep[] = [
	{ id: "auth", label: "🔐 Authentication", logs: [], status: "pending" },
	{ id: "clone", label: "📦 Cloning repository", logs: [], status: "pending" },
	{ id: "setup", label: "⚙️ Setup", logs: [], status: "pending" },
	{ id: "docker", label: "🐳 Build", logs: [], status: "pending" },
	{ id: "deploy", label: "🚀 Deploy", logs: [], status: "pending" },
	{ id: "done", label: "✅ Done", logs: [], status: "pending" },
];

const ACTIVE_DEPLOYMENT_KEY = "smart-deploy-active-deployment";

/** Read active deployment from sessionStorage (set when deploy starts, cleared when it finishes). Used for "deployment in progress" notification and repo banner. */
export function getActiveDeployment(): { deploymentId: string; userID?: string } | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = sessionStorage.getItem(ACTIVE_DEPLOYMENT_KEY);
		if (!raw) return null;
		return JSON.parse(raw) as { deploymentId: string; userID?: string };
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
	if (typeof window !== "undefined" && window.location.protocol === "https:") {
		return `wss://${window.location.host}/ws`;
	}
	return "ws://localhost:4001";
}

export function useDeployLogs(serviceName?: string, deploymentId?: string, skipSnapshotFetch?: boolean) {
	const [steps, setSteps] = useState<DeployStep[]>(() => [...defaultSteps]);
	const [deployLogEntries, setDeployLogEntries] = useState<{ timestamp?: string; message?: string }[]>([]);
	const [socketStatus, setSocketStatus] = useState<SocketStatus>("connecting");
	const [deployStatus, setDeployStatus] = useState<DeployStatus>("not-started");
	const [deployError, setDeployError] = useState<string | null>(null);
	const [vercelDnsStatus, setVercelDnsStatus] = useState<"idle" | "adding" | "success" | "error">("idle");
	const [vercelDnsError, setVercelDnsError] = useState<string | null>(null);
	const [serviceLogs, setServiceLogs] = useState<{ timestamp: string, message?: string }[]>([]);

	const deployConfigRef = useRef<DeployConfig | null>(null);
	const wasDeployingRef = useRef(false);
	const wsRef = useRef<WebSocket | null>(null);
	// Create and configure WebSocket lazily (when we actually need to deploy or fetch logs)
	function createWebSocket(onReady?: () => void) {
		const ws = new WebSocket(getWebSocketUrl());
		wsRef.current = ws;
		setSocketStatus("connecting");

		ws.onopen = () => {
			console.log("Connected to Server: 4001");
			setSocketStatus("open");
			initiateServiceLogs();
			onReady?.();
		};

		ws.onmessage = (e) => {
			let data: { type: string; payload?: any };
			try {
				data = JSON.parse(e.data);
			} catch {
				// Server sent plain text (e.g. "Error: ...") - treat as deploy failure
				const msg = typeof e.data === "string" ? e.data : "Deployment failed";
				setDeployStatus("error");
				setDeployError(msg.startsWith("Error:") ? msg.slice(6).trim() : msg);
				return;
			}
			const type = data.type;
			const payload = data.payload ?? {};

			switch (type) {
				case "initial_logs":
					processServiceLogs(payload.logs ?? []);
					break;
				case "stream_logs":
					processServiceLogs([payload.log].filter(Boolean));
					break;
				case "deploy_logs":
					deployLogs(payload);
					break;
				case "deploy_steps":
					setSteps((prev) => {
						const byId = new Map(prev.map((s) => [s.id, s]));
						return (payload.steps || []).map(({ id, label }: { id: string; label: string }) => ({
							id,
							label,
							logs: byId.get(id)?.logs ?? [],
							status: (byId.get(id)?.status as DeployStep["status"]) ?? "pending",
						}));
					});
					break;
				case "deploy_logs_snapshot": {
					const snap = payload as { steps?: DeployStep[]; status?: DeployStatus; error?: string | null };
					if (Array.isArray(snap.steps) && snap.steps.length > 0) {
						setSteps(snap.steps);
						const entries: { timestamp?: string; message?: string }[] = [];
						snap.steps.forEach((step) => {
							step.logs.forEach((log) => {
								entries.push({
									timestamp: step.startedAt,
									message: log,
								});
							});
						});
						setDeployLogEntries(entries);
					}
					if (snap.status) {
						setDeployStatus(snap.status);
						if (snap.status === "running") wasDeployingRef.current = true;
					}
					if (snap.error != null) setDeployError(snap.error); else setDeployError(null);
					if (snap.status === "success" || snap.status === "error") clearActiveDeployment();
					break;
				}
				case "deploy_complete":
					wasDeployingRef.current = false;
					clearActiveDeployment();
					setDeployStatus(payload.success ? "success" : "error");
					if (!payload.success) {
						setDeployError(payload.error ?? "Deployment failed");
						setVercelDnsStatus("idle");
						setVercelDnsError(null);
					} else {
						setDeployError(null);
						if (payload.deployUrl && deployConfigRef.current) {
							const updated = {
								...deployConfigRef.current,
								deployUrl: payload.deployUrl,
								status: "running" as const,
								deploymentTarget:
									payload.deploymentTarget ??
									deployConfigRef.current.deploymentTarget,
								...(payload.ec2 != null && { ec2: payload.ec2 }),
							};
							// Use backend-provided customUrl when Vercel DNS was added there
							updated.custom_url =
								typeof payload.customUrl === "string" && payload.customUrl.trim()
									? payload.customUrl.trim()
									: (() => {
										const displayUrl = getDeploymentDisplayUrl(updated);
										return displayUrl && displayUrl !== payload.deployUrl ? displayUrl : undefined;
									})();
							deployConfigRef.current = updated;
						}
						setSteps((prev) =>
							prev.map((s) => (s.id === "done" ? { ...s, status: "success" as const } : s))
						);
						// Vercel DNS status from backend (added in handleDeploy before deploy_complete)
						if (payload.vercelDnsAdded === true) {
							setVercelDnsStatus("success");
							setVercelDnsError(null);
						} else if (payload.vercelDnsError) {
							setVercelDnsStatus("error");
							setVercelDnsError(payload.vercelDnsError);
						} else {
							setVercelDnsStatus("idle");
							setVercelDnsError(null);
						}
					}
					break;
				default:
					break;
			}
		};

		ws.onerror = () => {
			setSocketStatus("error");
			if (wasDeployingRef.current) {
				setDeployStatus("error");
				setDeployError("Connection lost — deployment may have failed. Check if the deploy server is running.");
			}
		};

		ws.onclose = () => {
			setSocketStatus("closed");
			if (wasDeployingRef.current) {
				setDeployStatus("error");
				setDeployError("Connection lost — deployment may have failed. Check if the deploy server is running.");
			}
			wasDeployingRef.current = false;
		};

		return ws;
	}

	// On mount: whenever deploymentId is provided, request deploy logs snapshot.
	useEffect(() => {
		if (!deploymentId || typeof window === "undefined" || skipSnapshotFetch) return;
		const active = getActiveDeployment();
		const payloadUserId = active?.deploymentId === deploymentId ? active.userID : undefined;
		openSocket(() => {
			const socket = wsRef.current;
			if (socket?.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({
					type: "get_deploy_logs",
					payload: { deploymentId, userID: payloadUserId },
				}));
			}
		});
	}, [deploymentId, skipSnapshotFetch]);

	// Only close socket on unmount; do not auto-open on mount (except for get_deploy_logs above).
	useEffect(() => {
		return () => {
			wsRef.current?.close();
		};
	}, []);

	const openSocket = (onReady?: () => void) => {
		const existing = wsRef.current;
		if (existing && existing.readyState === WebSocket.OPEN) {
			onReady?.();
			return existing;
		}
		return createWebSocket(onReady);
	};

	const sendDeployConfig = (deployConfig: DeployConfig, token: string, userID?: string) => {
		deployConfigRef.current = deployConfig;
		wasDeployingRef.current = true;
		setDeployError(null);
		setDeployStatus("running");
		setSteps([...defaultSteps]);
		setDeployLogEntries([]);

		if (typeof window !== "undefined") {
			try {
				sessionStorage.setItem(ACTIVE_DEPLOYMENT_KEY, JSON.stringify({ deploymentId: deployConfig.id, userID }));
			} catch { /* ignore */ }
		}

		const file = deployConfig.dockerfile;

		if (!file || !deployConfig.use_custom_dockerfile) {
			const sendDeployMessage = () => {
				const socket = wsRef.current;
				if (socket?.readyState === WebSocket.OPEN) {
					const object = {
						type: 'deploy',
						payload: {
							deployConfig,
							token,
							userID
						}
					};
					socket.send(JSON.stringify(object));
				} else {
					console.error("Socket not open");
				}
			};

			openSocket(sendDeployMessage);
		} else {
			const reader = new FileReader();

			reader.onload = async () => {
				const base64 = reader.result as string;
				deployConfig.dockerfileInfo = {
					name: file.name,
					type: file.type,
					content: base64
				}

				deployConfig.dockerfileContent = await readDockerfile(file);

				deployConfigRef.current = deployConfig;

				const sendDeployMessageWithDockerfile = () => {
					const socket = wsRef.current;
					if (socket?.readyState === WebSocket.OPEN) {
						const object = {
							type: 'deploy',
							payload: {
								deployConfig,
								token,
								userID
							}
						};
						socket.send(JSON.stringify(object));
					} else {
						console.error("Socket not open");
					}
				};

				openSocket(sendDeployMessageWithDockerfile);
			};

			reader.readAsDataURL(file);

		}
	};

	const initiateServiceLogs = () => {
		if (!serviceName && !deploymentId) return;

		const socket = wsRef.current;
		if (socket?.readyState === WebSocket.OPEN) {
			const object = {
				type: 'service_logs',
				payload: {
					serviceName,
					deploymentId,
				}
			}
			socket.send(JSON.stringify(object))
		}
	}

	function processServiceLogs(logs: { timestamp: string, message?: string }[]) {
		setServiceLogs(prev => [...prev, ...logs]);
	}

	function deployLogs({ id, msg, time }: { id: string; msg: string; time?: string }) {
		setDeployStatus("running");
		setDeployLogEntries((prev) => [
			...prev,
			{
				timestamp: time,
				message: msg,
			},
		]);

		setSteps((prev) => {
			const existing = prev.find((s) => s.id === id);
			if (!existing) {
				return [...prev, { id, label: id, logs: [msg], status: "in_progress" as const }];
			}
			return prev.map((step) =>
				step.id === id
					? {
						...step,
						status: msg.includes("✅") ? "success" : msg.includes("❌") ? "error" : step.status === "pending" ? "in_progress" : step.status,
						logs: [...step.logs, msg],
					}
					: step
			);
		});
	}

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