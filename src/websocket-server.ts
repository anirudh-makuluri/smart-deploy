import dotenv from "dotenv";
dotenv.config();

import { WebSocketServer } from "ws";
import http from "http";
import { deploy, serviceLogs } from "./websocket-types";
import * as deployLogsStore from "./lib/deployLogsStore";
import { dbHelper } from "./db-helper";

async function getSnapshotFromHistory(deploymentId: string, userID?: string) {
	let resolvedUserId = userID;
	if (!resolvedUserId) {
		const deploymentResponse = await dbHelper.getDeployment(deploymentId);
		resolvedUserId = deploymentResponse.deployment?.ownerID;
	}
	if (!resolvedUserId) return null;

	const historyResponse = await dbHelper.getDeploymentHistory(deploymentId, resolvedUserId);
	if (historyResponse.error || !historyResponse.history || historyResponse.history.length === 0) {
		return null;
	}

	const latest = historyResponse.history[0];
	return {
		steps: latest.steps ?? [],
		status: (latest.success ? "success" : "error") as "success" | "error",
		error: latest.success ? null : "Deployment failed",
	};
}

// Setup HTTP server to attach WebSocket to
const server = http.createServer();
const wss = new WebSocketServer({ server });
const port = Number(process.env.WS_PORT) || 4001;

function sendDeployComplete(ws: any, success: boolean, error?: string) {
	if (ws?.readyState === 1) {
		ws.send(JSON.stringify({
			type: "deploy_complete",
			payload: { success, deployUrl: null, error: error ?? null, time: new Date().toISOString() },
		}));
	}
}

wss.on("connection", (ws) => {
	console.log("Client connected");

	ws.on("message", async (data) => {
		try {
			const response = JSON.parse(data.toString());
			const type = response.type;

			switch (type) {
				case "deploy":
					try {
						await deploy(response.payload, ws);
					} catch (err: any) {
						console.error("Deploy error:", err);
						sendDeployComplete(ws, false, err?.message ?? "Deployment failed");
					}
					break;
				case "service_logs":
					serviceLogs(response.payload, ws);
					break;
				case "get_deploy_logs": {
					const { deploymentId, userID } = response.payload ?? {};
					if (!deploymentId) {
						if (ws?.readyState === 1) {
							ws.send(JSON.stringify({ type: "deploy_logs_snapshot", payload: { error: "deploymentId required", time: new Date().toISOString() } }));
						}
						break;
					}
					let snapshot = deployLogsStore.getSnapshot(userID, deploymentId);
					if (!snapshot) {
						snapshot = await getSnapshotFromHistory(deploymentId, userID);
					}
					const time = new Date().toISOString();
					if (snapshot) {
						if (ws?.readyState === 1) {
							ws.send(JSON.stringify({ type: "deploy_logs_snapshot", payload: { ...snapshot, time } }));
						}
						deployLogsStore.addSubscriber(userID, deploymentId, ws);
					} else if (ws?.readyState === 1) {
						ws.send(JSON.stringify({ type: "deploy_logs_snapshot", payload: { steps: [], status: "error", error: "No logs found for this deployment", time } }));
					}
					break;
				}
				default:
					break;
			}
		} catch (err: any) {
			// JSON parse error or other sync error: send structured deploy_complete so client can show it
			sendDeployComplete(ws, false, err?.message ?? "Request failed");
		}
	});

	ws.on("close", () => {
		console.log("Client disconnected");
		deployLogsStore.removeSubscriberFromAll(ws);
	});
});

// When the process is about to crash, notify connected clients so they can show "connection lost"
function broadcastDeployFailed(reason: string) {
	const payload = JSON.stringify({
		type: "deploy_complete",
		payload: { success: false, deployUrl: null, error: reason, time: new Date().toISOString() },
	});
	wss.clients.forEach((client) => {
		if (client.readyState === 1) client.send(payload);
	});
}

process.on("uncaughtException", (err) => {
	console.error("Uncaught exception:", err);
	broadcastDeployFailed("Server error - deployment may have failed");
});

process.on("unhandledRejection", (reason) => {
	console.error("Unhandled rejection:", reason);
	broadcastDeployFailed("Server error - deployment may have failed");
});

server.listen(port, () => {
	console.log(`WebSocket server running on ws://localhost:${port}`);
});
