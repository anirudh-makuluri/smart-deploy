import { CloudResources, DeployConfig, DeploymentTarget } from "@/app/types";

export type WorkerSocketStatus = "running" | "success" | "error";

export type ServiceLogEntry = {
	timestamp: string;
	message?: string;
};

export type DeployLogEntry = {
	id?: string;
	timestamp?: string;
	message?: string;
};

export type ActiveDeploymentRef = {
	repoName: string;
	serviceName: string;
};

export type DeployCompleteWsPayload = {
	success: boolean;
	hosted_subdomain: string;
	deploymentTarget: DeploymentTarget;
	finalStatus: DeployConfig["status"];
	cloudResources: CloudResources;
	rolledBack: boolean;
	error?: string;
};

export type DeploySnapshotPayload = {
	repoName: string;
	serviceName: string;
	logEntries: DeployLogEntry[];
	status: WorkerSocketStatus;
	error: string | null;
};

export type DeploymentStatusChangedPayload = {
	ownerID: string;
	repoName: string;
	serviceName: string;
	status: DeployConfig["status"];
};

export type AgentSocketMessagePayload = {
	runId: string;
	message: string;
};

export type AgentRunPayload = {
	conversationId: string;
	message: string;
};

export const WORKER_SOCKET_SERVER_EVENTS = {
	activeDeployments: "active_deployments",
	agentAccepted: "agent:accepted",
	agentComplete: "agent:complete",
	agentError: "agent:error",
	agentMessage: "agent:message",
	agentStatus: "agent:status",
	agentToolCompleted: "agent:tool_completed",
	agentToolStarted: "agent:tool_started",
	deployComplete: "deploy:complete",
	deployLog: "deploy:log",
	deploySnapshot: "deploy:snapshot",
	deploySteps: "deploy:steps",
	deploymentStatusChanged: "deployment:status_changed",
	serviceLogs: "service_logs:initial",
	workerError: "worker:error",
} as const;

export const WORKER_SOCKET_CLIENT_EVENTS = {
	agentRun: "agent:run",
	deploy: "deploy:run",
	workspaceSubscribe: "workspace:subscribe",
	workspaceUnsubscribe: "workspace:unsubscribe",
} as const;

const SOCKET_IO_DEFAULT_PATH = "/ws";

function normalizePublicWorkerUrl(wsBase: string): URL {
	const trimmed = wsBase.trim();
	const base = trimmed || "ws://localhost:4001";
	return new URL(base.replace(/^https?/, (protocol) => (protocol === "https" ? "wss" : "ws")));
}

export function resolveWorkerSocketIoPath(wsBase: string): string {
	const url = normalizePublicWorkerUrl(wsBase);
	const trimmedPath = url.pathname.replace(/\/+$/, "");
	return trimmedPath && trimmedPath !== "/" ? trimmedPath : SOCKET_IO_DEFAULT_PATH;
}

export function resolveWorkerSocketIoServerUrl(wsBase: string): string {
	const url = normalizePublicWorkerUrl(wsBase);
	url.protocol = url.protocol === "wss:" ? "https:" : "http:";
	url.pathname = "";
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/$/, "");
}

export function getWorkerUserRoom(userID: string): string {
	return `user:${userID}`;
}

export function getWorkerDeploymentRoom(userID: string, repoName: string, serviceName: string): string {
	return `deployment:${userID}:${repoName}:${serviceName}`;
}

export function emitWorkerSocketEvent(
	socket: { emit: (event: string, ...args: unknown[]) => unknown } | null | undefined,
	event: string,
	payload: unknown
): void {
	if (!socket) return;
	socket.emit(event, payload);
}
