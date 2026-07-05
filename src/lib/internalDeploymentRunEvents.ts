import { dbHelper } from "@/db-helper";
import * as deployLogsStore from "@/lib/deployLogsStore";
import {
	WORKER_SOCKET_SERVER_EVENTS,
	type WorkerSocketStatus,
} from "@/lib/workerSocketEvents";
import { emitToWorkerDeploymentRoom } from "@/lib/workerSocketServer";
import type { DeployStep } from "@/app/types";

type InternalDeploymentRunEventBody = {
	event?: unknown;
	payload?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function isDeployStepArray(value: unknown): value is DeployStep[] {
	return Array.isArray(value);
}

function completionStatus(payload: Record<string, unknown>): WorkerSocketStatus {
	return payload.success === true ? "success" : "error";
}

export async function handleInternalDeploymentRunEvent(
	runId: string,
	body: InternalDeploymentRunEventBody
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
	const event = asString(body.event).trim();
	if (!event) {
		return { ok: false, status: 400, error: "event is required." };
	}

	const runResponse = await dbHelper.getDeploymentRunSystem(runId);
	if (runResponse.error) {
		return { ok: false, status: 500, error: String(runResponse.error) };
	}

	const run = runResponse.run;
	if (!run) {
		return { ok: false, status: 404, error: "Deployment run not found." };
	}

	deployLogsStore.ensureEntry(run.userId, run.repoName, run.serviceName);
	const payload = asRecord(body.payload);

	if (event === WORKER_SOCKET_SERVER_EVENTS.deployLog) {
		const id = asString(payload.id).trim() || "deploy";
		const msg = asString(payload.msg);
		if (!msg) return { ok: true };
		const time = asString(payload.time).trim() || undefined;
		deployLogsStore.broadcastLog(run.userId, run.repoName, run.serviceName, id, msg, time);
		return { ok: true };
	}

	if (event === WORKER_SOCKET_SERVER_EVENTS.deploySteps) {
		const steps = payload.steps;
		if (isDeployStepArray(steps)) {
			deployLogsStore.updateSteps(run.userId, run.repoName, run.serviceName, steps);
		}
		emitToWorkerDeploymentRoom(run.userId, run.repoName, run.serviceName, event, body.payload);
		return { ok: true };
	}

	if (event === WORKER_SOCKET_SERVER_EVENTS.deployComplete) {
		const status = completionStatus(payload);
		const error = status === "error" ? asString(payload.error).trim() || "Deployment failed" : null;
		deployLogsStore.setStatus(run.userId, run.repoName, run.serviceName, status, error);
		deployLogsStore.broadcastCompletion(run.userId, run.repoName, run.serviceName, body.payload);
		return { ok: true };
	}

	return { ok: false, status: 400, error: `Unsupported deployment run event: ${event}` };
}

