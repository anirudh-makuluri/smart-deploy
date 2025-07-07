import dotenv from "dotenv";
dotenv.config();


import { WebSocketServer } from "ws";
import http from "http";
import { handleDeploy } from "./lib/handleDeploy"; // Your deploy function
import { DeployConfig } from "./app/types";
import { deploy, serviceLogs } from "./websocket-types";

// Setup HTTP server to attach WebSocket to
const server = http.createServer();
const wss = new WebSocketServer({ server });
const port = 4001;

wss.on("connection", (ws) => {
	console.log("🔌 Client connected");

	ws.on("message", async (data) => {
		try {
			const response = JSON.parse(data.toString());

			const type = response.type;

			switch (type) {
				case 'deploy':
					deploy(response.payload, ws)
					break;
				case 'service_logs':
					serviceLogs(response.payload, ws)
					break;			
				default:
					break;
			}

			
		} catch (err: any) {
			ws.send(`❌ Error: ${err.message}`);
			ws.close();
		}
	});

	ws.on("close", () => {
		console.log("❎ Client disconnected");
	});
});

server.listen(port, () => {
	console.log(`✅ WebSocket server running on ws://localhost:${port}`);
});
