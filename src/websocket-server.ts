import dotenv from "dotenv";
dotenv.config();

import http from "http";
import { deploy, serviceLogs } from "./websocket-types";
import { runDeploymentAgent } from "./lib/deploymentAgent";
import * as deployLogsStore from "./lib/deployLogsStore";
import { handleInternalDeploymentRunEvent } from "./lib/internalDeploymentRunEvents";
import { getAllowedOriginHeader, parseAllowedOrigins } from "./lib/wsOrigin";
import { startDeploymentHealthReconciler } from "./lib/deploymentHealthReconciler";
import { createWorkerSocketServer, type WorkerServerSocket } from "./lib/workerSocketServer";
import { createWorkerHealthPayload, getWorkerVersion } from "./lib/workerHealth";
import {
	emitWorkerSocketEvent,
	getWorkerDeploymentRoom,
	getWorkerUserRoom,
	WORKER_SOCKET_CLIENT_EVENTS,
	WORKER_SOCKET_SERVER_EVENTS,
} from "./lib/workerSocketEvents";

const port = Number(process.env.PORT || process.env.WS_PORT) || 4001;
const allowedOrigins = parseAllowedOrigins(process.env.WS_ALLOWED_ORIGINS);
const environment = process.env.NODE_ENV || "development";
const version = getWorkerVersion(process.env.WORKER_VERSION);
const allowedOriginsLabel = allowedOrigins.length > 0 ? allowedOrigins.join(", ") : "(any)";
const deploymentEventsToken = (
	process.env.DEPLOYMENT_EVENTS_TOKEN ||
	process.env.INTERNAL_DEPLOYMENT_EVENTS_TOKEN ||
	""
).trim();

function readRequestBody(req: http.IncomingMessage, maxBytes = 256 * 1024): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			body += chunk;
			if (Buffer.byteLength(body, "utf8") > maxBytes) {
				reject(new Error("Request body is too large."));
				req.destroy();
			}
		});
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

function bearerToken(req: http.IncomingMessage): string {
	const header = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match?.[1]?.trim() || "";
}

async function handleInternalDeploymentEventRequest(req: http.IncomingMessage, res: http.ServerResponse, runId: string) {
	if (!deploymentEventsToken) {
		res.writeHead(503, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: false, error: "Deployment event bridge is not configured." }));
		return;
	}
	if (bearerToken(req) !== deploymentEventsToken) {
		res.writeHead(401, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
		return;
	}

	try {
		const bodyText = await readRequestBody(req);
		const body = JSON.parse(bodyText || "{}") as { event?: unknown; payload?: unknown };
		const result = await handleInternalDeploymentRunEvent(runId, body);
		if (!result.ok) {
			res.writeHead(result.status, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: result.error }));
			return;
		}
		res.writeHead(202, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true }));
	} catch (error) {
		res.writeHead(400, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Invalid request" }));
	}
}

// Setup HTTP server to attach Socket.IO to
const server = http.createServer((req, res) => {
	const requestOrigin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
	const allowedOrigin = getAllowedOriginHeader(requestOrigin, allowedOrigins);
	if (allowedOrigin) {
		res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
		res.setHeader("Vary", "Origin");
	}
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

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

	const url = new URL(req.url || "/", "http://localhost");
	const internalEventMatch = /^\/internal\/deployment-runs\/([^/]+)\/events$/.exec(url.pathname);
	if (internalEventMatch) {
		if (req.method !== "POST") {
			res.writeHead(405, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
			return;
		}
		void handleInternalDeploymentEventRequest(req, res, decodeURIComponent(internalEventMatch[1] || ""));
		return;
	}

	if (url.pathname === "/health" || url.pathname === "/") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(createWorkerHealthPayload({ port, environment, version })));
		return;
	}

	res.writeHead(200, { "Content-Type": "text/plain" });
	res.end("SmartDeploy WebSocket server is running");
});

const io = createWorkerSocketServer(server, allowedOrigins);

function emitActiveDeployments(socket: WorkerServerSocket) {
	const running = deployLogsStore.listRunningDeploymentsForUser(socket.data.userID);
	if (running.length === 0) return;

	emitWorkerSocketEvent(socket, WORKER_SOCKET_SERVER_EVENTS.activeDeployments, {
		deployments: running,
	});
}

function emitDeployFailure(
	socket: WorkerServerSocket,
	hostedSubdomain: string,
	error: string
) {
	emitWorkerSocketEvent(socket, WORKER_SOCKET_SERVER_EVENTS.deployComplete, {
		success: false,
		time: new Date().toISOString(),
		hosted_subdomain: hostedSubdomain,
		error,
	});
}

function emitSocketError(socket: WorkerServerSocket, error?: string) {
	emitWorkerSocketEvent(socket, WORKER_SOCKET_SERVER_EVENTS.workerError, {
		error: error ?? "Request failed",
		time: new Date().toISOString(),
	});
}

async function subscribeWorkspace(
	socket: WorkerServerSocket,
	payload: { serviceName?: string; repoName?: string } | null | undefined
) {
	const serviceName = payload?.serviceName?.trim();
	const repoName = payload?.repoName?.trim();
	if (!serviceName || !repoName) return;

	socket.join(getWorkerDeploymentRoom(socket.data.userID, repoName, serviceName));
	const snapshot = deployLogsStore.getSocketSnapshot(socket.data.userID, repoName, serviceName);
	if (snapshot) {
		emitWorkerSocketEvent(socket, WORKER_SOCKET_SERVER_EVENTS.deploySnapshot, snapshot);
	}

	await serviceLogs({ serviceName, repoName }, socket);
}

function unsubscribeWorkspace(
	socket: WorkerServerSocket,
	payload: { serviceName?: string; repoName?: string } | null | undefined
) {
	const serviceName = payload?.serviceName?.trim();
	const repoName = payload?.repoName?.trim();
	if (!serviceName || !repoName) return;

	socket.leave(getWorkerDeploymentRoom(socket.data.userID, repoName, serviceName));
}

io.on("connection", (socket) => {
	const requestOrigin = typeof socket.handshake.headers.origin === "string" ? socket.handshake.headers.origin : undefined;
	const hasAuth = typeof socket.handshake.auth.token === "string" && socket.handshake.auth.token.trim().length > 0;
	console.log(`[ws] incoming connection origin=${requestOrigin || "none"} hasAuth=${hasAuth}`);

	socket.join(getWorkerUserRoom(socket.data.userID));
	console.log(`Client connected [${socket.data.userLabel}]`);
	emitActiveDeployments(socket);

	socket.on(WORKER_SOCKET_CLIENT_EVENTS.workspaceSubscribe, (payload: unknown) => {
		void subscribeWorkspace(socket, payload as { serviceName?: string; repoName?: string });
	});

	socket.on(WORKER_SOCKET_CLIENT_EVENTS.workspaceUnsubscribe, (payload: unknown) => {
		unsubscribeWorkspace(socket, payload as { serviceName?: string; repoName?: string });
	});

	socket.on(WORKER_SOCKET_CLIENT_EVENTS.agentRun, async (payload: unknown) => {
		try {
			const conversationId =
				typeof (payload as { conversationId?: unknown } | null | undefined)?.conversationId === "string"
					? (payload as { conversationId: string }).conversationId.trim()
					: "";
			const message =
				typeof (payload as { message?: unknown } | null | undefined)?.message === "string"
					? (payload as { message: string }).message.trim()
					: "";

			if (!conversationId) {
				emitWorkerSocketEvent(socket, WORKER_SOCKET_SERVER_EVENTS.agentError, {
					runId: "",
					message: "Agent conversationId is required.",
					docCitations: [],
				});
				return;
			}

			if (!message) {
				emitWorkerSocketEvent(socket, WORKER_SOCKET_SERVER_EVENTS.agentError, {
					runId: "",
					message: "Agent message is required.",
					docCitations: [],
				});
				return;
			}

			await runDeploymentAgent({
				conversationId,
				userID: socket.data.userID,
				message,
				emit: (event, eventPayload) => {
					emitWorkerSocketEvent(socket, event, eventPayload);
				},
			});
		} catch (err) {
			console.error("Deployment agent error:", err);
			emitWorkerSocketEvent(socket, WORKER_SOCKET_SERVER_EVENTS.agentError, {
				runId: "",
				message: err instanceof Error ? err.message : "Agent request failed",
				docCitations: [],
			});
		}
	});

	socket.on(WORKER_SOCKET_CLIENT_EVENTS.deploy, async (payload: unknown) => {
		try {
			const deployPayload = payload as {
				deployConfig?: { repoName?: string; serviceName?: string; hostedSubdomain?: string };
				token?: string;
			};
			const repoName = deployPayload.deployConfig?.repoName?.trim() || "";
			const serviceName = deployPayload.deployConfig?.serviceName?.trim() || "";
			if (repoName && serviceName) {
				socket.join(getWorkerDeploymentRoom(socket.data.userID, repoName, serviceName));
			}

			await deploy(
				{
					...(payload as object),
					userID: socket.data.userID,
				} as never,
				socket
			);
		} catch (err) {
			console.error("Deploy error:", err);
			const deployPayload = payload as {
				deployConfig?: { hostedSubdomain?: string };
			};
			emitDeployFailure(
				socket,
				deployPayload.deployConfig?.hostedSubdomain || "",
				err instanceof Error ? err.message : "Deployment failed"
			);
		}
	});

	socket.on("disconnect", () => {
		console.log(`Client disconnected [${socket.data.userLabel}]`);
	});

	socket.on("error", (error) => {
		emitSocketError(socket, error instanceof Error ? error.message : "Request failed");
	});
});

server.listen(port, "0.0.0.0", () => {
	console.log(`WebSocket server running on 0.0.0.0:${port}`);
	console.log(`[ws] allowed origins: ${allowedOriginsLabel}`);
	startDeploymentHealthReconciler();
});

// Log uncaught exceptions and rejections, but don't broadcast to clients
// These aren't necessarily deployment failures
process.on("uncaughtException", (err) => {
	console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
	console.error("Unhandled rejection:", reason);
});
