import { DeployStep } from "../app/types";
import { emitWorkerSocketEvent, WORKER_SOCKET_SERVER_EVENTS } from "@/lib/workerSocketEvents";

/**
 * Creates a simple WebSocket logger function that sends messages to the client.
 */
export function createWebSocketLogger(ws: any) {
	return (msg: string, id: string) => {
		const trackedSend = ws ? (ws as any).__deploySend : undefined;
		if (trackedSend && typeof trackedSend === "function") {
			trackedSend(msg, id);
			return;
		}

		emitWorkerSocketEvent(ws, WORKER_SOCKET_SERVER_EVENTS.deployLog, {
			id,
			msg,
			time: new Date().toISOString(),
		});
	};
}

function getFallbackStepLabel(stepId: string): string {
	switch (stepId) {
		case "auth":
			return "Authentication";
		case "clone":
			return "Clone repository";
		case "database":
			return "Database";
		case "setup":
			return "Setup";
		case "build":
		case "docker":
			return "Build";
		case "publish":
			return "Publish";
		case "deploy":
			return "Deploy";
		case "rollout":
			return "ECS rollout";
		case "verify":
			return "Verify";
		case "rollback":
			return "Rollback";
		case "done":
			return "Done";
		default:
			return stepId
				.replace(/[_-]+/g, " ")
				.replace(/\b\w/g, (char) => char.toUpperCase());
	}
}

function isSuccessLog(msg: string): boolean {
	return msg.startsWith("SUCCESS:") || msg.startsWith("OK:") || msg.startsWith("✅");
}

function isErrorLog(msg: string): boolean {
	return msg.startsWith("ERROR:") || msg.startsWith("❌") || msg.toLowerCase().startsWith("failed:");
}

/**
 * Creates a WebSocket logger function that also tracks deployment steps.
 * Includes duplicate suppression: consecutive identical messages within 5s
 * are collapsed into a single entry with a repeat counter.
 */
export function createDeployStepsLogger(
	ws: any,
	deploySteps: DeployStep[],
	options?: {
		onStepsChange?: (steps: DeployStep[]) => void;
		broadcast?: (id: string, msg: string) => void;
	}
) {
	const { onStepsChange, broadcast } = options ?? {};

	// Dedup state: track last message per step to collapse rapid repeats.
	const lastMsg = new Map<string, { text: string; count: number; ts: number }>();
	const DEDUP_WINDOW_MS = 5000;

	return (msg: string, id: string) => {
		const now = new Date().toISOString();
		const nowMs = Date.now();
		const trimmed = msg.trim();

		const prev = lastMsg.get(id);
		if (prev && prev.text === trimmed && nowMs - prev.ts < DEDUP_WINDOW_MS) {
			prev.count++;
			prev.ts = nowMs;
			return;
		}

		if (prev && prev.count > 1) {
			const repeatNote = `  [repeated x${prev.count}]`;
			const lastStep = deploySteps.find((step) => step.id === id);
			if (lastStep) lastStep.logs.push(repeatNote);
			broadcast?.(id, repeatNote);
		}
		lastMsg.set(id, { text: trimmed, count: 1, ts: nowMs });

		let stepIndex = deploySteps.findIndex((step) => step.id === id);
		if (stepIndex === -1) {
			deploySteps.push({
				id,
				label: getFallbackStepLabel(id),
				logs: [msg],
				status: "in_progress",
				startedAt: now,
			});
			stepIndex = deploySteps.length - 1;
		} else {
			deploySteps[stepIndex].logs.push(msg);
			if (isSuccessLog(msg)) {
				deploySteps[stepIndex].status = "success";
				deploySteps[stepIndex].endedAt = now;
			} else if (isErrorLog(msg)) {
				deploySteps[stepIndex].status = "error";
				deploySteps[stepIndex].endedAt = now;
			}
		}

		onStepsChange?.(deploySteps);
		broadcast?.(id, msg);
	};
}
