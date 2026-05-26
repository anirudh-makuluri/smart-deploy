import { describe, expect, it } from "vitest";
import type { DeployStep } from "@/app/types";
import { createDeployStepsLogger } from "@/lib/websocketLogger";

function makeStep(id: string): DeployStep {
	return {
		id,
		label: id,
		logs: [],
		status: "pending",
	};
}

describe("createDeployStepsLogger", () => {
	it("marks success for legacy checkmark-prefixed logs", () => {
		const steps = [makeStep("deploy")];
		const logger = createDeployStepsLogger(null, steps);

		logger("✅ Deployment complete", "deploy");

		expect(steps[0].status).toBe("success");
	});

	it("marks error for legacy cross-prefixed and failed-prefixed logs", () => {
		const steps = [makeStep("deploy"), makeStep("verify")];
		const logger = createDeployStepsLogger(null, steps);

		logger("❌ Deployment failed", "deploy");
		logger("Failed: verification timed out", "verify");

		expect(steps[0].status).toBe("error");
		expect(steps[1].status).toBe("error");
	});
});
