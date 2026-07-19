import type { DeployStep } from "../app/types";
import { emitToWorkerDeploymentRoom } from "@/lib/workerSocketServer";
import {
	type DeployLogEntry,
	type DeploySnapshotPayload,
	type WorkerSocketStatus,
	WORKER_SOCKET_SERVER_EVENTS,
} from "@/lib/workerSocketEvents";
import { makeRuntimeStoreKey } from "@/lib/runtimeStoreKey";

type Entry = {
	steps: DeployStep[];
	logEntries: DeployLogEntry[];
	status: WorkerSocketStatus;
	error?: string | null;
};

const store = new Map<string, Entry>();


function key(userID: string | undefined, repoName: string, serviceName: string): string {
	return makeRuntimeStoreKey(userID, repoName, serviceName);
}

export function createEntry(userID: string | undefined, repoName: string, serviceName: string): void {
	const k = key(userID, repoName, serviceName);
	store.set(k, {
		steps: [],
		logEntries: [],
		status: "queued",
		error: null,
	});
}

export function ensureEntry(userID: string | undefined, repoName: string, serviceName: string): void {
	const k = key(userID, repoName, serviceName);
	if (store.has(k)) return;
	store.set(k, {
		steps: [],
		logEntries: [],
		status: "running",
		error: null,
	});
}

export function deleteEntry(userID: string, repoName: string, serviceName: string) {
	const k = key(userID, repoName, serviceName);
	store.delete(k);
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
	msg: string,
	timeOverride?: string
): void {
	const entry = store.get(key(userID, repoName, serviceName));
	if (!entry) return;
	entry.status = "running";
	const time = timeOverride || new Date().toISOString();
	const payload = { id, msg, time };
	entry.logEntries.push({
		id,
		message: msg,
		timestamp: time,
	});
	if (!userID) return;
	emitToWorkerDeploymentRoom(userID, repoName, serviceName, WORKER_SOCKET_SERVER_EVENTS.deployLog, payload);
}

export function broadcastCompletion(
	userID: string | undefined,
	repoName: string,
	serviceName: string,
	payload: unknown
): void {
	const entry = store.get(key(userID, repoName, serviceName));
	if (!entry) return;
	if (!userID) return;
	emitToWorkerDeploymentRoom(userID, repoName, serviceName, WORKER_SOCKET_SERVER_EVENTS.deployComplete, payload);
}

export function setStatus(
	userID: string | undefined,
	repoName: string,
	serviceName: string,
	status: WorkerSocketStatus,
	error?: string | null
): void {
	const entry = store.get(key(userID, repoName, serviceName));
	if (entry) {
		entry.status = status;
		entry.error = error ?? null;
	}
}

export function getSnapshot(userID: string | undefined, repoName: string, serviceName: string): {
	logEntries: DeployLogEntry[];
	status: WorkerSocketStatus;
	error?: string | null;
} | null {
	const entry = store.get(key(userID, repoName, serviceName));
	if (!entry) return null;
	return {
		logEntries: entry.logEntries,
		status: entry.status,
		error: entry.error,
	};
}

export function getSocketSnapshot(
	userID: string | undefined,
	repoName: string,
	serviceName: string
): DeploySnapshotPayload | null {
	if (!userID) return null;
	const snapshot = getSnapshot(userID, repoName, serviceName);
	if (!snapshot) return null;

	return {
		repoName,
		serviceName,
		logEntries: snapshot.logEntries,
		status: snapshot.status,
		error: snapshot.error ?? null,
	};
}

/** In-memory queued or running deploys. Used to greet reconnecting clients. */
export function listRunningDeploymentsForUser(userID: string): Array<{ repoName: string; serviceName: string }> {
	const out: Array<{ repoName: string; serviceName: string }> = [];
	const prefix = `${userID}:`;
	for (const [k, entry] of store) {
		if (entry.status !== "queued" && entry.status !== "running") continue;
		if (!k.startsWith(prefix)) continue;
		const rest = k.slice(prefix.length);
		const sep = rest.lastIndexOf(":");
		if (sep <= 0) continue;
		out.push({
			repoName: rest.slice(0, sep),
			serviceName: rest.slice(sep + 1),
		});
	}
	return out;
}
