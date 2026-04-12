import { getSupabaseServer } from "./lib/supabaseServer";
import { DeployConfig, DeploymentHistoryEntry, repoType, DetectedServiceInfo, RepoServicesRecord } from "./app/types";
import { v4 as uuidv4 } from "uuid";

/**
 * Transform database row (snake_case) to DeployConfig (camelCase)
 */
function rowToDeployConfig(row: Record<string, unknown>): DeployConfig & { ownerID: string } {
	const {
		id,
		repo_name,
		service_name,
		owner_id,
		url,
		branch,
		commit_sha,
		env_vars,
		live_url,
		screenshot_url,
		cloud_provider,
		deployment_target,
		aws_region,
		status,
		first_deployment,
		last_deployment,
		revision,
		ec2,
		cloud_run,
		scan_results,
	} = row;

	return {
		id,
		repoName: repo_name || '',
		serviceName: service_name || '',
		ownerID: owner_id || '',
		url: url || '',
		branch: branch || '',
		commitSha: commit_sha ?? null,
		envVars: env_vars ?? undefined,
		liveUrl: live_url ?? null,
		screenshotUrl: screenshot_url ?? null,
		status: (status as DeployConfig["status"]) ?? "didnt_deploy",
		firstDeployment: first_deployment ?? null,
		lastDeployment: last_deployment ?? null,
		revision: revision ?? 0,
		cloudProvider: (cloud_provider as 'aws' | 'gcp') || 'aws',
		deploymentTarget: (deployment_target as 'ec2' | 'cloud_run') || 'ec2',
		awsRegion: aws_region || '',
		ec2: (ec2 as Record<string, unknown>) || {},
		cloudRun: (cloud_run as Record<string, unknown>) || {},
		scanResults: (scan_results || {}) as Record<string, unknown>,
	} as DeployConfig & { ownerID: string };
}

/**
 * Transform DeployConfig (camelCase) to database row (snake_case)
 */
function deployConfigToRow(config: DeployConfig): Record<string, unknown> {
	return {
		url: config.url,
		branch: config.branch,
		commit_sha: config.commitSha,
		env_vars: config.envVars,
		live_url: config.liveUrl,
		screenshot_url: config.screenshotUrl,
		cloud_provider: config.cloudProvider,
		deployment_target: config.deploymentTarget,
		aws_region: config.awsRegion,
		status: config.status,
		ec2: config.ec2,
		cloud_run: config.cloudRun,
		scan_results: config.scanResults,
	};
}

function normalizeRepoIdentifier(value: string): string {
	return value
		.trim()
		.replace(/\.git$/, "")
		.replace(/^https?:\/\//, "")
		.replace(/^github\.com\//, "")
		.replace(/\/$/, "")
		.toLowerCase();
}

function matchesRepoIdentifier(row: Record<string, unknown>, repoIdentifier: string): boolean {
	const target = normalizeRepoIdentifier(repoIdentifier);
	if (!target) return false;

	const rowUrl = normalizeRepoIdentifier(String(row.url ?? ""));
	const rowRepoName = normalizeRepoIdentifier(String(row.repo_name ?? ""));
	const rowUrlTail = rowUrl.split("/").slice(-2).join("/");

	return rowUrl === target || rowRepoName === target || rowUrlTail === target;
}

function repoSyncKey(row: { user_id: string; full_name?: string; repo_name?: string }): string {
	return `${row.user_id}::${String(row.full_name ?? row.repo_name ?? "")}`.toLowerCase();
}

function repoSyncSortValue(value: unknown): number {
	if (typeof value !== "string" || !value.trim()) return 0;
	const timestamp = new Date(value).getTime();
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

function dedupeRepoSyncRows(rows: Record<string, unknown>[]) {
	const deduped = new Map<string, Record<string, unknown>>();

	for (const row of rows) {
		const key = repoSyncKey({
			user_id: String(row.user_id ?? ""),
			full_name: String(row.full_name ?? ""),
			repo_name: String(row.repo_name ?? ""),
		});
		const existing = deduped.get(key);
		if (!existing) {
			deduped.set(key, row);
			continue;
		}

		const existingScore = Math.max(
			repoSyncSortValue(existing.pushed_at),
			repoSyncSortValue(existing.updated_at),
			repoSyncSortValue(existing.synced_at)
		);
		const nextScore = Math.max(
			repoSyncSortValue(row.pushed_at),
			repoSyncSortValue(row.updated_at),
			repoSyncSortValue(row.synced_at)
		);

		if (nextScore >= existingScore) {
			deduped.set(key, row);
		}
	}

	return Array.from(deduped.values());
}

export const dbHelper = {
	upsertUser: async function (
		userID: string,
		payload: { name?: string; image?: string }
	): Promise<{ error?: string }> {
		try {
			if (!userID) return { error: "userID not found" };
			const supabase = getSupabaseServer();

			const { error } = await supabase.from("users").upsert(
				{
					id: userID,
					name: (payload.name || "").trim() || null,
					image: (payload.image || "").trim() || null,
					created_at: new Date().toISOString(),
				},
				{ onConflict: "id" }
			);

			if (error) return { error: error.message };
			return {};
		} catch (err: unknown) {
			return { error: err instanceof Error ? err.message : String(err) };
		}
	},

	updateUser: async function (userID: string, data: object) {
		try {
			if (!userID) return { error: "userID not found" };
			if (typeof data !== "object" || data === null) return { message: "Invalid request" };

			const supabase = getSupabaseServer();
			const { data: user, error: fetchError } = await supabase
				.from("users")
				.select("id")
				.eq("id", userID)
				.single();

			if (fetchError || !user) return { error: "User doesnt exist" };

			const { error: updateError } = await supabase
				.from("users")
				.update(data as Record<string, unknown>)
				.eq("id", userID);

			if (updateError) return { error: updateError };
			console.log("User data updated successfully");
			return { success: "User data updated successfully" };
		} catch (error) {
			return { error };
		}
	},

	updateDeployments: async function (deployConfig: DeployConfig, userID: string) {
		try {
			const { repoName, serviceName } = deployConfig;
			if (!repoName || !serviceName) return { error: "repoName and serviceName are required" };

			const supabase = getSupabaseServer();

			if (deployConfig.status === "stopped") {
				await supabase.from("deployments").delete()
					.eq("repo_name", repoName)
					.eq("service_name", serviceName);
				return { success: "Deployment stopped and deleted" };
			}

			// Check if deployment exists
			const { data: existing, error: fetchError } = await supabase
				.from("deployments")
				.select("*")
				.eq("repo_name", repoName)
				.eq("service_name", serviceName)
				.order("last_deployment", { ascending: false })
				.limit(1)
				.maybeSingle();

			if (fetchError) return { error: fetchError.message };
			
			if (!existing) {
				// Create new deployment with provided data
				const insertPayload: Record<string, unknown> = {
					id: uuidv4(),
					repo_name: repoName,
					service_name: serviceName,
					owner_id: userID,
					first_deployment: new Date().toISOString(),
					last_deployment: new Date().toISOString(),
					revision: 1,
					...deployConfigToRow(deployConfig),
				};

				const { error: insertError } = await supabase.from("deployments").insert(insertPayload);
				if (insertError) return { error: insertError.message };
				return { success: "New deployment created and added to user" };
			}

			// Build update payload
			const updatePayload: Record<string, unknown> = {
				revision: (existing.revision ?? 0) + 1,
				...deployConfigToRow(deployConfig),
			};

			// Update last_deployment only if commitSha changes
			if (deployConfig.commitSha !== existing.commit_sha) {
				updatePayload.last_deployment = new Date().toISOString();
			}

			// Update first_deployment only if status changes from didnt_deploy to running
			if (existing.status === "didnt_deploy" && deployConfig.status === "running") {
				updatePayload.first_deployment = new Date().toISOString();
			}

			const { error: updateError } = await supabase
				.from("deployments")
				.update(updatePayload)
				.eq("repo_name", repoName)
				.eq("service_name", serviceName);

			if (updateError) return { error: updateError.message };
			return { success: "Deployment data updated successfully" };
		} catch (error) {
			console.error("updateDeployments error:", error);
			return { error };
		}
	},

	deleteDeploymentHistory: async function (repoName: string, serviceName: string) {
		const supabase = getSupabaseServer();
		await supabase.from("deployment_history").delete()
			.eq("repo_name", repoName)
			.eq("service_name", serviceName);
	},

	deleteDeployment: async function (repoName: string, serviceName: string, userID: string) {
		try {
			if (!repoName || !serviceName || !userID) return { error: "repoName, serviceName, and user ID are required" };

			const supabase = getSupabaseServer();

			const { data: deployment, error: fetchError } = await supabase
				.from("deployments")
				.select("id, owner_id")
				.eq("repo_name", repoName)
				.eq("service_name", serviceName)
				.order("last_deployment", { ascending: false })
				.limit(1)
				.maybeSingle();

			if (fetchError || !deployment) return { success: "Deployment already deleted or not found" };
			if (deployment.owner_id !== userID) return { error: "Unauthorized: deployment does not belong to user" };

			await supabase.from("deployments").delete()
				.eq("repo_name", repoName)
				.eq("service_name", serviceName);

			return { success: "Deployment deleted" };
		} catch (error) {
			console.error("deleteDeployment error:", error);
			return { error };
		}
	},

	getUserDeployments: async function (userID: string) {
		try {
			const supabase = getSupabaseServer();

			const { data: rows, error } = await supabase
				.from("deployments")
				.select("*")
				.eq("owner_id", userID);

			if (error) return { error: error.message };

		const deployments = (rows || []).map((row: Record<string, unknown>) => rowToDeployConfig(row));
			return { deployments };
		} catch (error) {
			console.error("getUserDeployments error:", error);
			return { error };
		}
	},

	getDeploymentsByRepo: async function (userID: string, repoIdentifier: string) {
		try {
			const supabase = getSupabaseServer();

			const { data: rows, error } = await supabase
				.from("deployments")
				.select("*")
				.eq("owner_id", userID);

			if (error) return { error: error.message };

			const deployments = (rows || [])
				.filter((row: Record<string, unknown>) => matchesRepoIdentifier(row, repoIdentifier))
				.map((row: Record<string, unknown>) => rowToDeployConfig(row));
			return { deployments };
		} catch (error) {
			console.error("getDeploymentsByRepo error:", error);
			return { error };
		}
	},

	deleteDeploymentsByRepo: async function (userID: string, repoIdentifier: string) {
		try {
			const { deployments, error } = await this.getDeploymentsByRepo(userID, repoIdentifier);
			if (error) return { error };
			const repoDeployments = deployments ?? [];
			if (repoDeployments.length === 0) return { deleted: 0 };

			for (const deployment of repoDeployments) {
				const result = await this.deleteDeployment(deployment.repoName, deployment.serviceName, userID);
				if (result.error) {
					return { error: typeof result.error === "string" ? result.error : String(result.error) };
				}
			}

			return { deleted: repoDeployments.length };
		} catch (error) {
			console.error("deleteDeploymentsByRepo error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	getDeployment: async function (repoName: string, serviceName: string): Promise<{ error?: string; deployment?: DeployConfig & { ownerID: string } }> {
		try {
			const supabase = getSupabaseServer();
			const { data: row, error } = await supabase
				.from("deployments")
				.select("*")
				.eq("repo_name", repoName)
				.eq("service_name", serviceName)
				.order("last_deployment", { ascending: false })
				.limit(1)
				.maybeSingle();

			if (error || !row) return { error: "Deployment not found" };
			return { deployment: rowToDeployConfig(row) };
		} catch (error) {
			console.error("getDeployment error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	syncUserRepos: async function (userID: string, repoList: repoType[]) {
		const supabase = getSupabaseServer();
		
		const rows = dedupeRepoSyncRows(repoList.map(repo => ({
			user_id: userID,
			repo_name: repo.full_name,
			id: repo.id,
			full_name: repo.full_name,
			repo_owner: repo.owner.login,
			html_url: repo.html_url,
			language: repo.language,
			languages_url: repo.languages_url,
			created_at: repo.created_at,
			updated_at: repo.updated_at,
			pushed_at: repo.pushed_at,
			default_branch: repo.default_branch,
			private: repo.private,
			visibility: repo.visibility,
			owner_login: repo.owner.login,
			latest_commit: repo.latest_commit,
			branches: repo.branches,
			synced_at: new Date().toISOString(),
			sync_error: null,
		})));
		
		const { error } = await supabase
			.from("user_repos")
			.upsert(rows, { onConflict: "user_id,repo_name" });
		
		if (error) throw new Error(`Failed to sync repos: ${error.message}`);
		if (rows.length !== repoList.length) {
			console.warn(`Deduped ${repoList.length - rows.length} repo sync rows for user: ${userID}`);
		}
		console.log(`Synced ${rows.length} repos for user: ${userID}`);
	},

	getUserRepos: async function (userID: string): Promise<{ error?: string; repos?: repoType[] }> {
		try {
			const supabase = getSupabaseServer();
			const { data: rows, error } = await supabase
				.from("user_repos")
				.select("*")
				.eq("user_id", userID);

			if (error) return { error: error.message };

			const dedupedRows = dedupeRepoSyncRows((rows || []) as Record<string, unknown>[]);
			const repos = dedupedRows.map((r) => ({
				id: r.id,
				name: (r.full_name as string)?.split("/").pop() || (r.repo_name as string),
				full_name: r.full_name,
				html_url: r.html_url,
				language: r.language,
				languages_url: r.languages_url,
				created_at: r.created_at,
				updated_at: r.updated_at,
				pushed_at: r.pushed_at,
				default_branch: r.default_branch,
				private: r.private,
				visibility: r.visibility,
				owner: { login: r.owner_login },
				latest_commit: r.latest_commit,
				branches: r.branches || [],
			})) as repoType[];
			
			return { repos };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	getOrCreateUser: async function (
		userID: string,
		defaults: { name: string; image: string; createdAt?: string }
	): Promise<{ error?: string; created?: boolean }> {
		try {
			const supabase = getSupabaseServer();
			const { data: existing } = await supabase.from("users").select("id").eq("id", userID).single();

			if (existing) return { created: false };

			await supabase.from("users").insert({
				id: userID,
				name: defaults.name,
				image: defaults.image,
				created_at: defaults.createdAt ?? new Date().toISOString(),
			});
			return { created: true };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	addDeploymentHistory: async function (
		repoName: string,
		serviceName: string,
		userID: string,
		entry: Omit<DeploymentHistoryEntry, "id" | "repo_name" | "service_name">
	) {
		try {
			if (!repoName || !serviceName) return { error: "repo_name and service_name are required." };

			const supabase = getSupabaseServer();
			const { data: user } = await supabase.from("users").select("id").eq("id", userID).single();
			if (!user) return { error: "User not found" };

			const { data: inserted, error } = await supabase
				.from("deployment_history")
				.insert({
					repo_name: repoName,
					service_name: serviceName,
					user_id: userID,
					timestamp: entry.timestamp ?? new Date().toISOString(),
					success: entry.success,
					steps: entry.steps ?? [],
					config_snapshot: entry.configSnapshot ?? {},
					commit_sha: entry.commitSha ?? null,
					commit_message: entry.commitMessage ?? null,
					branch: entry.branch ?? null,
					duration_ms: entry.durationMs ?? null,
				})
				.select("id")
				.single();

			if (error) return { error };
			return { success: true, id: inserted?.id };
		} catch (error) {
			console.error("addDeploymentHistory error:", error);
			return { error };
		}
	},

	getDeploymentHistory: async function (repoName: string, serviceName: string, userID: string, page = 1, limit = 10) {
		try {
			const supabase = getSupabaseServer();
			const { data: user } = await supabase.from("users").select("id").eq("id", userID).single();
			if (!user) return { error: "User not found" };

			const safePage = Math.max(1, page);
			const safeLimit = Math.max(1, limit);
			const from = (safePage - 1) * safeLimit;
			const to = from + safeLimit - 1;

			const { data: rows, error, count } = await supabase
				.from("deployment_history")
				.select("*", { count: "exact" })
				.eq("user_id", userID)
				.eq("repo_name", repoName)
				.eq("service_name", serviceName)
				.order("timestamp", { ascending: false })
				.range(from, to);

			if (error) return { error };

			const history: DeploymentHistoryEntry[] = (rows || []).map((row: Record<string, unknown>) => ({
				id: row.id as string,
				repo_name: row.repo_name as string,
				service_name: row.service_name as string,
				timestamp: row.timestamp as string,
				success: row.success as boolean,
				steps: (row.steps as DeploymentHistoryEntry["steps"]) ?? [],
				configSnapshot: (row.config_snapshot as Record<string, unknown>) ?? {},
				commitSha: row.commit_sha as string | undefined,
				commitMessage: row.commit_message as string | undefined,
				branch: row.branch as string | undefined,
				durationMs: row.duration_ms as number | undefined,
			}));

			return { history, total: count ?? history.length, page: safePage, limit: safeLimit };
		} catch (error) {
			console.error("getDeploymentHistory error:", error);
			return { error };
		}
	},

	getAllDeploymentHistory: async function (userID: string, page = 1, limit = 10) {
		try {
			const supabase = getSupabaseServer();
			const { data: user } = await supabase.from("users").select("id").eq("id", userID).single();
			if (!user) return { error: "User doesn't exist" };

			const safePage = Math.max(1, page);
			const safeLimit = Math.max(1, limit);
			const from = (safePage - 1) * safeLimit;
			const to = from + safeLimit - 1;

			const { data: rows, error, count } = await supabase
				.from("deployment_history")
				.select("*", { count: "exact" })
				.eq("user_id", userID)
				.order("timestamp", { ascending: false })
				.range(from, to);

			if (error) return { error };

			const history = (rows || []).map((row: Record<string, unknown>) => ({
				id: row.id as string,
				repo_name: row.repo_name as string,
				service_name: row.service_name as string,
				timestamp: row.timestamp as string,
				success: row.success as boolean,
				steps: (row.steps as DeploymentHistoryEntry["steps"]) ?? [],
				configSnapshot: (row.config_snapshot as Record<string, unknown>) ?? {},
				commitSha: row.commit_sha as string | undefined,
				commitMessage: row.commit_message as string | undefined,
				branch: row.branch as string | undefined,
				durationMs: row.duration_ms as number | undefined,
			}));

			return { history, total: count ?? history.length, page: safePage, limit: safeLimit };
		} catch (error) {
			console.error("getAllDeploymentHistory error:", error);
			return { error };
		}
	},

	/** Upsert detected services for a repo (after running detect-services). */
	upsertRepoServices: async function (
		userID: string,
		repoUrl: string,
		payload: { branch: string; repo_owner: string; repo_name: string; services: DetectedServiceInfo[]; is_monorepo: boolean }
	): Promise<{ error?: string }> {
		try {
			const normalizedUrl = repoUrl.replace(/\.git$/, "").trim();
			if (!userID || !normalizedUrl) return { error: "userID and repo_url are required" };

			const supabase = getSupabaseServer();
			const { error } = await supabase.from("repo_services").upsert(
				{
					user_id: userID,
					repo_url: normalizedUrl,
					branch: payload.branch,
					repo_owner: payload.repo_owner,
					repo_name: payload.repo_name,
					services: payload.services,
					is_monorepo: payload.is_monorepo,
					updated_at: new Date().toISOString(),
				},
				{ onConflict: "user_id,repo_url" }
			);
			if (error) return { error: error.message };
			return {};
		} catch (err) {
			console.error("upsertRepoServices error:", err);
			return { error: err instanceof Error ? err.message : String(err) };
		}
	},

	/** Get all stored repo services for a user. */
	getUserRepoServices: async function (userID: string): Promise<{ error?: string; records?: RepoServicesRecord[] }> {
		try {
			const supabase = getSupabaseServer();
			const { data: rows, error } = await supabase
				.from("repo_services")
				.select("repo_url, branch, repo_owner, repo_name, services, is_monorepo, updated_at")
				.eq("user_id", userID)
				.order("updated_at", { ascending: false });

			if (error) return { error: error.message };
			const records: RepoServicesRecord[] = (rows || []).map((r: Record<string, unknown>) => ({
			repo_url: r.repo_url as string,
			branch: r.branch as string,
			repo_owner: r.repo_owner as string,
			repo_name: r.repo_name as string,
			services: (r.services as DetectedServiceInfo[]) ?? [],
			is_monorepo: (r.is_monorepo as boolean) ?? false,
			updated_at: r.updated_at as string,
			}));
			return { records };
		} catch (err) {
			console.error("getUserRepoServices error:", err);
			return { error: err instanceof Error ? err.message : String(err) };
		}
	},

	/** Add an email to the waiting list (e.g. when sign-in is denied). Idempotent: same email is upserted. */
	addToWaitingList: async function (email: string, name?: string | null): Promise<{ error?: string }> {
		try {
			const trimmed = (email || "").trim().toLowerCase();
			if (!trimmed) return { error: "Email is required" };

			const supabase = getSupabaseServer();
			const { error } = await supabase.from("waiting_list").upsert(
				{ email: trimmed, name: (name || "").trim() || null },
				{ onConflict: "email" }
			);
			if (error) return { error: error.message };
			return {};
		} catch (error) {
			console.error("addToWaitingList error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	isApprovedUser: async function (email: string): Promise<{ approved: boolean; error?: string }> {
		try {
			const trimmed = (email || "").trim().toLowerCase();
			if (!trimmed) return { approved: false, error: "Email is required" };

			const supabase = getSupabaseServer();
			const { data, error } = await supabase
				.from("approved_users")
				.select("email")
				.eq("email", trimmed)
				.maybeSingle();

			if (error) return { approved: false, error: error.message };
			return { approved: !!data };
		} catch (error) {
			console.error("isApprovedUser error:", error);
			return { approved: false, error: error instanceof Error ? error.message : String(error) };
		}
	},
};
