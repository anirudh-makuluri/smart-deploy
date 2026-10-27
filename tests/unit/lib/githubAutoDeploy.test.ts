import { describe, expect, it, vi } from "vitest";

import { queueGithubPushDeployments } from "@/lib/githubAutoDeploy";
import { makeDeployment } from "../helpers/deployConfigFixture";

const commitSha = "b".repeat(40);
const push = {
	installationId: 42, repositoryId: 99, fullName: "acme/shop",
	repositoryUrl: "https://github.com/acme/shop", branch: "main", commitSha,
};

function completion() {
	let finish: () => void = () => { throw new Error("Promise not initialized"); };
	const promise = new Promise<void>(resolve => { finish = resolve; });
	return { promise, finish };
}

function manyDeployments() {
	return ["web", "api", "jobs", "docs"].map(serviceName => ({
		userId: "user-1", deployment: makeDeployment({ status: "running", serviceName }),
	}));
}

function makeDb() {
	return {
		getLiveDeploymentsForGithubPush: vi.fn().mockResolvedValue({
			deployments: [{ userId: "user-1", deployment: makeDeployment({ status: "running" }) }],
		}),
		createAndReserveGithubPushDeployment: vi.fn().mockResolvedValue({ reserved: true, error: undefined as string | undefined }),
		updateGithubPushDeploymentState: vi.fn().mockResolvedValue({}),
		finalizeDeploymentRun: vi.fn().mockResolvedValue({}),
	};
}

describe("GitHub push deployment queue", () => {
	it("bounds independent dispatch to two, then admits the next deployment when capacity is free", async () => {
		const db = makeDb();
		db.getLiveDeploymentsForGithubPush.mockResolvedValue({ deployments: manyDeployments() });
		const first = completion();
		const second = completion();
		const enqueue = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise).mockResolvedValue(undefined);
		const result = queueGithubPushDeployments(push, { db, enqueue });
		await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
		expect(db.createAndReserveGithubPushDeployment).toHaveBeenCalledTimes(2);
		first.finish();
		await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(4));
		second.finish();
		await expect(result).resolves.toEqual({ queuedRuns: 4, skippedDeployments: 0 });
		expect(db.finalizeDeploymentRun).not.toHaveBeenCalled();
	});

	it("stops new admission on queue failure, finalizes that run, and drains the other in-flight dispatch", async () => {
		const db = makeDb();
		db.getLiveDeploymentsForGithubPush.mockResolvedValue({ deployments: manyDeployments() });
		const other = completion();
		const enqueue = vi.fn().mockRejectedValueOnce(new Error("Queue unavailable")).mockImplementationOnce(() => other.promise);
		let settled = false;
		const result = queueGithubPushDeployments(push, { db, enqueue }).then(
			() => { settled = true; return null; }, error => { settled = true; return error as Error; },
		);
		await vi.waitFor(() => expect(db.updateGithubPushDeploymentState).toHaveBeenCalledTimes(1));
		expect(settled).toBe(false);
		expect(db.createAndReserveGithubPushDeployment).toHaveBeenCalledTimes(2);
		expect(db.finalizeDeploymentRun).toHaveBeenCalledWith(expect.objectContaining({ success: false, userId: "user-1" }));
		other.finish();
		expect((await result)?.message).toBe("Queue unavailable");
		expect(enqueue).toHaveBeenCalledTimes(2);
		expect(db.createAndReserveGithubPushDeployment).toHaveBeenCalledTimes(2);
	});

	it("rejects reservation errors without admitting later entries", async () => {
		const db = makeDb();
		db.getLiveDeploymentsForGithubPush.mockResolvedValue({ deployments: manyDeployments() });
		db.createAndReserveGithubPushDeployment.mockResolvedValue({ reserved: false, error: "Reservation unavailable" });
		const enqueue = vi.fn();
		await expect(queueGithubPushDeployments(push, { db, enqueue })).rejects.toThrow("Reservation unavailable");
		expect(db.createAndReserveGithubPushDeployment).toHaveBeenCalledTimes(2);
		expect(enqueue).not.toHaveBeenCalled();
	});

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
