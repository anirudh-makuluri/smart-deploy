import { describe, expect, it } from "vitest";
import { __testing } from "@/lib/aws/codebuildHelpers";

describe("routeCodeBuildLogMessage", () => {
	it("switches to publish when push markers appear", () => {
		const afterBuild = __testing.routeCodeBuildLogMessage("SMARTDEPLOY_PHASE:build:end", "build");
		expect(afterBuild.nextStep).toBe("publish");
		expect(afterBuild.line).toBeUndefined();

		const pushed = __testing.routeCodeBuildLogMessage("docker push 123.dkr.ecr.us-west-2.amazonaws.com/app:abc123", "build");
		expect(pushed.stepId).toBe("publish");
		expect(pushed.line).toContain("docker push");
	});

	it("routes buildx push/export signals to publish", () => {
		const line = "#24 exporting to image";
		const routed = __testing.routeCodeBuildLogMessage(line, "build");
		expect(routed.stepId).toBe("publish");
		expect(routed.nextStep).toBe("publish");
	});
});
