import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressWorkflowChain } from "@/components/progress/ProgressWorkflowChain";
import { FeedbackStreamPanel } from "@/components/feedback-progress/FeedbackStreamPanel";
import { ScanProgressLogsPanel } from "@/components/scan-progress/ScanProgressLogsPanel";

const nodes = [
	{ id: "fetch", label: "Fetch", desc: "Get repository" },
	{ id: "build", label: "Build", desc: "Compile app" },
];

describe("progress displays", () => {
	it("keeps completed, active and failed workflow states distinct", () => {
		const view = render(
			<ProgressWorkflowChain nodes={nodes} completedNodes={["fetch"]} activeNode="build" failedNode={null} />,
		);
		expect(screen.getByText("Done")).toBeInTheDocument();
		expect(screen.getByText("Build")).toHaveClass("text-primary");
		view.rerender(
			<ProgressWorkflowChain
				nodes={nodes}
				completedNodes={["fetch"]}
				activeNode="build"
				failedNode="build"
			/>,
		);
		expect(screen.getByText("Build")).not.toHaveClass("text-primary");
		expect(screen.getByText("Build").closest('[data-slot="card"]')).toHaveClass("bg-destructive/10");
		expect(screen.getAllByText("Done")).toHaveLength(1);
	});

	it.each([FeedbackStreamPanel, ScanProgressLogsPanel])(
		"updates progress and keeps stream output visible",
		(Panel) => {
			const logsEndRef = React.createRef<HTMLDivElement>();
			const view = render(
				<Panel logs={["info: fetched", "error: failed"]} progress={25} logsEndRef={logsEndRef} />,
			);
			expect(screen.getByText("25%")).toBeInTheDocument();
			expect(screen.getByText("error: failed")).toHaveClass("text-red-400");
			expect(logsEndRef.current).toBeInTheDocument();
			view.rerender(<Panel logs={["info: retried"]} progress={100} logsEndRef={logsEndRef} />);
			expect(screen.queryByText("error: failed")).not.toBeInTheDocument();
			expect(screen.getByText("100%")).toBeInTheDocument();
			expect(view.container.querySelector('[style="width: 100%;"]')).toBeInTheDocument();
		},
	);
});
