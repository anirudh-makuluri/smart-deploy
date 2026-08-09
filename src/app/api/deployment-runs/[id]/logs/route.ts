import { NextRequest, NextResponse } from "next/server";
import { dbHelper } from "@/db-helper";
import {
	deployStepsFromLogLines,
	fetchDeployRunLogsFromS3,
	type DeployStepSummary,
} from "@/lib/aws/deployRunLogs";
import { getRequestUserId } from "@/lib/requestUser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
	req: NextRequest,
	context: { params: Promise<{ id: string }> }
) {
	try {
		const userID = await getRequestUserId(req.headers);
		if (!userID) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const { id } = await context.params;
		const runId = String(id ?? "").trim();
		if (!runId) {
			return NextResponse.json({ error: "Run id is required" }, { status: 400 });
		}

		const entryResponse = await dbHelper.getDeploymentHistoryEntryById(runId, userID);
		if (entryResponse.error) {
			return NextResponse.json({ error: String(entryResponse.error) }, { status: 500 });
		}
		const entry = entryResponse.history;
		if (!entry) {
			return NextResponse.json({ error: "Deployment run not found" }, { status: 404 });
		}

		if (!entry.logRef) {
			const runResponse = await dbHelper.getDeploymentRunSystem(runId);
			return NextResponse.json({
				steps: entry.steps,
				completed: runResponse.run?.status === "completed",
			});
		}

		const lines = await fetchDeployRunLogsFromS3({ logRef: entry.logRef });
		const stepSummary: DeployStepSummary[] = entry.steps.map((step) => ({
			id: step.id,
			label: step.label,
			status: step.status,
			...(step.startedAt ? { startedAt: step.startedAt } : {}),
			...(step.endedAt ? { endedAt: step.endedAt } : {}),
			lineCount: step.logs?.length ?? 0,
		}));
		const steps = deployStepsFromLogLines(stepSummary, lines);

		const runResponse = await dbHelper.getDeploymentRunSystem(runId);
		return NextResponse.json({
			steps,
			completed: runResponse.run?.status === "completed",
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
