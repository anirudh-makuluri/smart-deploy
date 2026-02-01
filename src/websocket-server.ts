import dotenv from "dotenv";
dotenv.config();


import { WebSocketServer } from "ws";
import http from "http";
import { deploy, serviceLogs } from "./websocket-types";

// Setup HTTP server to attach WebSocket to
const server = http.createServer();
const wss = new WebSocketServer({ server });
const port = Number(process.env.WS_PORT) || 4001;

function sendDeployComplete(ws: any, success: boolean, error?: string) {
	if (ws?.readyState === 1) {
		ws.send(JSON.stringify({
			type: "deploy_complete",
			payload: { success, deployUrl: null, error: error ?? null },
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
	});
});

// When the process is about to crash, notify connected clients so they can show "connection lost"
function broadcastDeployFailed(reason: string) {
	const payload = JSON.stringify({
		type: "deploy_complete",
		payload: { success: false, deployUrl: null, error: reason },
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
