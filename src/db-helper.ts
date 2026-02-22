import { getSupabaseServer } from "./lib/supabaseServer";
import { DeployConfig, DeploymentHistoryEntry, repoType } from "./app/types";

type RowDeployment = {
	id: string;
	owner_id: string;
	status: string | null;
	first_deployment: string | null;
	last_deployment: string | null;
	revision: number | null;
	data: Record<string, unknown>;
};

function rowToDeployConfig(row: RowDeployment): DeployConfig & { ownerID: string } {
	const { id, owner_id, status, first_deployment, last_deployment, revision, data } = row;
	return {
		id,
		ownerID: owner_id,
		status: (status as DeployConfig["status"]) ?? "running",
		first_deployment: first_deployment ?? undefined,
		last_deployment: last_deployment ?? undefined,
		revision: revision ?? 1,
		...data,
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
			const deploymentId = deployConfig.id != null ? String(deployConfig.id).trim() : "";
			if (!deploymentId) return { error: "Deployment ID is required" };
			if (deploymentId.includes("/")) return { error: "Deployment ID cannot contain '/'." };

			const supabase = getSupabaseServer();

			const { data: userRow, error: userError } = await supabase
				.from("users")
				.select("id, deployment_ids")
				.eq("id", userID)
				.single();

			if (userError || !userRow) return { error: "User doesn't exist" };

			const deploymentIds: string[] = (userRow.deployment_ids as string[]) || [];

			if (deployConfig.status === "stopped") {
				await supabase.from("deployments").delete().eq("id", deploymentId);
				const updatedIds = deploymentIds.filter((id) => id !== deploymentId);
				await supabase.from("users").update({ deployment_ids: updatedIds }).eq("id", userID);
				return { success: "Deployment stopped and deleted" };
			}

			// Columns we store at top level; rest goes into data jsonb
			const {
				id: _id,
				status,
				first_deployment,
				last_deployment,
				revision,
				...rest
			} = deployConfig as DeployConfig & { ownerID?: string };
			const dataJson = { ...rest } as Record<string, unknown>;

			const { data: existing } = await supabase
				.from("deployments")
				.select("id, revision, data")
				.eq("id", deploymentId)
				.single();

			if (!existing) {
				await supabase.from("deployments").insert({
					id: deploymentId,
					owner_id: userID,
					status: deployConfig.status ?? "running",
					first_deployment: new Date().toISOString(),
					last_deployment: new Date().toISOString(),
					revision: 1,
					data: dataJson,
				});
				const updatedIds = deploymentIds.includes(deploymentId) ? deploymentIds : [...deploymentIds, deploymentId];
				await supabase.from("users").update({ deployment_ids: updatedIds }).eq("id", userID);
				return { success: "New deployment created and added to user" };
			}

			const nextRevision = (existing.revision ?? 0) + 1;
			const lastDeployment = new Date().toISOString();
			const mergedData = { ...((existing.data as Record<string, unknown>) || {}), ...dataJson };
			await supabase
				.from("deployments")
				.update({
					status: deployConfig.status ?? "running",
					last_deployment: lastDeployment,
					revision: nextRevision,
					data: mergedData,
				})
				.eq("id", deploymentId);

			return { success: "Deployment data updated successfully" };
		} catch (error) {
			console.error("updateDeployments error:", error);
			return { error };
		}
	},

	deleteDeploymentHistory: async function (deploymentId: string) {
		const supabase = getSupabaseServer();
		await supabase.from("deployment_history").delete().eq("deployment_id", deploymentId);
	},

	deleteDeployment: async function (deploymentId: string, userID: string) {
		try {
			if (!deploymentId || !userID) return { error: "Deployment ID and user ID are required" };

			const supabase = getSupabaseServer();

			const { data: deployment, error: fetchError } = await supabase
				.from("deployments")
				.select("id, owner_id")
				.eq("id", deploymentId)
				.single();

			if (fetchError || !deployment) return { success: "Deployment already deleted or not found" };
			if (deployment.owner_id !== userID) return { error: "Unauthorized: deployment does not belong to user" };

			await supabase.from("deployments").delete().eq("id", deploymentId);

			const { data: userRow } = await supabase
				.from("users")
				.select("deployment_ids")
				.eq("id", userID)
				.single();

			if (userRow && Array.isArray(userRow.deployment_ids)) {
				const updatedIds = (userRow.deployment_ids as string[]).filter((id: string) => id !== deploymentId);
				await supabase.from("users").update({ deployment_ids: updatedIds }).eq("id", userID);
			}

			return { success: "Deployment deleted" };
		} catch (error) {
			console.error("deleteDeployment error:", error);
			return { error };
		}
	},

	getUserDeployments: async function (userID: string) {
		try {
			const supabase = getSupabaseServer();

			const { data: userRow, error: userError } = await supabase
				.from("users")
				.select("deployment_ids")
				.eq("id", userID)
				.single();

			if (userError || !userRow) return { error: "User doesn't exist" };

			const deploymentIds: string[] = (userRow.deployment_ids as string[]) || [];
			if (deploymentIds.length === 0) return { deployments: [] };

			const { data: rows } = await supabase
				.from("deployments")
				.select("*")
				.in("id", deploymentIds);

			const deployments = (rows || []).map((row) => rowToDeployConfig(row as RowDeployment));
			return { deployments };
		} catch (error) {
			console.error("getUserDeployments error:", error);
			return { error };
		}
	},

	getDeployment: async function (deploymentId: string): Promise<{ error?: string; deployment?: DeployConfig & { ownerID: string } }> {
		try {
			const supabase = getSupabaseServer();
			const { data: row, error } = await supabase
				.from("deployments")
				.select("*")
				.eq("id", deploymentId)
				.single();

			if (error || !row) return { error: "Deployment not found" };
			return { deployment: rowToDeployConfig(row as RowDeployment) };
		} catch (error) {
			console.error("getDeployment error:", error);
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
				deployment_ids: [],
			});
			return { created: true };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	addDeploymentHistory: async function (
		deploymentId: string,
		userID: string,
		entry: Omit<DeploymentHistoryEntry, "id" | "deploymentId">
	) {
		try {
			const id = deploymentId != null ? String(deploymentId).trim() : "";
			if (!id || id.includes("/")) return { error: "Deployment ID is required and cannot contain '/'." };

			const supabase = getSupabaseServer();
			const { data: user } = await supabase.from("users").select("id").eq("id", userID).single();
			if (!user) return { error: "User not found" };

			const { data: inserted, error } = await supabase
				.from("deployment_history")
				.insert({
					deployment_id: id,
					user_id: userID,
					timestamp: entry.timestamp ?? new Date().toISOString(),
					success: entry.success,
					steps: entry.steps ?? [],
					config_snapshot: entry.configSnapshot ?? {},
					commit_sha: entry.commitSha ?? null,
					commit_message: entry.commitMessage ?? null,
					branch: entry.branch ?? null,
					duration_ms: entry.durationMs ?? null,
					service_name: entry.serviceName ?? null,
					repo_url: entry.repoUrl ?? null,
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

	getDeploymentHistory: async function (deploymentId: string, userID: string) {
		try {
			const supabase = getSupabaseServer();
			const { data: user } = await supabase.from("users").select("id").eq("id", userID).single();
			if (!user) return { error: "User not found" };

			const { data: rows, error } = await supabase
				.from("deployment_history")
				.select("*")
				.eq("user_id", userID)
				.eq("deployment_id", deploymentId)
				.order("timestamp", { ascending: false });

			if (error) return { error };

			const history: DeploymentHistoryEntry[] = (rows || []).map((row: Record<string, unknown>) => ({
				id: row.id as string,
				deploymentId: row.deployment_id as string,
				timestamp: row.timestamp as string,
				success: row.success as boolean,
				steps: (row.steps as DeploymentHistoryEntry["steps"]) ?? [],
				configSnapshot: (row.config_snapshot as Record<string, unknown>) ?? {},
				commitSha: row.commit_sha as string | undefined,
				commitMessage: row.commit_message as string | undefined,
				branch: row.branch as string | undefined,
				durationMs: row.duration_ms as number | undefined,
				serviceName: row.service_name as string | undefined,
				repoUrl: row.repo_url as string | undefined,
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
				deploymentId: row.deployment_id as string,
				timestamp: row.timestamp as string,
				success: row.success as boolean,
				steps: (row.steps as DeploymentHistoryEntry["steps"]) ?? [],
				configSnapshot: (row.config_snapshot as Record<string, unknown>) ?? {},
				commitSha: row.commit_sha as string | undefined,
				commitMessage: row.commit_message as string | undefined,
				branch: row.branch as string | undefined,
				durationMs: row.duration_ms as number | undefined,
				serviceName: row.service_name as string | undefined,
				repoUrl: row.repo_url as string | undefined,
			}));

			return { history };
		} catch (error) {
			console.error("getAllDeploymentHistory error:", error);
			return { error };
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
