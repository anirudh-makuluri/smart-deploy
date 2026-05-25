import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import RemediationPlanCard from "@/components/deploy-workspace/RemediationPlanCard";

describe("RemediationPlanCard", () => {
	it("renders remediation details and opens the diff preview", async () => {
		const user = userEvent.setup();
		render(
			<RemediationPlanCard
				attempt={{
					id: "attempt-1",
					repo_name: "smart-deploy",
					service_name: "web",
					attempt_number: 1,
					trigger_type: "deploy_failure",
					summary: "Fix nginx upstream and retry deployment.",
					root_cause: "nginx upstream mismatch",
					evidence: ["nginx returned 502"],
					changes: [
						{
							title: "Align nginx upstream port",
							description: "Update nginx upstream references to use port 8080.",
							target: "nginx.conf",
						},
					],
					diff_preview: [{ target: "artifact:nginx.conf", summary: "Update nginx", before: "3000", after: "8080" }],
					status: "proposed",
					created_at: new Date().toISOString(),
				} as any}
				onApprove={vi.fn()}
				onReject={vi.fn()}
			/>
		);

		expect(screen.getByText("Proposed recovery plan")).toBeInTheDocument();
		expect(screen.getByText("Fix nginx upstream and retry deployment.")).toBeInTheDocument();
		expect(screen.getByText("Retry attempt 1")).toBeInTheDocument();
		expect(screen.getByText("Align nginx upstream port")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Review diff" }));
		expect(screen.getByText("Recovery diff")).toBeInTheDocument();
		expect(screen.getByText("artifact:nginx.conf")).toBeInTheDocument();
	});
});
