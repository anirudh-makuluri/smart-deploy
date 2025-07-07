import { DeployConfig, DeployStep } from "@/app/types";
import { readDockerfile } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

type SocketStatus = "connecting" | "open" | "closed" | "error";
type DeployStatus = "not-started" | "running" | "success" | "error"

const initialSteps: DeployStep[] = [
	{ id: "auth", label: "🔐 Authentication", logs: [], status: "pending" },
	{ id: "clone", label: "📦 Cloning Repository", logs: [], status: "pending" },
	{ id: "docker", label: "🐳 Docker Build", logs: [], status: "pending" },
	{ id: "push", label: "📤 Push Image", logs: [], status: "pending" },
	{ id: "deploy", label: "🚀 Deploy to Cloud Run", logs: [], status: "pending" },
];

export function useDeployLogs(serviceName : string) {
	const [steps, setSteps] = useState(initialSteps);
	const [socketStatus, setSocketStatus] = useState<SocketStatus>("connecting");
	const [deployStatus, setDeployStatus] = useState<DeployStatus>("not-started");
	const [serviceLogs, setServiceLogs] = useState<{timestamp : string, message ?: string}[]>([]);

	const deployConfigRef = useRef<DeployConfig | null>(null);

	const wsRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		const ws = new WebSocket("ws://localhost:4001");
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
					processServiceLogs(payload.logs)
					break;
				case 'stream_logs':
					processServiceLogs([payload.log]);
					break;
				case 'deploy_logs':
					deployLogs(payload)
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

	const sendDeployConfig = (deployConfig: DeployConfig, token: string) => {
		deployConfigRef.current = deployConfig;

		const file = deployConfig.dockerfile;

		if (!file || !deployConfig.use_custom_dockerfile) {
			const socket = wsRef.current;
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

	function deployLogs({ id, msg } : { id : string, msg : string }) {
		setDeployStatus("running")

		if (msg.includes("Service URL")) {
			const match = msg.match(/https:\/\/[^\s]+/);
			if (match) {
				const deployedUrl = match[0];
				console.log("Extracted URL:", deployedUrl);
				if (deployConfigRef.current?.id) {
					const newConfig = { ...deployConfigRef.current, deployUrl: deployedUrl }
					deployConfigRef.current = newConfig
					setDeployStatus("success")
				}

			}
		}



		setSteps((prev) =>
			prev.map((step) =>
				step.id === id
					? {
						...step,
						status: msg.includes("✅") ? "success"
							: msg.includes("❌") ? "error"
								: step.status === "pending" ? "in_progress" : step.status,
						logs: [...step.logs, msg],
					}
					: step
			)
		);
	}

	return { steps, socketStatus, sendDeployConfig, deployConfigRef, deployStatus, initiateServiceLogs, serviceLogs };
}