import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { queueGithubPushDeployments } from "../../src/lib/githubAutoDeploy";
import { closeDbPool } from "../../src/lib/dbPool";
import { databaseTestConnectionString, resetFoundationDatabase } from "./helpers.mjs";

const connectionString = databaseTestConnectionString();
const client = new Client({ connectionString });
const push = {
	installationId: 42,
	repositoryId: 99,
	fullName: "acme/demo",
	repositoryUrl: "https://github.com/acme/demo",
	branch: "main",
	commitSha: "b".repeat(40),
};

beforeAll(async () => {
	vi.stubEnv("DATABASE_URL", connectionString);
	await client.connect();
});
afterAll(async () => {
	await closeDbPool();
	await client.end();
	vi.unstubAllEnvs();
});
beforeEach(async () => {
	await resetFoundationDatabase(client);
	await client.query(
		`insert into public.deployments(id,repo_name,service_name,owner_id,repo_url,branch,status)
		values ('queue-web','acme/demo','web','alice',$1,'main','running'),
		       ('queue-api','acme/demo','api','alice',$1,'main','running'),
		       ('queue-jobs','acme/demo','jobs','bob',$1,'main','running'),
		       ('queue-docs','acme/demo','docs','bob',$1,'main','running')`,
		[push.repositoryUrl],
	);
});

describe("GitHub dispatch with actual deployment reservation transactions", () => {
	it("reserves only two rows while dispatch is blocked, then finishes all owned releases", async () => {
		let release: () => void = () => {
			throw new Error("Gate not initialized");
		};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const enqueue = vi.fn(async () => {
			await gate;
		});
		const result = queueGithubPushDeployments(push, { enqueue });
		try {
			await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
			const pending = await client.query(
				"select count(*)::int as count from public.deployments where repo_name='acme/demo' and active_run_id is not null",
			);
			expect(pending.rows[0].count).toBe(2);
		} finally {
			release();
		}
		await expect(result).resolves.toEqual({ queuedRuns: 4, skippedDeployments: 0 });
		const runs =
			await client.query(`select d.owner_id,r.user_id,r.commit_sha,r.release_artifact from public.deployments d
			join public.deployment_runs r on r.id=d.active_run_id where d.repo_name='acme/demo'`);
		expect(runs.rows).toHaveLength(4);
		for (const row of runs.rows) {
			expect(row.user_id).toBe(row.owner_id);
			expect(row.commit_sha).toBe(push.commitSha);
			expect(row.release_artifact.githubApp).toEqual({ installationId: 42, repositoryId: 99 });
		}
	});

	it("does not create duplicate runs when the same push is delivered concurrently", async () => {
		const enqueue = vi.fn().mockResolvedValue(undefined);
		const results = await Promise.all([
			queueGithubPushDeployments(push, { enqueue }),
			queueGithubPushDeployments(push, { enqueue }),
		]);
		expect(results.reduce((sum, result) => sum + result.queuedRuns, 0)).toBe(4);
		expect(enqueue).toHaveBeenCalledTimes(4);
		const rows = await client.query(
			"select count(*)::int as count from public.deployment_runs where repo_name='acme/demo'",
		);
		expect(rows.rows[0].count).toBe(4);
	});
});
