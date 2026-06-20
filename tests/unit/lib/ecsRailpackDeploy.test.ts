import { describe, expect, it } from "vitest";
import { __testing } from "@/lib/aws/ecsRailpackDeploy";

describe("ecsRailpackDeploy rollout helpers", () => {
	it("treats rollout as complete only when the new primary deployment is stable", () => {
		expect(
			__testing.isServiceRolloutComplete(
				{
					desiredCount: 1,
					runningCount: 1,
					pendingCount: 0,
					deployments: [
						{
							status: "PRIMARY",
							taskDefinition: "td:new",
							rolloutState: "COMPLETED",
						},
					],
				} as any,
				"td:new"
			)
		).toBe(true);

		expect(
			__testing.isServiceRolloutComplete(
				{
					desiredCount: 1,
					runningCount: 0,
					pendingCount: 1,
					deployments: [
						{
							status: "PRIMARY",
							taskDefinition: "td:new",
							rolloutState: "IN_PROGRESS",
						},
					],
				} as any,
				"td:new"
			)
		).toBe(false);
	});

	it("includes stopped task reasons in transition lines", () => {
		const lines = __testing.buildTaskTransitionLines({
			taskArn: "arn:aws:ecs:region:acct:task/cluster/1234567890abcdef",
			lastStatus: "STOPPED",
			desiredStatus: "STOPPED",
			stoppedReason: "CannotPullContainerError: pull image manifest has been retried 5 time(s)",
			containers: [
				{
					name: "app",
					lastStatus: "STOPPED",
					exitCode: 1,
					reason: "CannotPullContainerError: failed to resolve ref",
				},
			],
		} as any);

		expect(lines[0]).toContain("last=STOPPED");
		expect(lines[1]).toContain("stoppedReason=");
		expect(lines[2]).toContain("container=app");
		expect(lines[2]).toContain("reason=CannotPullContainerError");
	});
});
