import { describe, expect, it } from "vitest";
import type { DeployStep } from "@/app/types";
import { prioritizeDiagnosticsLogs } from "@/app/api/llm/analyze-failure/route";

describe("prioritizeDiagnosticsLogs", () => {
	it("moves latest docker diagnostics block to the front for prompt context", () => {
		const steps: DeployStep[] = [
			{
				id: "deploy",
				label: "Deploy",
				status: "error",
				logs: [
					"build failed",
					"diagnostics:docker_logs:start container=smartdeploy-app tail=300",
					"node:internal/modules/cjs/loader:1210",
					"ERR_PNPM_NO_SCRIPT_OR_SERVER",
					"diagnostics:docker_logs:end",
					"diagnostics:curl:start",
					"curl 000",
					"diagnostics:curl:end",
				],
			},
			{
				id: "done",
				label: "Done",
				status: "error",
				logs: ["deployment failed"],
			},
		];

		const ordered = prioritizeDiagnosticsLogs(steps);
		expect(ordered[0]?.id).toBe("deploy");
		expect(ordered[0]?.logs[0]).toContain("diagnostics:docker_logs:start");
		expect(ordered[0]?.logs[1]).toContain("node:internal/modules/cjs/loader:1210");
		expect(ordered[0]?.logs[2]).toContain("ERR_PNPM_NO_SCRIPT_OR_SERVER");
	});
});
