import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeployLogsView from "@/components/deploy-workspace/DeployLogsView";
import type { DeployStep } from "@/app/types";

vi.mock("@/components/ServiceLogs", () => ({
	default: () => <div>ServiceLogs</div>,
}));

const baseSteps: DeployStep[] = [
	{
		id: "build",
		label: "Build",
		status: "error",
		logs: ["Error: missing DATABASE_URL"],
	},
];

const inProgressSteps: DeployStep[] = [
	{
		id: "prepare",
		label: "Prepare",
		status: "success",
		logs: [],
	},
	{
		id: "build",
		label: "Build",
		status: "in_progress",
		logs: [],
	},
	{
		id: "verify",
		label: "Verify",
		status: "pending",
		logs: [],
	},
];

describe("DeployLogsView", () => {
	beforeEach(() => {
		cleanup();
		vi.clearAllMocks();
		global.fetch = vi.fn();
	});

	it("shows queued status before the deployment worker begins processing", () => {
		render(
			<DeployLogsView
				isDeploymentLive={false}
				showDeployLogs={true}
				deployLogEntries={[]}
				serviceLogs={[]}
				deployStatus="queued"
			/>
		);

		expect(screen.getByText("Deployment queued")).toBeInTheDocument();
		expect(
			screen.getByText("Waiting for the deployment worker to begin processing")
		).toBeInTheDocument();
	});

	it("does not invent deployment progress when live steps are unavailable", () => {
		render(
			<DeployLogsView
				isDeploymentLive={false}
				showDeployLogs={true}
				deployLogEntries={[]}
				serviceLogs={[]}
				deployStatus="running"
			/>
		);

		expect(screen.getByText("Deployment is running")).toBeInTheDocument();
		expect(screen.queryByText(/Step \d+ of \d+/)).not.toBeInTheDocument();
	});

	it("shows the actual current step when live steps are available", () => {
		render(
			<DeployLogsView
				isDeploymentLive={false}
				showDeployLogs={true}
				deployLogEntries={[]}
				serviceLogs={[]}
				deployStatus="running"
				steps={inProgressSteps}
			/>
		);

		expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
	});

	it("renders root cause analysis after the logs action resolves", async () => {
		vi.mocked(global.fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ response: "The deploy failed because DATABASE_URL was missing." }),
		} as Response);

		render(
			<DeployLogsView
				isDeploymentLive={false}
				showDeployLogs={true}
				deployLogEntries={[{ message: "Error: missing DATABASE_URL" }]}
				serviceLogs={[]}
				deployStatus="error"
				deployError="Build failed"
				deploymentRunId="run-123"
				steps={baseSteps}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: /Explain root cause/i }));

		await waitFor(() => {
			expect(
				screen.getByText("The deploy failed because DATABASE_URL was missing.")
			).toBeInTheDocument();
		});
		expect(global.fetch).toHaveBeenCalledWith(
			"/api/llm/analyze-failure",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ runId: "run-123" }),
			})
		);
	});

	it("surfaces API errors in the logs panel", async () => {
		vi.mocked(global.fetch).mockResolvedValue({
			ok: false,
			json: async () => ({ error: "Unauthorized" }),
		} as Response);

		render(
			<DeployLogsView
				isDeploymentLive={false}
				showDeployLogs={true}
				deployLogEntries={[{ message: "Error: missing DATABASE_URL" }]}
				serviceLogs={[]}
				deployStatus="error"
				deployError="Build failed"
				deploymentRunId="run-123"
				steps={baseSteps}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: /Explain root cause/i }));

		await waitFor(() => {
			expect(screen.getByText("Unauthorized")).toBeInTheDocument();
		});
	});

	it("keeps the logs panel constrained to the workspace width", () => {
		const { container } = render(
			<DeployLogsView
				isDeploymentLive={false}
				showDeployLogs={true}
				deployLogEntries={[{ message: "A log message that should not resize the panel" }]}
				serviceLogs={[]}
				deployStatus="running"
			/>
		);

		const [view, logsPanel] = Array.from(container.querySelectorAll("div")).filter((element) =>
			element.className.includes("min-w-0")
		);

		expect(view).toHaveClass("w-full", "min-w-0");
		expect(logsPanel).toHaveClass("w-full", "min-w-0", "overflow-hidden");
	});
});
