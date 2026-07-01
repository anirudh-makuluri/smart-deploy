import { describe, expect, it } from "vitest";
import { buildStructuredDataFromToolResults } from "@/lib/deploymentAgent/buildStructuredData";
import type { ToolExecutionResult } from "@/lib/deploymentAgent/types";
import type { AgentToolName } from "@/lib/deploymentAgent/registry";

function toolResult(
	name: AgentToolName,
	result: unknown,
	args: Record<string, unknown> = {}
): ToolExecutionResult<AgentToolName> {
	return { name, arguments: args, result };
}

describe("buildStructuredDataFromToolResults", () => {
	it("maps list_deployments to a deployment_list block", () => {
		const data = buildStructuredDataFromToolResults([
			toolResult("list_deployments", {
				deployments: [
					{
						repoName: "smart-deploy",
						serviceName: "web",
						status: "running",
						branch: "main",
						deploymentTarget: "ecs",
						lastDeployment: "2026-06-20T00:00:00.000Z",
						hostedUrl: "https://web.example.com",
					},
				],
			}),
		]);

		expect(data.blocks).toHaveLength(1);
		expect(data.blocks[0]).toEqual({
			kind: "deployment_list",
			deployments: [
				expect.objectContaining({
					repoName: "smart-deploy",
					serviceName: "web",
					status: "running",
				}),
			],
		});
	});

	it("maps get_deployment_details to a deployment_details block", () => {
		const data = buildStructuredDataFromToolResults([
			toolResult(
				"get_deployment_details",
				{
					deployment: {
						repoName: "smart-deploy",
						serviceName: "web",
						status: "running",
						branch: "main",
						commitSha: "abc1234567890",
						revision: 3,
						deploymentTarget: "ecs",
						region: "us-west-2",
						hostedUrl: "https://web.example.com",
						lastDeployment: "2026-06-20T00:00:00.000Z",
						scanResults: {
							deployShape: "server",
							buildStatus: "passed",
							deployUnits: [
								{
									name: "web",
									type: "service",
									framework: "nextjs",
									provider: "railpack",
									port: 3000,
								},
							],
						},
					},
				},
				{ repoName: "smart-deploy", serviceName: "web" }
			),
		]);

		expect(data.blocks[0]?.kind).toBe("deployment_details");
		if (data.blocks[0]?.kind === "deployment_details") {
			expect(data.blocks[0].deployment.revision).toBe(3);
			expect(data.blocks[0].deployment.scanResults.deployUnits).toHaveLength(1);
		}
	});

	it("maps get_runtime_health with repo/service context", () => {
		const data = buildStructuredDataFromToolResults([
			toolResult(
				"get_runtime_health",
				{
					entries: [
						{
							checkedAt: "2026-06-20T00:00:00.000Z",
							appStatus: "healthy",
							httpStatus: 200,
							latencyMs: 42,
							ecsStatus: "ACTIVE",
							rolloutState: "COMPLETED",
							healthyTargets: 2,
							unhealthyTargets: 0,
						},
					],
				},
				{ repoName: "smart-deploy", serviceName: "web" }
			),
		]);

		expect(data.blocks[0]).toEqual({
			kind: "runtime_health",
			repoName: "smart-deploy",
			serviceName: "web",
			entries: [
				expect.objectContaining({
					appStatus: "healthy",
					latencyMs: 42,
				}),
			],
		});
	});

	it("maps get_deployment_history including failure metadata", () => {
		const data = buildStructuredDataFromToolResults([
			toolResult(
				"get_deployment_history",
				{
					history: [
						{
							id: "hist-1",
							timestamp: "2026-06-20T00:00:00.000Z",
							success: false,
							branch: "main",
							commitSha: "deadbeef",
							failedStep: "Build",
							failureSummary: "npm install failed",
							recentLogs: ["Error: exit code 1"],
						},
					],
				},
				{ repoName: "smart-deploy", serviceName: "web" }
			),
		]);

		expect(data.blocks[0]?.kind).toBe("deployment_history");
		if (data.blocks[0]?.kind === "deployment_history") {
			expect(data.blocks[0].history[0]?.failureSummary).toBe("npm install failed");
		}
	});

	it("ignores search_docs and empty tool results", () => {
		const data = buildStructuredDataFromToolResults([
			toolResult("search_docs", { matches: [] }, { query: "deploy" }),
			toolResult("list_deployments", { deployments: [] }),
		]);

		expect(data.blocks).toHaveLength(0);
	});
});
