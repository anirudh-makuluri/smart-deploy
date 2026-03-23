import { DeployStep } from "../app/types";

/**
 * Creates a simple WebSocket logger function that sends messages to the client
 * @param ws - WebSocket connection
 * @returns A send function that logs messages to the WebSocket
 */
export function createWebSocketLogger(ws: any) {
	return (msg: string, id: string) => {
		const trackedSend = ws ? (ws as any).__deploySend : undefined;
		if (trackedSend && typeof trackedSend === "function") {
			trackedSend(msg, id);
			return;
		}

		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg, time: new Date().toISOString() }
			};
			ws.send(JSON.stringify(object));
		}
	};
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

	// Dedup state: track last message per step to collapse rapid repeats
	const lastMsg = new Map<string, { text: string; count: number; ts: number }>();
	const DEDUP_WINDOW_MS = 5000;

	return (msg: string, id: string) => {
		const now = new Date().toISOString();
		const nowMs = Date.now();
		const trimmed = msg.trim();

		// Duplicate suppression: skip identical consecutive messages within window
		const prev = lastMsg.get(id);
		if (prev && prev.text === trimmed && nowMs - prev.ts < DEDUP_WINDOW_MS) {
			prev.count++;
			prev.ts = nowMs;
			return;
		}

		// Flush pending repeat count from previous message before moving on
		if (prev && prev.count > 1) {
			const repeatNote = `  [repeated x${prev.count}]`;
			const lastStep = deploySteps.find(s => s.id === id);
			if (lastStep) lastStep.logs.push(repeatNote);
			broadcast?.(id, repeatNote);
		}
		lastMsg.set(id, { text: trimmed, count: 1, ts: nowMs });

		let stepIndex = deploySteps.findIndex(s => s.id === id);
		if (stepIndex === -1) {
			deploySteps.push({ id, label: msg, logs: [msg], status: 'in_progress', startedAt: now });
			stepIndex = deploySteps.length - 1;
		} else {
			deploySteps[stepIndex].logs.push(msg);
			if (msg.startsWith('✅')) {
				deploySteps[stepIndex].status = 'success';
				deploySteps[stepIndex].endedAt = now;
			} else if (msg.startsWith('❌')) {
				deploySteps[stepIndex].status = 'error';
				deploySteps[stepIndex].endedAt = now;
			}
		}

		onStepsChange?.(deploySteps);
		broadcast?.(id, msg);
	};
}
