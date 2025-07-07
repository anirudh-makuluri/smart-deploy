import dotenv from "dotenv";
dotenv.config();


import { WebSocketServer } from "ws";
import http from "http";
import { handleDeploy } from "./lib/handleDeploy"; // Your deploy function
import { DeployConfig } from "./app/types";

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
			} : { deployConfig : DeployConfig, token : string } = msg;

			if (deployConfig.dockerfileInfo) {
				const { name, content } = deployConfig.dockerfileInfo;

				// Extract base64 content from data URI
				const base64 = content.split(',')[1];
				const buffer = Buffer.from(base64, 'base64');

				// If needed, save or pass this to handleDeploy
				// fs.writeFileSync(`/tmp/${name}`, buffer);

				deployConfig.dockerfileContent = buffer.toString();
			}


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
