import { describe, expect, it } from "vitest";
import { AGENT_TOOL_NAME_TUPLE, deploymentAgentTools, listDeploymentAgentTools } from "@/lib/deploymentAgent/registry";
import type { AgentToolDefinition } from "@/lib/deploymentAgent/types";

describe("deploymentAgent registry", () => {
	it("registers every expected tool once", () => {
		expect(AGENT_TOOL_NAME_TUPLE).toEqual([
			"list_deployments",
			"get_deployment_details",
			"get_deployment_history",
			"get_runtime_health",
			"search_docs",
		]);
		expect(listDeploymentAgentTools()).toHaveLength(5);
	});

	it("keeps registry keys aligned with tool names", () => {
		for (const tool of listDeploymentAgentTools()) {
			expect(deploymentAgentTools[tool.name as keyof typeof deploymentAgentTools]).toBe(tool);
		}
	});

	it("requires complete metadata for each tool", () => {
		const requiredFields: Array<keyof AgentToolDefinition> = [
			"name",
			"description",
			"whenToUse",
			"argumentDescription",
			"argsSchema",
			"execute",
			"startedMessage",
			"completedMessage",
		];

		for (const tool of listDeploymentAgentTools()) {
			for (const field of requiredFields) {
				expect(tool[field]).toBeTruthy();
			}
		}
	});
});