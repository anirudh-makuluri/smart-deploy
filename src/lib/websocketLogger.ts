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
 * Optionally syncs steps to a store and broadcasts to other subscribed clients (for reconnect-after-refresh).
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
	return (msg: string, id: string) => {
		const now = new Date().toISOString();
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

		// if (ws && ws.readyState === ws.OPEN) {
		// 	const object = {
		// 		type: 'deploy_logs',
		// 		payload: { id, msg, time: now }
		// 	};
		// 	ws.send(JSON.stringify(object));
		// }
	};
}
