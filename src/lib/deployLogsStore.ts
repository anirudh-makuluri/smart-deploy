import type { DeployStep } from "../app/types";

type Status = "running" | "success" | "error";

type Entry = {
	steps: DeployStep[];
	status: Status;
	error?: string | null;
	subscribedClients: Set<{ send: (data: string) => void; readyState: number }>;
};

const OPEN = 1;
const store = new Map<string, Entry>();

function key(userID: string | undefined, repoName: string, serviceName: string): string {
	return `${userID ?? "anonymous"}:${repoName}:${serviceName}`;
}

export function createEntry(userID: string | undefined, repoName: string, serviceName: string, ws: any): void {
	const k = key(userID, repoName, serviceName);
	store.set(k, {
		steps: [],
		status: "running",
		error: null,
		subscribedClients: new Set(ws ? [ws] : []),
	});
}

export function getEntry(userID: string | undefined, repoName: string, serviceName: string): Entry | undefined {
	return store.get(key(userID, repoName, serviceName));
}

export function updateSteps(userID: string | undefined, repoName: string, serviceName: string, steps: DeployStep[]): void {
	const entry = store.get(key(userID, repoName, serviceName));
	if (entry) entry.steps = steps;
}

export function broadcastLog(
	userID: string | undefined,
	repoName: string,
	serviceName: string,
	id: string,
	msg: string
): void {
	const entry = store.get(key(userID, repoName, serviceName));
	if (!entry) return;
	const time = new Date().toISOString();
	const payload = JSON.stringify({ type: "deploy_logs", payload: { id, msg, time } });
	for (const client of entry.subscribedClients) {
		if (client.readyState === OPEN) {
			try {
				client.send(payload);
			} catch (_) {
				// ignore
			}
		}
	}
}

export function setStatus(
	userID: string | undefined,
	repoName: string,
	serviceName: string,
	status: Status,
	error?: string | null
): void {
	const entry = store.get(key(userID, repoName, serviceName));
	if (entry) {
		entry.status = status;
		entry.error = error ?? null;
	}
}

export function addSubscriber(userID: string | undefined, repoName: string, serviceName: string, ws: any): void {
	const entry = store.get(key(userID, repoName, serviceName));
	if (entry) entry.subscribedClients.add(ws);
}

export function removeSubscriber(userID: string | undefined, repoName: string, serviceName: string, ws: any): void {
	const entry = store.get(key(userID, repoName, serviceName));
	if (entry) entry.subscribedClients.delete(ws);
}

/** Remove this ws from every entry (e.g. on client disconnect). */
export function removeSubscriberFromAll(ws: any): void {
	for (const entry of store.values()) {
		entry.subscribedClients.delete(ws);
	}
}

export function getSnapshot(userID: string | undefined, repoName: string, serviceName: string): {
	steps: DeployStep[];
	status: Status;
	error?: string | null;
} | null {
	const entry = store.get(key(userID, repoName, serviceName));
	if (!entry) return null;
	return {
		steps: entry.steps,
		status: entry.status,
		error: entry.error,
	};
}
