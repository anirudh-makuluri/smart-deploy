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

describe("DeployLogsView", () => {
	beforeEach(() => {
		cleanup();
		vi.clearAllMocks();
		global.fetch = vi.fn();
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
				steps={baseSteps}
				configSnapshot={{ region: "us-west-2" }}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: /Explain root cause/i }));

		await waitFor(() => {
			expect(screen.getByText("Root cause analysis")).toBeInTheDocument();
		});
		expect(screen.getByText("The deploy failed because DATABASE_URL was missing.")).toBeInTheDocument();
		expect(global.fetch).toHaveBeenCalledWith(
			"/api/llm/analyze-failure",
			expect.objectContaining({
				method: "POST",
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
				steps={baseSteps}
				configSnapshot={{ region: "us-west-2" }}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: /Explain root cause/i }));

		await waitFor(() => {
			expect(screen.getByText("Unauthorized")).toBeInTheDocument();
		});
	});
});
