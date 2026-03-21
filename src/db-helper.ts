import { getSupabaseServer } from "./lib/supabaseServer";
import { DeployConfig, DeploymentHistoryEntry, repoType, DetectedServiceInfo, RepoServicesRecord } from "./app/types";
import { v4 as uuidv4 } from "uuid";

type RowDeployment = {
	id: string;
	repo_name: string;
	service_name: string;
	owner_id: string;
	status: string | null;
	first_deployment: string | null;
	last_deployment: string | null;
	revision: number | null;
	data: Record<string, unknown>;
	scan_results: Record<string, unknown> | null;
	github_full_name?: string | null;
	github_installation_id?: number | null;
	auto_deploy_enabled?: boolean | null;
	auto_deploy_branch?: string | null;
	last_auto_deploy_sha?: string | null;
};

function mergeAutoDeployDbColumns(
	incoming: DeployConfig,
	existing: Pick<
		RowDeployment,
		"github_full_name" | "github_installation_id" | "auto_deploy_enabled" | "auto_deploy_branch" | "last_auto_deploy_sha"
	> | null
) {
	const e = existing ?? {};
	const ghFull = Object.prototype.hasOwnProperty.call(incoming, "github_full_name")
		? incoming.github_full_name ?? null
		: (e.github_full_name ?? null);
	const inst = Object.prototype.hasOwnProperty.call(incoming, "github_installation_id")
		? incoming.github_installation_id ?? null
		: (e.github_installation_id ?? null);
	const autoEn = Object.prototype.hasOwnProperty.call(incoming, "auto_deploy_enabled")
		? Boolean(incoming.auto_deploy_enabled)
		: Boolean(e.auto_deploy_enabled);
	const autoBr = Object.prototype.hasOwnProperty.call(incoming, "auto_deploy_branch")
		? incoming.auto_deploy_branch ?? null
		: (e.auto_deploy_branch ?? null);
	const lastSha = Object.prototype.hasOwnProperty.call(incoming, "last_auto_deploy_sha")
		? incoming.last_auto_deploy_sha ?? null
		: (e.last_auto_deploy_sha ?? null);
	return {
		github_full_name: ghFull,
		github_installation_id: inst,
		auto_deploy_enabled: autoEn,
		auto_deploy_branch: autoBr,
		last_auto_deploy_sha: lastSha,
	};
}

function rowToDeployConfig(row: RowDeployment): DeployConfig & { ownerID: string } {
	const { id, repo_name, service_name, owner_id, status, first_deployment, last_deployment, revision, data } = row;
	const dataObj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
	return {
		id,
		repo_name,
		service_name,
		ownerID: owner_id,
		// If status is missing/null in the DB we treat the service as not deployed yet.
		status: (status as DeployConfig["status"]) ?? "didnt_deploy",
		first_deployment: first_deployment ?? undefined,
		last_deployment: last_deployment ?? undefined,
		revision: revision ?? 1,
		...dataObj,
		scan_results: row.scan_results ? (row.scan_results as any) : undefined,
		github_full_name: row.github_full_name ?? (dataObj.github_full_name as string | undefined) ?? undefined,
		github_installation_id: row.github_installation_id ?? (dataObj.github_installation_id as number | undefined) ?? undefined,
		auto_deploy_enabled: row.auto_deploy_enabled ?? (dataObj.auto_deploy_enabled as boolean | undefined) ?? false,
		auto_deploy_branch: row.auto_deploy_branch ?? (dataObj.auto_deploy_branch as string | undefined) ?? undefined,
		last_auto_deploy_sha: row.last_auto_deploy_sha ?? (dataObj.last_auto_deploy_sha as string | undefined) ?? undefined,
	} as DeployConfig & { ownerID: string };
}

export const dbHelper = {
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
			const { repo_name, service_name } = deployConfig;
			if (!repo_name || !service_name) return { error: "repo_name and service_name are required" };

			const supabase = getSupabaseServer();

			if (deployConfig.status === "stopped") {
				await supabase.from("deployments").delete()
					.eq("repo_name", repo_name)
					.eq("service_name", service_name);
				return { success: "Deployment stopped and deleted" };
			}

			// Columns we store at top level; rest goes into data jsonb
			const {
				id: _id,
				repo_name: _rn,
				service_name: _sn,
				status,
				first_deployment,
				last_deployment,
				revision,
				scan_results,
				github_full_name: _gfn,
				github_installation_id: _gii,
				auto_deploy_enabled: _ade,
				auto_deploy_branch: _adb,
				last_auto_deploy_sha: _las,
				ownerID: _ownerID,
				...rest
			} = deployConfig as DeployConfig & { ownerID?: string };
			const dataJson = { ...rest } as Record<string, unknown>;
			delete dataJson.ownerID;

			const { data: existing } = await supabase
				.from("deployments")
				.select(
					"revision, data, status, scan_results, github_full_name, github_installation_id, auto_deploy_enabled, auto_deploy_branch, last_auto_deploy_sha"
				)
				.eq("repo_name", repo_name)
				.eq("service_name", service_name)
				.order("last_deployment", { ascending: false })
				.limit(1)
				.maybeSingle();
			const autoCols = mergeAutoDeployDbColumns(deployConfig, existing);

			if (!existing) {
				await supabase.from("deployments").insert({
					id: uuidv4(),
					repo_name: repo_name,
					service_name: service_name,
					owner_id: userID,
					// If the caller didn't provide a status (e.g. scan-only persistence),
					// do not mark it as running.
					status: deployConfig.status ?? "didnt_deploy",
					first_deployment: new Date().toISOString(),
					last_deployment: new Date().toISOString(),
					revision: 1,
					data: dataJson,
					scan_results: scan_results || null,
					...autoCols,
				});
				return { success: "New deployment created and added to user" };
			}

			const nextRevision = (existing.revision ?? 0) + 1;
			const lastDeployment = new Date().toISOString();
			const mergedData = { ...((existing.data as Record<string, unknown>) || {}), ...dataJson };

			// Preserve existing status/scan_results unless explicitly provided
			const hasStatus = Object.prototype.hasOwnProperty.call(deployConfig, "status");
			const nextStatus = hasStatus ? deployConfig.status ?? null : existing.status;

			const hasScanResults = typeof scan_results !== "undefined";
			const nextScanResults = hasScanResults ? (scan_results || null) : existing.scan_results;

			await supabase
				.from("deployments")
				.update({
					status: nextStatus,
					last_deployment: lastDeployment,
					revision: nextRevision,
					data: mergedData,
					scan_results: nextScanResults,
					...autoCols,
				})
				.eq("repo_name", repo_name)
				.eq("service_name", service_name);

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
			if (!repoName || !serviceName || !userID) return { error: "repo_name, service_name, and user ID are required" };

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

			const deployments = (rows || []).map((row) => rowToDeployConfig(row as RowDeployment));
			return { deployments };
		} catch (error) {
			console.error("getUserDeployments error:", error);
			return { error };
		}
	},

	getDeploymentsByRepo: async function (userID: string, repoName: string) {
		try {
			const supabase = getSupabaseServer();

			const { data: rows, error } = await supabase
				.from("deployments")
				.select("*")
				.eq("owner_id", userID)
				.eq("repo_name", repoName);

			if (error) return { error: error.message };

			const deployments = (rows || []).map((row) => rowToDeployConfig(row as RowDeployment));
			return { deployments };
		} catch (error) {
			console.error("getDeploymentsByRepo error:", error);
			return { error };
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
			return { deployment: rowToDeployConfig(row as RowDeployment) };
		} catch (error) {
			console.error("getDeployment error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	/** Deployments with auto-deploy on for this GitHub App installation and repository (`owner/repo`, case-insensitive). */
	getDeploymentsForAutoDeploy: async function (
		installationId: number,
		githubFullName: string
	): Promise<{ error?: string; deployments?: (DeployConfig & { ownerID: string })[] }> {
		try {
			const supabase = getSupabaseServer();
			const normalized = githubFullName.trim().toLowerCase();
			const { data: rows, error } = await supabase
				.from("deployments")
				.select("*")
				.eq("github_installation_id", installationId)
				.eq("auto_deploy_enabled", true);
			if (error) return { error: error.message };
			const all = (rows || []).map((row) => rowToDeployConfig(row as RowDeployment));
			const filtered = all.filter((d) => (d.github_full_name || "").trim().toLowerCase() === normalized);
			return { deployments: filtered };
		} catch (error) {
			console.error("getDeploymentsForAutoDeploy error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	updateLastAutoDeploySha: async function (repoName: string, serviceName: string, sha: string) {
		try {
			const supabase = getSupabaseServer();
			const { error } = await supabase
				.from("deployments")
				.update({ last_auto_deploy_sha: sha })
				.eq("repo_name", repoName)
				.eq("service_name", serviceName);
			if (error) return { error: error.message };
			return { success: true };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	syncUserRepos: async function (userID: string, repoList: repoType[]) {
		const supabase = getSupabaseServer();
		for (const repo of repoList) {
			await supabase.from("user_repos").upsert(
				{ user_id: userID, repo_name: repo.name, data: repo as unknown as Record<string, unknown> },
				{ onConflict: "user_id,repo_name" }
			);
		}
		console.log(`Synced ${repoList.length} repos for user: ${userID}`);
	},

	getUserRepos: async function (userID: string): Promise<{ error?: string; repos?: repoType[] }> {
		try {
			const supabase = getSupabaseServer();
			const { data: rows, error } = await supabase
				.from("user_repos")
				.select("data")
				.eq("user_id", userID);

			if (error) return { error: error.message };
			const repos = (rows || []).map((r) => r.data as repoType);
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

	getDeploymentHistory: async function (repoName: string, serviceName: string, userID: string) {
		try {
			const supabase = getSupabaseServer();
			const { data: user } = await supabase.from("users").select("id").eq("id", userID).single();
			if (!user) return { error: "User not found" };

			const { data: rows, error } = await supabase
				.from("deployment_history")
				.select("*")
				.eq("user_id", userID)
				.eq("repo_name", repoName)
				.eq("service_name", serviceName)
				.order("timestamp", { ascending: false });

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

			return { history };
		} catch (error) {
			console.error("getDeploymentHistory error:", error);
			return { error };
		}
	},

	getAllDeploymentHistory: async function (userID: string) {
		try {
			const supabase = getSupabaseServer();
			const { data: user } = await supabase.from("users").select("id").eq("id", userID).single();
			if (!user) return { error: "User doesn't exist" };

			const { data: rows, error } = await supabase
				.from("deployment_history")
				.select("*")
				.eq("user_id", userID)
				.order("timestamp", { ascending: false });

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

			return { history };
		} catch (error) {
			console.error("getAllDeploymentHistory error:", error);
			return { error };
		}
	},

	/**
	 * Patch only the JSON `data` column for the latest deployment row.
	 * This avoids bumping revision/status when we add derived assets (screenshots, etc.).
	 */
	patchDeploymentData: async function (
		repoName: string,
		serviceName: string,
		userID: string,
		patch: Record<string, unknown>
	) {
		try {
			const supabase = getSupabaseServer();
			const { data: row, error: fetchError } = await supabase
				.from("deployments")
				.select("id, data")
				.eq("owner_id", userID)
				.eq("repo_name", repoName)
				.eq("service_name", serviceName)
				.order("last_deployment", { ascending: false })
				.limit(1)
				.maybeSingle();

			if (fetchError) return { error: fetchError.message };
			if (!row) return { error: "Deployment not found" };

			const nextData = { ...(row.data as Record<string, unknown>), ...patch };
			const { error: updateError } = await supabase.from("deployments").update({ data: nextData }).eq("id", row.id);

			if (updateError) return { error: updateError.message };
			return { success: true };
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return { error: message };
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
};
