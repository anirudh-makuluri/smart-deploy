import { resolveWorkerSocketIoServerUrl } from "@/lib/workerSocketEvents";

type QueuedEvent = {
	event: string;
	payload: unknown;
};

type RemoteDeploymentEmitter = {
	__remoteDeploymentEventBridge: true;
	emit: (event: string, payload: unknown) => void;
};

const pendingRequests = new Set<Promise<void>>();

function readToken(): string {
	return (
		process.env.DEPLOYMENT_EVENTS_TOKEN ||
		process.env.INTERNAL_DEPLOYMENT_EVENTS_TOKEN ||
		""
	).trim();
}

function resolveBridgeBaseUrl(): string {
	const explicit = (
		process.env.DEPLOYMENT_EVENTS_URL ||
		process.env.INTERNAL_DEPLOYMENT_EVENTS_URL ||
		""
	).trim();
	if (explicit) return explicit.replace(/\/+$/, "");

	const wsUrl = (process.env.NEXT_PUBLIC_WS_URL || "").trim();
	if (!wsUrl) return "";
	return resolveWorkerSocketIoServerUrl(wsUrl);
}

async function postDeploymentRunEvent(runId: string, queued: QueuedEvent): Promise<void> {
	const baseUrl = resolveBridgeBaseUrl();
	const token = readToken();
	if (!baseUrl || !token) return;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5_000);
	try {
		const response = await fetch(`${baseUrl}/internal/deployment-runs/${encodeURIComponent(runId)}/events`, {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(queued),
			signal: controller.signal,
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			console.warn(`[deployment-event-bridge] POST failed (${response.status}): ${body || response.statusText}`);
		}
	} catch (error) {
		console.warn("[deployment-event-bridge] POST failed:", error);
	} finally {
		clearTimeout(timeout);
	}
}

function enqueueDeploymentRunEvent(runId: string, queued: QueuedEvent): void {
	const request = postDeploymentRunEvent(runId, queued).finally(() => {
		pendingRequests.delete(request);
	});
	pendingRequests.add(request);
}

export function createDeploymentRunEventBridge(runId: string): RemoteDeploymentEmitter | null {
	if (!runId || !resolveBridgeBaseUrl() || !readToken()) return null;

	return {
		__remoteDeploymentEventBridge: true,
		emit(event: string, payload: unknown) {
			enqueueDeploymentRunEvent(runId, { event, payload });
		},
	};
}

export function emitDeploymentRunLog(
	runId: string,
	stepId: string,
	message: string,
	time = new Date().toISOString()
): void {
	enqueueDeploymentRunEvent(runId, {
		event: "deploy:log",
		payload: { id: stepId, msg: message, time },
	});
}

export async function flushDeploymentRunEventBridge(): Promise<void> {
	await Promise.allSettled(Array.from(pendingRequests));
}

export const __testing = {
	resolveBridgeBaseUrl,
};

