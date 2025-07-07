import dotenv from "dotenv";
dotenv.config();


import { WebSocketServer } from "ws";
import http from "http";
import { handleDeploy } from "./lib/handleDeploy"; // Your deploy function

// Setup HTTP server to attach WebSocket to
const server = http.createServer();
const wss = new WebSocketServer({ server });
const port = 4001;

wss.on("connection", (ws) => {
	console.log("🔌 Client connected");

	ws.on("message", async (data) => {
		try {
			const msg = JSON.parse(data.toString());

			const {
				deployConfig,
				token
			} = msg;

			// ws.send(`🚀 Deployment ${deploymentId} started`);

			await handleDeploy(deployConfig, token, ws);

			// ws.send(`✅ Deployment ${deploymentId} finished`);
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
