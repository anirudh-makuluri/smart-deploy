import { describe, expect, it } from "vitest";
import { summarizeDeploymentHistoryPhase2 } from "@/lib/deploymentHistorySummary";

describe("summarizeDeploymentHistoryPhase2", () => {
	it("identifies monitoring-triggered remediation and health metadata", () => {
		const summary = summarizeDeploymentHistoryPhase2({
			id: "history-1",
			repo_name: "smart-deploy",
			service_name: "web",
			timestamp: new Date().toISOString(),
			success: true,
			steps: [],
			configSnapshot: {},
			healthChecks: [
				{
					id: "health-1",
					repo_name: "smart-deploy",
					service_name: "web",
					url: "https://example.com",
					status: "healthy",
					checked_at: new Date().toISOString(),
				},
				{
					id: "health-2",
					repo_name: "smart-deploy",
					service_name: "web",
					url: "https://example.com",
					status: "timeout",
					failure_type: "timeout",
					error_message: "Request timed out",
					checked_at: new Date().toISOString(),
				},
			],
			remediationAttempts: [
				{
					id: "attempt-1",
					repo_name: "smart-deploy",
					service_name: "web",
					attempt_number: 1,
					trigger_type: "post_deploy_unhealthy",
					summary: "Retry after monitoring timeout",
					status: "proposed",
					created_at: new Date().toISOString(),
				},
			],
		} as any);

		expect(summary.primaryLabel).toBe("Monitoring detected a runtime issue");
		expect(summary.latestHealthCheck?.status).toBe("timeout");
		expect(summary.badges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: "2 health checks" }),
				expect.objectContaining({ label: "1 remediation attempt" }),
			])
		);
	});

	it("surfaces retry rejection and exhaustion distinctly", () => {
		const summary = summarizeDeploymentHistoryPhase2({
			id: "history-2",
			repo_name: "smart-deploy",
			service_name: "web",
			timestamp: new Date().toISOString(),
			success: false,
			steps: [
				{
					id: "done",
					label: "Done",
					status: "error",
					logs: ["Remediation retry limit reached (2)."],
				},
			],
			configSnapshot: {},
			remediationAttempts: [
				{
					id: "attempt-1",
					repo_name: "smart-deploy",
					service_name: "web",
					attempt_number: 1,
					trigger_type: "deploy_failure",
					summary: "User rejected retry",
					status: "rejected",
					created_at: new Date().toISOString(),
				},
			],
		} as any);

		expect(summary.primaryLabel).toBe("Retry rejected by user");
		expect(summary.retryExhausted).toBe(true);
		expect(summary.badges).toEqual(
			expect.arrayContaining([expect.objectContaining({ label: "Retry limit reached", tone: "danger" })])
		);
	});
});
