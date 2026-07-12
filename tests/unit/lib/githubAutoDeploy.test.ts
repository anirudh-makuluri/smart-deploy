import { describe, expect, it, vi } from "vitest";

import { queueGithubPushDeployments } from "@/lib/githubAutoDeploy";
import { makeDeployment } from "../helpers/deployConfigFixture";

const commitSha = "b".repeat(40);

function makeDb() {
	return {
		getLiveDeploymentsForGithubPush: vi.fn().mockResolvedValue({
			deployments: [{ userId: "user-1", deployment: makeDeployment({ status: "running" }) }],
		}),
		createAndReserveGithubPushDeployment: vi.fn().mockResolvedValue({ reserved: true }),
		updateGithubPushDeploymentState: vi.fn().mockResolvedValue({}),
		finalizeDeploymentRun: vi.fn().mockResolvedValue({}),
	};
}

describe("GitHub push deployment queue", () => {
	it("queues a live main deployment for the pushed commit using the installation context", async () => {
		const db = makeDb();
		const enqueue = vi.fn().mockResolvedValue(undefined);

		const result = await queueGithubPushDeployments({
			installationId: 42,
			repositoryId: 99,
			fullName: "acme/shop",
			repositoryUrl: "https://github.com/acme/shop",
			branch: "main",
			commitSha,
		}, { db, enqueue, createRunId: () => "run-1" });

		expect(result).toEqual({ queuedRuns: 1, skippedDeployments: 0 });
		expect(db.createAndReserveGithubPushDeployment).toHaveBeenCalledWith({
			userId: "user-1",
			repoName: "shop",
			serviceName: "web",
			runId: "run-1",
			commitSha,
			branch: "main",
			responseId: null,
			releaseArtifact: expect.objectContaining({
				githubApp: { installationId: 42, repositoryId: 99 },
				deployConfig: expect.objectContaining({ commitSha, branch: "main", status: "deploying" }),
			}),
		});
		expect(enqueue).toHaveBeenCalledWith({
			runId: "run-1",
			userId: "user-1",
			repoName: "shop",
			serviceName: "web",
		});
	});

	it("skips a deployment that was reserved by another trigger", async () => {
		const db = makeDb();
		db.createAndReserveGithubPushDeployment.mockResolvedValue({ reserved: false });
		const enqueue = vi.fn();

		const result = await queueGithubPushDeployments({
			installationId: 42,
			repositoryId: 99,
			fullName: "acme/shop",
			repositoryUrl: "https://github.com/acme/shop",
			branch: "main",
			commitSha,
		}, { db, enqueue, createRunId: () => "run-1" });

		expect(result).toEqual({ queuedRuns: 0, skippedDeployments: 1 });
		expect(enqueue).not.toHaveBeenCalled();
	});
});
