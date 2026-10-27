import { describe, expect, it } from "vitest";
import { pauseResumeDialog } from "@/components/deploy-workspace/deployWorkspaceState";

describe("pause/resume confirmation", () => {
	it("describes resuming a paused deployment, including the in-flight state", () => {
		expect(pauseResumeDialog("paused", false)).toMatchObject({
			pauseResumeDialogTitle: "Resume Deployment?",
			pauseResumeConfirmText: "Resume Deployment",
		});
		expect(pauseResumeDialog("paused", true).pauseResumeConfirmText).toBe("Resuming...");
	});

	it("describes pausing a running deployment, including the in-flight state", () => {
		expect(pauseResumeDialog("running", false)).toMatchObject({
			pauseResumeDialogTitle: "Pause Deployment?",
			pauseResumeConfirmText: "Pause Deployment",
		});
		expect(pauseResumeDialog("running", true).pauseResumeConfirmText).toBe("Pausing...");
	});
});
