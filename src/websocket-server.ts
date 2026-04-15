import dotenv from "dotenv";
dotenv.config();

import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import { deploy, serviceLogs } from "./websocket-types";
import * as deployLogsStore from "./lib/deployLogsStore";
import { dbHelper } from "./db-helper";
import { verifyWebSocketAuthToken } from "./lib/wsAuth";
import { getAllowedOriginHeader, isOriginAllowed, parseAllowedOrigins } from "./lib/wsOrigin";

async function getSnapshotFromHistory(repoName: string, serviceName: string, userID?: string) {
	let resolvedUserId = userID;
	let currentDeployment: any = null;
	if (!resolvedUserId) {
		const deploymentResponse = await dbHelper.getDeployment(repoName, serviceName);
		currentDeployment = deploymentResponse.deployment;
		resolvedUserId = currentDeployment?.ownerID;
	} else {
		// Also fetch the current deployment to check its status
		const deploymentResponse = await dbHelper.getDeployment(repoName, serviceName);
		currentDeployment = deploymentResponse.deployment;
	}
	if (!resolvedUserId) return null;

	// If the current deployment is in "didnt_deploy" status (fresh/draft), don't show old history
	if (currentDeployment?.status === "didnt_deploy") {
		return null;
	}

	const historyResponse = await dbHelper.getDeploymentHistory(repoName, serviceName, resolvedUserId);
	if (historyResponse.error || !historyResponse.history || historyResponse.history.length === 0) {
		return null;
	}

	const latest = historyResponse.history[0];
	// Preserve actual failure details from the deploy steps instead of generic message
	let errorDetail: string | null = null;
	if (!latest.success) {
		const errorSteps = (latest.steps ?? []).filter((s: any) => s.status === "error");
		const errorLogs = errorSteps.flatMap((s: any) => (s.logs || []).filter((l: string) => l.includes("❌") || l.toLowerCase().includes("error") || l.toLowerCase().includes("failed")));
		errorDetail = errorLogs.length > 0 ? errorLogs.slice(-3).join("\n") : "Deployment failed";
	}
	return {
		steps: latest.steps ?? [],
		status: (latest.success ? "success" : "error") as "success" | "error",
		error: errorDetail,
	};
}

const port = Number(process.env.PORT || process.env.WS_PORT) || 4001;
const allowedOrigins = parseAllowedOrigins(process.env.WS_ALLOWED_ORIGINS);

type AuthenticatedSocket = WebSocket & {
	authUserID?: string;
};

// Setup HTTP server to attach WebSocket to
const server = http.createServer((req, res) => {
	const requestOrigin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
	const allowedOrigin = getAllowedOriginHeader(requestOrigin, allowedOrigins);
	if (allowedOrigin) {
		res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
		res.setHeader("Vary", "Origin");
	}
	res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");

	if (requestOrigin && !allowedOrigin) {
		res.writeHead(403, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: false, error: "Origin not allowed" }));
		return;
	}

	if (req.method === "OPTIONS") {
		res.writeHead(204);
		res.end();
		return;
	}

	if (req.url === "/health" || req.url === "/") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true, service: "websocket", port }));
		return;
	}

	if (req.url?.startsWith("/healthz")) {
		const requestUrl = new URL(req.url, "http://localhost");
		const authToken = requestUrl.searchParams.get("auth") || "";
		const authPayload = verifyWebSocketAuthToken(authToken);

		if (!authPayload?.userID) {
			res.writeHead(401, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
			return;
		}

		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true, service: "websocket", port, authenticated: true }));
		return;
	}

	res.writeHead(200, { "Content-Type": "text/plain" });
	res.end("SmartDeploy WebSocket server is running");
});
const wss = new WebSocketServer({ server });

function sendDeployComplete(ws: any, success: boolean, error?: string) {
	if (ws?.readyState === 1) {
		ws.send(JSON.stringify({
			type: "deploy_complete",
			payload: { success, deployUrl: null, error: error ?? null, time: new Date().toISOString() },
		}));
	}
}

wss.on("connection", (ws: AuthenticatedSocket, req) => {
	const requestOrigin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
	if (!isOriginAllowed(requestOrigin, allowedOrigins)) {
		ws.close(1008, "Forbidden origin");
		return;
	}

	const requestUrl = new URL(req.url || "/", "http://localhost");
	const authToken = requestUrl.searchParams.get("auth") || "";
	const authPayload = verifyWebSocketAuthToken(authToken);

	if (!authPayload?.userID) {
		ws.close(1008, "Unauthorized");
		return;
	}

	ws.authUserID = authPayload.userID;
	console.log("Client connected");

	// Defer so the browser has time to attach `onmessage` before this fires.
	queueMicrotask(() => {
		if (ws.readyState !== 1) return;
		const running = deployLogsStore.listRunningDeploymentsForUser(authPayload.userID);
		if (running.length === 0) return;
		try {
			ws.send(JSON.stringify({
				type: "active_deployments",
				payload: { deployments: running },
			}));
		} catch {
			// ignore
		}
	});

	ws.on("message", async (data) => {
		try {
			const response = JSON.parse(data.toString());
			const type = response.type;

			switch (type) {
				case "deploy":
					try {
						await deploy({
							...response.payload,
							userID: ws.authUserID,
						}, ws);
					} catch (err: any) {
						console.error("Deploy error:", err);
						sendDeployComplete(ws, false, err?.message ?? "Deployment failed");
					}
					break;
				case "service_logs":
					serviceLogs(response.payload, ws);
					break;
				case "get_deploy_logs": {
					const { repoName, serviceName } = response.payload ?? {};
					const userID = ws.authUserID;
					if (!repoName || !serviceName) {
						if (ws?.readyState === 1) {
							ws.send(JSON.stringify({ type: "deploy_logs_snapshot", payload: { error: "repoName and serviceName required", time: new Date().toISOString() } }));
						}
						break;
					}
					let snapshot = deployLogsStore.getSnapshot(userID, repoName, serviceName);
					if (!snapshot) {
						snapshot = await getSnapshotFromHistory(repoName, serviceName, userID);
					}
					const time = new Date().toISOString();
					if (snapshot) {
						if (ws?.readyState === 1) {
							ws.send(JSON.stringify({ type: "deploy_logs_snapshot", payload: { ...snapshot, time } }));
						}
						deployLogsStore.addSubscriber(userID, repoName, serviceName, ws);
					} else if (ws?.readyState === 1) {
						ws.send(JSON.stringify({
							type: "deploy_logs_snapshot",
							payload: { steps: [], status: "not-started", error: null, time },
						}));
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

server.listen(port, "0.0.0.0", () => {
	console.log(`WebSocket server running on 0.0.0.0:${port}`);
});

// Log uncaught exceptions and rejections, but don't broadcast to clients
// These aren't necessarily deployment failures
process.on("uncaughtException", (err) => {
	console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
	console.error("Unhandled rejection:", reason);
});
