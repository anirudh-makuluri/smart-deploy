import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

let deploymentsTable: Row[] = [];
let analysisResponsesTable: Row[] = [];

class FakeQueryBuilder {
	private filters: Record<string, unknown> = {};
	private op: "select" | "update" | "insert" | "upsert" | null = null;
	private payload: Row | null = null;

	constructor(private readonly table: "deployments" | "analysis_responses") {}

	select(_columns: string) {
		this.op = "select";
		return this;
	}

	update(payload: Row) {
		this.op = "update";
		this.payload = payload;
		return this;
	}

	insert(payload: Row) {
		this.op = "insert";
		this.payload = payload;
		return this;
	}

	upsert(payload: Row) {
		this.op = "upsert";
		this.payload = payload;
		return this;
	}

	eq(key: string, value: unknown) {
		this.filters[key] = value;
		return this;
	}

	order(_column: string, _opts?: { ascending?: boolean }) {
		return this;
	}

	limit(_count: number) {
		return this;
	}

	maybeSingle() {
		return this.execute(true);
	}

	then<TResult1 = unknown, TResult2 = never>(
		onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
		onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
	) {
		return this.execute(false).then(onfulfilled, onrejected);
	}

	private tableRows(): Row[] {
		return this.table === "deployments" ? deploymentsTable : analysisResponsesTable;
	}

	private matches(row: Row): boolean {
		return Object.entries(this.filters).every(([key, value]) => row[key] === value);
	}

	private async execute(single: boolean) {
		const rows = this.tableRows();
		switch (this.op) {
			case "select": {
				const matches = rows.filter((row) => this.matches(row));
				return {
					data: single ? (matches[0] ?? null) : matches,
					error: null,
				};
			}
			case "update": {
				for (const row of rows) {
					if (!this.matches(row)) continue;
					Object.assign(row, this.payload ?? {});
				}
				return { data: null, error: null };
			}
			case "insert": {
				rows.push({ ...(this.payload ?? {}) });
				return { data: null, error: null };
			}
			case "upsert": {
				const payload = { ...(this.payload ?? {}) };
				if (this.table === "analysis_responses") {
					const index = rows.findIndex((row) => row.id === payload.id);
					if (index >= 0) rows[index] = { ...rows[index], ...payload };
					else rows.push(payload);
				} else {
					rows.push(payload);
				}
				return { data: null, error: null };
			}
			default:
				return { data: null, error: null };
		}
	}
}

const getSupabaseServerMock = vi.fn(() => ({
	from: (table: "deployments" | "analysis_responses") => new FakeQueryBuilder(table),
}));

vi.mock("@/lib/supabaseServer", () => ({
	getSupabaseServer: getSupabaseServerMock,
}));

describe("dbHelper.updateDeployments partial updates", () => {
	beforeEach(() => {
		deploymentsTable = [
			{
				id: "dep-1",
				repo_name: "shop",
				service_name: "web",
				owner_id: "user-1",
				repo_url: "https://github.com/acme/shop",
				branch: "main",
				commit_sha: "abcdef123456",
				hosted_subdomain: null,
				screenshot_url: null,
				cloud_provider: "aws",
				deployment_target: "ecs",
				region: "us-west-2",
				status: "running",
				first_deployment: "2026-06-17T00:00:00.000Z",
				last_deployment: "2026-06-17T00:05:00.000Z",
				revision: 1,
				response_id: "resp-1",
				cloud_resources: {},
				secrets_arn: null,
			},
		];
		analysisResponsesTable = [];
		getSupabaseServerMock.mockClear();
	});

	it("preserves the existing status when a partial update omits status", async () => {
		const { dbHelper } = await import("@/db-helper");

		const result = await dbHelper.updateDeployments(
			{
				repoName: "shop",
				serviceName: "web",
				hostedSubdomain: "shop",
			} as never,
			"user-1"
		);

		expect(result.error).toBeUndefined();
		expect(deploymentsTable[0]?.status).toBe("running");
		expect(deploymentsTable[0]?.hosted_subdomain).toBe("shop");
	});

	it("still defaults new analysis-only rows to didnt_deploy", async () => {
		deploymentsTable = [];
		const { dbHelper } = await import("@/db-helper");

		const result = await dbHelper.updateDeployments(
			{
				repoName: "shop",
				serviceName: "web",
				repoUrl: "https://github.com/acme/shop",
				branch: "main",
				commitSha: "abcdef123456",
				responseId: "resp-2",
				scanResults: {
					response_id: "resp-2",
					commit_sha: "abcdef123456",
					package_path: ".",
					deploy_shape: "server",
					build_status: "passed",
					railpack_version: "0.1.0",
					workflow_version: "1",
					deploy_briefing: "API service",
					deploy_units: [],
					remote_builds: {},
					build_verification: {},
					repair_history: [],
					pipeline_trace: [],
					errors: [],
					llm_outputs: {},
					inputs_snapshot: {},
					token_usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
				},
			} as never,
			"user-1"
		);

		expect(result.error).toBeUndefined();
		expect(deploymentsTable[0]?.status).toBe("didnt_deploy");
		expect(typeof deploymentsTable[0]?.response_id).toBe("string");
		expect((deploymentsTable[0]?.response_id as string).length).toBeGreaterThan(0);
		expect(analysisResponsesTable[0]?.id).toBe(deploymentsTable[0]?.response_id);
	});
});
