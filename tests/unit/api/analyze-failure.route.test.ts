import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeployStep, DeploymentHistoryEntry } from "@/app/types";

const getSessionMock = vi.fn();
const headersMock = vi.fn();
const getDeploymentHistoryEntryByIdMock = vi.fn();
const fetchDeployRunLogsFromS3Mock = vi.fn();
const callLLMWithFallbackMock = vi.fn();

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

vi.mock("next/headers", () => ({
	headers: (...args: unknown[]) => headersMock(...args),
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getDeploymentHistoryEntryById: (...args: unknown[]) =>
			getDeploymentHistoryEntryByIdMock(...args),
	},
}));

vi.mock("@/lib/aws/deployRunLogs", async () => {
	const actual = await vi.importActual<typeof import("@/lib/aws/deployRunLogs")>(
		"@/lib/aws/deployRunLogs"
	);
	return {
		...actual,
		fetchDeployRunLogsFromS3: (...args: unknown[]) => fetchDeployRunLogsFromS3Mock(...args),
	};
});

vi.mock("@/lib/llmProviders", () => ({
	callLLMWithFallback: (...args: unknown[]) => callLLMWithFallbackMock(...args),
}));

describe("POST /api/llm/analyze-failure", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		headersMock.mockResolvedValue(new Headers());
	});

	it("returns 401 when session user is missing", async () => {
		getSessionMock.mockResolvedValue(null);
		const { POST } = await import("@/app/api/llm/analyze-failure/route");

		const res = await POST(
			new Request("http://localhost/api/llm/analyze-failure", {
				method: "POST",
				body: JSON.stringify({ runId: "run-1" }),
			})
		);

		expect(res.status).toBe(401);
	});

	it("returns 400 when runId is missing", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
		const { POST } = await import("@/app/api/llm/analyze-failure/route");

		const res = await POST(
			new Request("http://localhost/api/llm/analyze-failure", {
				method: "POST",
				body: JSON.stringify({}),
			})
		);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "runId is required" });
	});

	it("loads full run logs from storage before analyzing", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
		const entry: DeploymentHistoryEntry = {
			id: "run-1",
			repo_name: "smart-deploy",
			service_name: "web",
			timestamp: "2026-06-20T00:00:00.000Z",
			success: false,
			steps: [
				{
					id: "deploy",
					label: "Deploy",
					status: "error",
					logs: ["tail log only"],
				},
			],
			configSnapshot: {},
			failureCode: "DEPLOYMENT_FAILED_GENERIC",
			failureClassification: {
				stage: "deploy",
				category: "startup_failure",
				retryable: false,
				summary: "Container exited during startup.",
				likelyCause: "Required environment variables were missing.",
				evidence: ["missing DATABASE_URL"],
			},
			logRef: "deploy-runs/user-1/run-1/logs.jsonl",
		};
		getDeploymentHistoryEntryByIdMock.mockResolvedValue({ history: entry });
		fetchDeployRunLogsFromS3Mock.mockResolvedValue([
			{
				ts: "2026-06-20T00:00:01.000Z",
				step_id: "deploy",
				message: "full error line from S3",
			},
			{
				ts: "2026-06-20T00:00:02.000Z",
				step_id: "deploy",
				message: "diagnostics:docker_logs:start container=web tail=300",
			},
			{
				ts: "2026-06-20T00:00:03.000Z",
				step_id: "deploy",
				message: "Error: DATABASE_URL is not set",
			},
			{
				ts: "2026-06-20T00:00:04.000Z",
				step_id: "deploy",
				message: "diagnostics:docker_logs:end",
			},
		]);
		callLLMWithFallbackMock.mockResolvedValue({
			text: "DATABASE_URL is missing.",
			model: "llama3.2",
			provider: "local",
			token_usage: null,
		});

		const { POST } = await import("@/app/api/llm/analyze-failure/route");
		const res = await POST(
			new Request("http://localhost/api/llm/analyze-failure", {
				method: "POST",
				body: JSON.stringify({ runId: "run-1" }),
			})
		);

		expect(res.status).toBe(200);
		expect(getDeploymentHistoryEntryByIdMock).toHaveBeenCalledWith("run-1", "user-1");
		expect(fetchDeployRunLogsFromS3Mock).toHaveBeenCalledWith({
			logRef: "deploy-runs/user-1/run-1/logs.jsonl",
		});
		expect(callLLMWithFallbackMock).toHaveBeenCalledWith(
			expect.stringContaining("full error line from S3"),
			expect.objectContaining({ contextLabel: "Analyze failure" })
		);
		expect(callLLMWithFallbackMock).toHaveBeenCalledWith(
			expect.stringContaining("Failure code: DEPLOYMENT_FAILED_GENERIC"),
			expect.anything()
		);
		expect(await res.json()).toEqual(
			expect.objectContaining({
				response: "DATABASE_URL is missing.",
				source: "llm",
			})
		);
	});
});

describe("prioritizeDiagnosticsLogs", () => {
	it("moves latest docker diagnostics block to the front for prompt context", async () => {
		const { prioritizeDiagnosticsLogs } = await import("@/app/api/llm/analyze-failure/route");
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

	it("prioritizes ECS diagnostics blocks ahead of generic verify logs", async () => {
		const { prioritizeDiagnosticsLogs } = await import("@/app/api/llm/analyze-failure/route");
		const steps: DeployStep[] = [
			{
				id: "verify",
				label: "Verify",
				status: "error",
				logs: [
					"Verification round 10/10: probing 4 URL(s).",
					"ERROR: Deployment verification failed after all retry attempts.",
					"diagnostics:ecs_service:start cluster=smartdeploy service=sd-web",
					"[ecs:event] service sd-web registered 1 targets in target-group",
					"diagnostics:ecs_logs:start logGroup=/ecs/smartdeploy-railpack service=sd-web",
					"[ecs:log] Error: Cannot find native binding.",
					"[ecs:log] cause: Error: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found",
					"diagnostics:ecs_logs:end",
					"diagnostics:ecs_service:end",
				],
			},
		];

		const ordered = prioritizeDiagnosticsLogs(steps);
		expect(ordered[0]?.logs[0]).toContain("diagnostics:ecs_logs:start");
		expect(ordered[0]?.logs[1]).toContain("Cannot find native binding");
		expect(ordered[0]?.logs[2]).toContain("GLIBC_2.38");
	});
});
