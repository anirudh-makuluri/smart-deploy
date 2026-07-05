import { dbHelper } from "@/db-helper";
import { launchDeploymentWorkerTask } from "@/lib/aws/deploymentWorkerTask";
import {
	emitToWorkerDeploymentRoom,
	emitToWorkerUserRoom,
} from "@/lib/workerSocketServer";
import {
	type DeploymentStatusChangedPayload,
	WORKER_SOCKET_SERVER_EVENTS,
} from "@/lib/workerSocketEvents";

export type DeploymentQueueMessage = {
	runId: string;
	userId: string;
	repoName: string;
	serviceName: string;
};

export function parseDeploymentQueueMessage(body: string | undefined): DeploymentQueueMessage {
	const parsed = JSON.parse(body || "{}") as Partial<DeploymentQueueMessage>;
	if (!parsed.runId || !parsed.userId || !parsed.repoName || !parsed.serviceName) {
		throw new Error("Deployment queue message is missing required fields.");
	}
	return {
		runId: parsed.runId,
		userId: parsed.userId,
		repoName: parsed.repoName,
		serviceName: parsed.serviceName,
	};
}

function emitDeploymentStatusChanged(payload: DeploymentStatusChangedPayload): void {
	emitToWorkerUserRoom(payload.ownerID, WORKER_SOCKET_SERVER_EVENTS.deploymentStatusChanged, payload);
	emitToWorkerDeploymentRoom(
		payload.ownerID,
		payload.repoName,
		payload.serviceName,
		WORKER_SOCKET_SERVER_EVENTS.deploymentStatusChanged,
		payload
	);
}

export async function processDeploymentQueueMessage(body: string | undefined): Promise<void> {
	const message = parseDeploymentQueueMessage(body);
	const runResponse = await dbHelper.getDeploymentRunSystem(message.runId);
	if (runResponse.error) {
		throw new Error(
			typeof runResponse.error === "string"
				? runResponse.error
				: "Failed to load deployment run."
		);
	}

	const run = runResponse.run;
	if (!run) {
		return;
	}

	if (run.status === "completed" || (run.status === "deploying" && run.workerTaskArn)) {
		return;
	}

	const startedAtExecutor = new Date().toISOString();
	await dbHelper.updateDeploymentRunSystem({
		runId: run.id,
		userId: run.userId,
		status: "deploying",
		startedAtExecutor,
		workerTaskArn: null,
	});
	await dbHelper.updateDeploymentSystem({
		repoName: run.repoName,
		serviceName: run.serviceName,
		status: "deploying",
		activeRunId: run.id,
	});
	emitDeploymentStatusChanged({
		ownerID: run.userId,
		repoName: run.repoName,
		serviceName: run.serviceName,
		status: "deploying",
	});

	try {
		const launched = await launchDeploymentWorkerTask({
			runId: run.id,
			userId: run.userId,
		});
		await dbHelper.updateDeploymentRunSystem({
			runId: run.id,
			userId: run.userId,
			workerTaskArn: launched.taskArn,
		});
		console.log(`Launced worker task arn: ${launched.taskArn}`);
	} catch (error) {
		await dbHelper.updateDeploymentRunSystem({
			runId: run.id,
			userId: run.userId,
			status: "queued",
			startedAtExecutor: null,
			workerTaskArn: null,
		});
		await dbHelper.updateDeploymentSystem({
			repoName: run.repoName,
			serviceName: run.serviceName,
			status: "deploying",
			activeRunId: run.id,
		});
		throw error;
	}
}
