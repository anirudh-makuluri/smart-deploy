import { DeployStep } from "../app/types";

/**
 * Creates a simple WebSocket logger function that sends messages to the client
 * @param ws - WebSocket connection
 * @returns A send function that logs messages to the WebSocket
 */
export function createWebSocketLogger(ws: any) {
	return (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};
}

/**
 * Creates a WebSocket logger function that also tracks deployment steps
 * @param ws - WebSocket connection
 * @param deploySteps - Array of deployment steps to track
 * @returns A send function that logs messages and tracks step status
 */
export function createDeployStepsLogger(ws: any, deploySteps: DeployStep[]) {
	return (msg: string, id: string) => {
		// Track step status
		let stepIndex = deploySteps.findIndex(s => s.id === id);
		if (stepIndex === -1) {
			deploySteps.push({ id, label: msg, logs: [msg], status: 'in_progress' });
			stepIndex = deploySteps.length - 1;
		} else {
			deploySteps[stepIndex].logs.push(msg);
			if (msg.startsWith('✅')) {
				deploySteps[stepIndex].status = 'success';
			} else if (msg.startsWith('❌')) {
				deploySteps[stepIndex].status = 'error';
			}
		}
		
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};
}
