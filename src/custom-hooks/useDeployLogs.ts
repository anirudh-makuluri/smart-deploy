import { DeployConfig, DeployStep } from "@/app/types";
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

export function useDeployLogs() {
	const [steps, setSteps] = useState(initialSteps);
	const [socketStatus, setSocketStatus] = useState<SocketStatus>("connecting");
	const [deployStatus, setDeployStatus] = useState<DeployStatus>("not-started")

	const deployConfigRef = useRef<DeployConfig | null>(null);

	const latestStepRef = useRef<string>(steps[0].id);
	const wsRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		const ws = new WebSocket("ws://localhost:4001");
		wsRef.current = ws;

		ws.onopen = () => {
			console.log("Connected to Server: 4001")
			setSocketStatus("open");
		};

		ws.onmessage = (e) => {
			const msg = e.data as string;
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

			const match = msg.match(/^\[(.*?)\] (.*)$/);
			let stepId = "";
			let log = "";
			if (!match) {
				stepId = latestStepRef.current
				log = msg;
			} else {
				[, stepId, log] = match;
				latestStepRef.current = stepId
			}

			

			setSteps((prev) =>
				prev.map((step) =>
					step.id === stepId
						? {
							...step,
							status: log.includes("✅") ? "success"
								: log.includes("❌") ? "error"
									: step.status === "pending" ? "in_progress" : step.status,
							logs: [...step.logs, log],
						}
						: step
				)
			);
		};

		ws.onerror = () => {
			setSocketStatus("error");
			setDeployStatus("error")
			const stepId = latestStepRef.current;
			const log = "❌ WebSocket connection error"
			setSteps((prev) =>
				prev.map((step) =>
					step.id === stepId
						? {
							...step,
							status: log.includes("✅") ? "success"
								: log.includes("❌") ? "error"
									: step.status === "pending" ? "in_progress" : step.status,
							logs: [...step.logs, log],
						}
						: step
				)
			);
		};

		ws.onclose = () => {
			setSocketStatus("closed");
		};

		return () => {
			ws.close();
		};
	}, []);

	const sendDeployConfig = (deployConfig: DeployConfig, token: string) => {
		deployConfigRef.current = deployConfig;

		const file = deployConfig.dockerfile;

		if (!file) {
			const socket = wsRef.current;
			if (socket?.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ deployConfig, token }));
				// setLogs((prev) => [...prev, `🚀 Starting deployment: ${deployConfig.id}`]);
			} else {
				console.error("Socket not open");
			}
		} else {
			const reader = new FileReader();

			reader.onload = () => {
				const base64 = reader.result as string;
				const socket = wsRef.current;

				if (socket?.readyState === WebSocket.OPEN) {
					socket.send(
						JSON.stringify({
							deployConfig: {
								...deployConfig,
								dockerfileInfo: {
									name: file.name,
									type: file.type,
									content: base64, // <- send base64
								},
							},
							token,
						})
					);
				} else {
					console.error("Socket not open");
				}
			};

			reader.readAsDataURL(file);
			
		}
	};

	return { steps, socketStatus, sendDeployConfig, deployConfigRef, deployStatus };
}
