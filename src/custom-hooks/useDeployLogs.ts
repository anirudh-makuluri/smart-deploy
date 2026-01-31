import { DeployConfig, DeployStep } from "@/app/types";
import { readDockerfile } from "@/lib/utils";
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


function getWebSocketUrl(): string {
	const env = process.env.NEXT_PUBLIC_WS_URL;
	if (typeof env === "string" && env) {
		return env.replace(/^https?/, (p) => (p === "https" ? "wss" : "ws"));
	}
	if (typeof window !== "undefined" && window.location.protocol === "https:") {
		return `wss://${window.location.host}/ws`;
	}
	return "ws://localhost:4001";
}

export function useDeployLogs(serviceName ?: string) {
	const [steps, setSteps] = useState<DeployStep[]>(() => [...defaultSteps]);
	const [socketStatus, setSocketStatus] = useState<SocketStatus>("connecting");
	const [deployStatus, setDeployStatus] = useState<DeployStatus>("not-started");
	const [serviceLogs, setServiceLogs] = useState<{timestamp : string, message ?: string}[]>([]);

	const deployConfigRef = useRef<DeployConfig | null>(null);

	const wsRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		const ws = new WebSocket(getWebSocketUrl());
		wsRef.current = ws;

		ws.onopen = () => {
			console.log("Connected to Server: 4001")
			setSocketStatus("open");
			initiateServiceLogs();
		};

		ws.onmessage = (e) => {
			const data = JSON.parse(e.data);
			const type = data.type;
			const payload = data.payload;


			switch (type) {
				case 'initial_logs':
					processServiceLogs(payload.logs);
					break;
				case 'stream_logs':
					processServiceLogs([payload.log]);
					break;
				case 'deploy_logs':
					deployLogs(payload);
					break;
				case 'deploy_steps':
					// Server sends step list for this target; merge to preserve existing logs (e.g. auth, clone)
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
				case 'deploy_complete':
					setDeployStatus(payload.success ? "success" : "error");
					if (payload.success && payload.deployUrl && deployConfigRef.current) {
						deployConfigRef.current = { 
							...deployConfigRef.current, 
							deployUrl: payload.deployUrl,
							status: "running",
							// Save deployed-service to persist actual deployed service type (even if deploymentTarget changes later)
							"deployed-service": payload.deploymentTarget || deployConfigRef.current.deploymentTarget || deployConfigRef.current["deployed-service"]
						};
					}
					// Mark done step as success when deploy completed successfully
					if (payload.success) {
						setSteps((prev) =>
							prev.map((s) => (s.id === "done" ? { ...s, status: "success" as const } : s))
						);
					}
					break;
				default:
					break;
			}
		};

		ws.onerror = () => {
			setSocketStatus("error");
			setDeployStatus("error")
		};

		ws.onclose = () => {
			setSocketStatus("closed");
			setDeployStatus("error")
		};

		return () => {
			ws.close();
		};
	}, []);

	const openSocket = () => {
		const ws = new WebSocket(getWebSocketUrl());
		wsRef.current = ws;
	}

	const sendDeployConfig = (deployConfig: DeployConfig, token: string) => {
		deployConfigRef.current = deployConfig;
		setDeployStatus("running");
		// Reset steps to default so server's deploy_steps can replace or merge; avoids showing previous deploy's steps
		setSteps([...defaultSteps]);

		const file = deployConfig.dockerfile;

		if (!file || !deployConfig.use_custom_dockerfile) {
			let socket = wsRef.current;
			if (!socket) {
				openSocket();
			}
			socket = wsRef.current;
			if (socket?.readyState === WebSocket.OPEN) {
				const object = {
					type: 'deploy',
					payload : {
						deployConfig,
						token
					}
				}
				socket.send(JSON.stringify(object));
			} else {
				console.error("Socket not open");
			}
		} else {
			const reader = new FileReader();

			reader.onload =  async () => {
				const base64 = reader.result as string;
				const socket = wsRef.current;

				deployConfig.dockerfileInfo = {
					name: file.name,
					type: file.type,
					content: base64
				}

				deployConfig.dockerfileContent = await readDockerfile(file);

				deployConfigRef.current = deployConfig;

				if (socket?.readyState === WebSocket.OPEN) {
					const object = {
						type: 'deploy',
						payload: {
							deployConfig,
							token
						}
					}
					socket.send(
						JSON.stringify(object)
					);
				} else {
					console.error("Socket not open");
				}
			};

			reader.readAsDataURL(file);
			
		}
	};

	const initiateServiceLogs = () => {
		if(!serviceName) return;

		const socket = wsRef.current;
		if (socket?.readyState === WebSocket.OPEN) {
			const object = {
				type: 'service_logs',
				payload : {
					serviceName
				}
			}
			socket.send(JSON.stringify(object))
		}
	}

	function processServiceLogs(logs : {timestamp : string, message ?: string}[]) {
		setServiceLogs(prev => [...prev, ...logs]);
	}

	function deployLogs({ id, msg }: { id: string; msg: string }) {
		setDeployStatus("running");

		setSteps((prev) => {
			const existing = prev.find((s) => s.id === id);
			if (!existing) {
				// Server sent a step id we don't have yet (e.g. detect, database, amplify); append so we don't drop logs
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

	return { steps, socketStatus, sendDeployConfig, openSocket, deployConfigRef, deployStatus, initiateServiceLogs, serviceLogs };
}