import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseServerMock = vi.fn();

vi.mock("@/lib/supabaseServer", () => ({
	getSupabaseServer: () => getSupabaseServerMock(),
}));

describe("getLastSuccessfulDeploymentHistory", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("queries the newest successful history row for a user service", async () => {
		const chain: any = {};
		chain.select = vi.fn(() => chain);
		chain.eq = vi.fn(() => chain);
		chain.order = vi.fn(() => chain);
		chain.limit = vi.fn(() => chain);
		chain.maybeSingle = vi.fn().mockResolvedValue({
			data: {
				id: "hist-1",
				user_id: "user-1",
				repo_name: "shop",
				service_name: "web",
				timestamp: "2026-06-01T00:00:00.000Z",
				success: true,
				steps: [],
				config_snapshot: {},
				release_artifact: { kind: "ec2_config", deployConfig: {} },
				commit_sha: "abcdef123456",
				branch: "main",
				duration_ms: 1000,
			},
			error: null,
		});
		const from = vi.fn(() => chain);
		getSupabaseServerMock.mockReturnValue({ from });

		const { dbHelper } = await import("@/db-helper");
		const result = await dbHelper.getLastSuccessfulDeploymentHistory("shop", "web", "user-1");

		expect(from).toHaveBeenCalledWith("deployment_history");
		expect(chain.select).toHaveBeenCalledWith("*");
		expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
		expect(chain.eq).toHaveBeenCalledWith("repo_name", "shop");
		expect(chain.eq).toHaveBeenCalledWith("service_name", "web");
		expect(chain.eq).toHaveBeenCalledWith("success", true);
		expect(chain.order).toHaveBeenCalledWith("timestamp", { ascending: false });
		expect(chain.limit).toHaveBeenCalledWith(1);
		expect(result.history?.releaseArtifact).toEqual({ kind: "ec2_config", deployConfig: {} });
	});

	it("fetches a specific history entry by ID for the current user", async () => {
		const chain: any = {};
		chain.select = vi.fn(() => chain);
		chain.eq = vi.fn(() => chain);
		chain.maybeSingle = vi.fn().mockResolvedValue({
			data: {
				id: "hist-2",
				user_id: "user-1",
				repo_name: "shop",
				service_name: "web",
				timestamp: "2026-06-01T00:00:00.000Z",
				success: true,
				steps: [],
				config_snapshot: {},
				release_artifact: { kind: "ecr_image", deployConfig: {} },
			},
			error: null,
		});
		const from = vi.fn(() => chain);
		getSupabaseServerMock.mockReturnValue({ from });

		const { dbHelper } = await import("@/db-helper");
		const result = await dbHelper.getDeploymentHistoryEntryById("hist-2", "user-1");

		expect(from).toHaveBeenCalledWith("deployment_history");
		expect(chain.select).toHaveBeenCalledWith("*");
		expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
		expect(chain.eq).toHaveBeenCalledWith("id", "hist-2");
		expect(result.history?.id).toBe("hist-2");
	});
});
