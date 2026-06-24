import type { DeployStep } from "@/app/types";
import { uploadDeployRunLogs } from "@/lib/aws/deployRunLogs";
import { dbHelper } from "@/db-helper";

export type ActiveDeployRun = {
	runId: string;
	userId: string;
	region?: string;
	lastFlushedStepCount: number;
};

export function createDeployRunStepFlushHandler(run: ActiveDeployRun, getSteps: () => DeployStep[]) {
	return (steps: DeployStep[]) => {
		if (steps.length <= run.lastFlushedStepCount) return;
		run.lastFlushedStepCount = steps.length;
		void flushDeployRunProgress(run, getSteps());
	};
}

export async function flushDeployRunProgress(run: ActiveDeployRun, steps: DeployStep[]): Promise<void> {
	try {
		const uploaded = await uploadDeployRunLogs({
			userId: run.userId,
			runId: run.runId,
			steps,
			region: run.region,
		});
		if (!uploaded) return;

		await dbHelper.updateDeploymentRunProgress(run.runId, run.userId, {
			logRef: uploaded.logRef,
			stepSummary: uploaded.stepSummary,
			logTail: uploaded.logTail,
		});
	} catch (error) {
		console.error("flushDeployRunProgress error:", error);
	}
}

export async function startDeploymentRun(args: {
	userId: string;
	repoName: string;
	serviceName: string;
	branch?: string;
	commitSha?: string;
	responseId?: string | null;
	region?: string;
}): Promise<ActiveDeployRun | null> {
	const created = await dbHelper.createDeploymentRun(args);
	if (created.error || !created.runId) {
		console.error("startDeploymentRun error:", created.error);
		return null;
	}
	return {
		runId: created.runId,
		userId: args.userId,
		region: args.region,
		lastFlushedStepCount: 0,
	};
}
