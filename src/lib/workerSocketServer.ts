import http from "http";
import { Server, Socket } from "socket.io";
import { verifyWebSocketAuthToken } from "@/lib/wsAuth";
import { getWorkerDeploymentRoom, getWorkerUserRoom, resolveWorkerSocketIoPath } from "@/lib/workerSocketEvents";
import { isOriginAllowed } from "@/lib/wsOrigin";

export type WorkerSocketData = {
	userID: string;
	userLabel: string;
};

export type WorkerServerSocket = Socket<any, any, any, WorkerSocketData>;

let ioServer: Server<any, any, any, WorkerSocketData> | null = null;

export function createWorkerSocketServer(server: http.Server, allowedOrigins: string[]) {
	if (ioServer) {
		return ioServer;
	}

	ioServer = new Server(server, {
		path: resolveWorkerSocketIoPath(process.env.NEXT_PUBLIC_WS_URL?.trim() || ""),
		cors: {
			origin(origin, callback) {
				if (isOriginAllowed(origin, allowedOrigins)) {
					callback(null, true);
					return;
				}

				callback(new Error("Forbidden origin"));
			},
			credentials: true,
			methods: ["GET", "POST"],
		},
	});

	ioServer.use((socket, next) => {
		const authToken = typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : "";
		const authPayload = verifyWebSocketAuthToken(authToken);
		if (!authPayload?.userID) {
			next(new Error("Unauthorized"));
			return;
		}

		socket.data.userID = authPayload.userID;
		socket.data.userLabel = authPayload.userID.slice(0, 4) || "user";
		next();
	});

	return ioServer;
}

export function getWorkerSocketServer() {
	return ioServer;
}

export function emitToWorkerUserRoom(userID: string, event: string, payload: unknown): void {
	ioServer?.to(getWorkerUserRoom(userID)).emit(event, payload);
}

export function emitToWorkerDeploymentRoom(
	userID: string,
	repoName: string,
	serviceName: string,
	event: string,
	payload: unknown
): void {
	ioServer?.to(getWorkerDeploymentRoom(userID, repoName, serviceName)).emit(event, payload);
}
