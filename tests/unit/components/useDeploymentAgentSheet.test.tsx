import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDeploymentAgentSheet } from "@/components/deployment-agent-sheet/useDeploymentAgentSheet";
import { EMPTY_AGENT_STRUCTURED_DATA } from "@/lib/deploymentAgent/structuredData";

const runAgentMock = vi.fn(() => ({ ok: true as const }));

let latestAgentEvent:
	| {
			kind: "complete";
			payload: {
				runId: string;
				message: string;
				docCitations: [];
				structuredData: typeof EMPTY_AGENT_STRUCTURED_DATA;
			};
	  }
	| null = null;

vi.mock("@/components/WorkerWebSocketProvider", () => ({
	useWorkerWebSocket: () => ({
		latestAgentEvent,
		runAgent: runAgentMock,
		socketStatus: "open",
	}),
}));

function Harness() {
	const { state, dispatch, inputRef, askDeploymentAgent } = useDeploymentAgentSheet();

	return (
		<div>
			<textarea
				ref={inputRef}
				value={state.input}
				onChange={(event) => dispatch({ type: "set_input", value: event.target.value })}
				disabled={state.pending}
			/>
			<button type="button" onClick={() => askDeploymentAgent("Show me my deployments")}>
				Ask
			</button>
		</div>
	);
}

describe("useDeploymentAgentSheet", () => {
	beforeEach(() => {
		latestAgentEvent = null;
		runAgentMock.mockClear();
	});

	it("returns focus to the textarea after the agent completes", async () => {
		const view = render(<Harness />);

		fireEvent.click(screen.getByRole("button", { name: "Ask" }));

		const textarea = screen.getByRole("textbox");
		expect(textarea).toBeDisabled();

		screen.getByRole("button", { name: "Ask" }).focus();
		expect(screen.getByRole("button", { name: "Ask" })).toHaveFocus();

		await act(async () => {
			latestAgentEvent = {
				kind: "complete",
				payload: {
					runId: "run-1",
					message: "You have 2 active deployments.",
					docCitations: [],
					structuredData: EMPTY_AGENT_STRUCTURED_DATA,
				},
			};
			view.rerender(<Harness />);
		});

		expect(textarea).not.toBeDisabled();
		expect(textarea).toHaveFocus();
	});
});
