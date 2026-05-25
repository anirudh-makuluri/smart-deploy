import { getSupabaseServer } from "./lib/supabaseServer";
import {
	DeployConfig,
	DeploymentHealthCheck,
	DeploymentHistoryEntry,
	DeploymentRemediationAttempt,
	DeploymentRemediationChange,
	DetectedServiceInfo,
	RepoServicesRecord,
	RemediationAttemptStatus,
	RemediationRiskLevel,
	RemediationTriggerType,
	repoType,
} from "./app/types";
import { withDeployInfraDefaults } from "./lib/deployInfraDefaults";
import { v4 as uuidv4 } from "uuid";

function hasOwnKey<T extends object>(obj: T, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

function toOptionalTrimmedString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function normalizeScanResults(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (Object.keys(record).length === 0) return null;
	return record;
}

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter(Boolean);
}

function normalizeRemediationChanges(value: unknown): DeploymentRemediationChange[] {
	if (!Array.isArray(value)) return [];
	const changes: DeploymentRemediationChange[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		const title = toOptionalTrimmedString(record.title);
		const description = toOptionalTrimmedString(record.description);
		if (!title || !description) continue;
		changes.push({
			title,
			description,
			target: toOptionalTrimmedString(record.target),
		});
	}
	return changes;
}

type DeploymentDbRow = Record<string, unknown>;
type AnalysisPayloadMap = Map<string, Record<string, unknown>>;

async function upsertAnalysisResponse(args: {
	id: string;
	payload: Record<string, unknown>;
	repoUrl: string;
	commitSha: string | null;
	serviceName: string;
}) {
	const supabase = getSupabaseServer();
	const { error } = await supabase
		.from("analysis_responses")
		.upsert(
			{
				id: args.id,
				endpoint: "/analyze",
				repo_url: args.repoUrl || "",
				commit_sha: args.commitSha,
				package_path: ".",
				service_name: args.serviceName || null,
				from_cache: false,
				payload: args.payload,
			},
			{ onConflict: "id" }
		);
	if (error) throw new Error(error.message);
}

async function fetchAnalysisPayloadMap(rows: DeploymentDbRow[]): Promise<AnalysisPayloadMap> {
	const responseIds = Array.from(
		new Set(
			rows
				.map((row) => toOptionalTrimmedString(row.response_id))
				.filter((v): v is string => Boolean(v))
		)
	);
	if (responseIds.length === 0) return new Map();

	const supabase = getSupabaseServer();
	const { data, error } = await supabase
		.from("analysis_responses")
		.select("id,payload")
		.in("id", responseIds);
	if (error) throw new Error(error.message);

	const payloadMap: AnalysisPayloadMap = new Map();
	for (const row of (data || []) as Array<Record<string, unknown>>) {
		const id = toOptionalTrimmedString(row.id);
		if (!id) continue;
		const payload = normalizeScanResults(row.payload);
		if (!payload) continue;
		payloadMap.set(id, payload);
	}
	return payloadMap;
}

function attachAnalysisPayload(rows: DeploymentDbRow[], payloadMap: AnalysisPayloadMap): DeploymentDbRow[] {
	return rows.map((row) => {
		const responseId = toOptionalTrimmedString(row.response_id);
		const payload = responseId ? payloadMap.get(responseId) : null;
		const payloadWithResponseId = payload ? { ...payload, response_id: payload.response_id ?? responseId } : {};
		return {
			...row,
			response_id: responseId,
			scan_results: payloadWithResponseId,
		};
	});
}

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
		response_id,
		auto_fix_enabled,
		max_auto_fix_retries,
		health_monitoring_window_sec,
		lifecycle_state,
		latest_health_status,
		latest_health_check_at,
		active_remediation_session_id,
		active_remediation_attempt_count,
		ec2,
		cloud_run,
		scan_results,
	} = row;

	const ownerID = String(owner_id ?? "");
	const normalized = withDeployInfraDefaults({
		id,
		repoName: repo_name || "",
		serviceName: service_name || "",
		url: url || "",
		branch: branch || "",
		responseId: response_id ?? null,
		commitSha: commit_sha ?? null,
		envVars: env_vars ?? undefined,
		liveUrl: live_url ?? null,
		screenshotUrl: screenshot_url ?? null,
		status: (status as DeployConfig["status"]) ?? "didnt_deploy",
		lifecycleState: (lifecycle_state as DeployConfig["lifecycleState"]) ?? "idle",
		firstDeployment: first_deployment ?? null,
		lastDeployment: last_deployment ?? null,
		revision: revision ?? 0,
		cloudProvider: (cloud_provider as "aws" | "gcp") || "aws",
		deploymentTarget: (deployment_target as "ec2" | "cloud_run") || "ec2",
		awsRegion: aws_region || "",
		autoFixEnabled: typeof auto_fix_enabled === "boolean" ? auto_fix_enabled : true,
		maxAutoFixRetries: typeof max_auto_fix_retries === "number" ? max_auto_fix_retries : null,
		healthMonitoringWindowSec:
			typeof health_monitoring_window_sec === "number" ? health_monitoring_window_sec : null,
		latestHealthStatus: (latest_health_status as DeployConfig["latestHealthStatus"]) ?? "unknown",
		latestHealthCheckAt: toOptionalTrimmedString(latest_health_check_at),
		activeRemediationSessionId: toOptionalTrimmedString(active_remediation_session_id),
		activeRemediationAttemptCount:
			typeof active_remediation_attempt_count === "number" ? active_remediation_attempt_count : 0,
		ec2: (ec2 as Record<string, unknown>) || {},
		cloudRun: (cloud_run as Record<string, unknown>) || {},
		scanResults: (scan_results || {}) as Record<string, unknown>,
	} as DeployConfig);
	return { ...normalized, ownerID } as DeployConfig & { ownerID: string };
}

/**
 * Transform DeployConfig (camelCase) to database row (snake_case)
 */
function deployConfigToRow(config: DeployConfig): Record<string, unknown> {
	const row: Record<string, unknown> = {
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
		lifecycle_state: config.lifecycleState ?? "idle",
		auto_fix_enabled: config.autoFixEnabled ?? true,
		max_auto_fix_retries: config.maxAutoFixRetries ?? null,
		health_monitoring_window_sec: config.healthMonitoringWindowSec ?? null,
		latest_health_status: config.latestHealthStatus ?? null,
		latest_health_check_at: config.latestHealthCheckAt ?? null,
		active_remediation_session_id: config.activeRemediationSessionId ?? null,
		active_remediation_attempt_count: config.activeRemediationAttemptCount ?? 0,
		ec2: config.ec2,
		cloud_run: config.cloudRun,
	};
	if (config.responseId !== undefined) {
		row.response_id = config.responseId;
	}
	return row;
}

function mapRemediationAttemptRow(row: Record<string, unknown>): DeploymentRemediationAttempt {
	return {
		id: String(row.id ?? ""),
		repo_name: String(row.repo_name ?? ""),
		service_name: String(row.service_name ?? ""),
		deployment_history_id: toOptionalTrimmedString(row.deployment_history_id),
		session_id: toOptionalTrimmedString(row.session_id),
		attempt_number: Number(row.attempt_number ?? 0),
		trigger_type: (toOptionalTrimmedString(row.trigger_type) as RemediationTriggerType) ?? "deploy_failure",
		health_failure_type: toOptionalTrimmedString(row.health_failure_type) as DeploymentRemediationAttempt["health_failure_type"],
		summary: String(row.summary ?? ""),
		root_cause: toOptionalTrimmedString(row.root_cause),
		evidence: normalizeStringArray(row.evidence),
		risk_level: toOptionalTrimmedString(row.risk_level) as RemediationRiskLevel | null,
		confidence: typeof row.confidence === "number" ? row.confidence : null,
		changes: normalizeRemediationChanges(row.changes),
		diff_preview: Array.isArray(row.diff_preview) ? (row.diff_preview as Record<string, unknown>[] | string[]) : null,
		files_to_modify: normalizeStringArray(row.files_to_modify),
		expected_outcome: toOptionalTrimmedString(row.expected_outcome),
		can_auto_apply: Boolean(row.can_auto_apply),
		approved_by_user: typeof row.approved_by_user === "boolean" ? row.approved_by_user : null,
		applied: Boolean(row.applied),
		success: typeof row.success === "boolean" ? row.success : null,
		status: (toOptionalTrimmedString(row.status) as RemediationAttemptStatus) ?? "proposed",
		error: toOptionalTrimmedString(row.error),
		created_at: String(row.created_at ?? ""),
		updated_at: toOptionalTrimmedString(row.updated_at),
	};
}

function mapHealthCheckRow(row: Record<string, unknown>): DeploymentHealthCheck {
	return {
		id: String(row.id ?? ""),
		repo_name: String(row.repo_name ?? ""),
		service_name: String(row.service_name ?? ""),
		deployment_history_id: toOptionalTrimmedString(row.deployment_history_id),
		url: String(row.url ?? ""),
		status: (toOptionalTrimmedString(row.status) as DeploymentHealthCheck["status"]) ?? "unknown",
		http_status: typeof row.http_status === "number" ? row.http_status : null,
		failure_type: toOptionalTrimmedString(row.failure_type) as DeploymentHealthCheck["failure_type"],
		latency_ms: typeof row.latency_ms === "number" ? row.latency_ms : null,
		error_message: toOptionalTrimmedString(row.error_message),
		checked_at: String(row.checked_at ?? ""),
	};
}

async function fetchRemediationAttemptsByHistoryIds(historyIds: string[]) {
	if (historyIds.length === 0) return new Map<string, DeploymentRemediationAttempt[]>();
	const supabase = getSupabaseServer();
	const { data, error } = await supabase
		.from("deployment_remediation_attempts")
		.select("*")
		.in("deployment_history_id", historyIds)
		.order("attempt_number", { ascending: true })
		.order("created_at", { ascending: true });
	if (error) throw new Error(error.message);

	const mapped = new Map<string, DeploymentRemediationAttempt[]>();
	for (const row of (data || []) as Record<string, unknown>[]) {
		const attempt = mapRemediationAttemptRow(row);
		const historyId = attempt.deployment_history_id;
		if (!historyId) continue;
		const existing = mapped.get(historyId) ?? [];
		existing.push(attempt);
		mapped.set(historyId, existing);
	}
	return mapped;
}

async function fetchHealthChecksByHistoryIds(historyIds: string[]) {
	if (historyIds.length === 0) return new Map<string, DeploymentHealthCheck[]>();
	const supabase = getSupabaseServer();
	const { data, error } = await supabase
		.from("deployment_health_checks")
		.select("*")
		.in("deployment_history_id", historyIds)
		.order("checked_at", { ascending: true });
	if (error) throw new Error(error.message);

	const mapped = new Map<string, DeploymentHealthCheck[]>();
	for (const row of (data || []) as Record<string, unknown>[]) {
		const check = mapHealthCheckRow(row);
		const historyId = check.deployment_history_id;
		if (!historyId) continue;
		const existing = mapped.get(historyId) ?? [];
		existing.push(check);
		mapped.set(historyId, existing);
	}
	return mapped;
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
	updateDeployments: async function (deployConfig: DeployConfig, userID: string) {
		try {
			const normalizedDeployConfig = withDeployInfraDefaults(deployConfig);
			const { repoName, serviceName } = normalizedDeployConfig;
			if (!repoName || !serviceName) return { error: "repoName and serviceName are required" };

			const supabase = getSupabaseServer();
			const configRecord = normalizedDeployConfig as unknown as Record<string, unknown>;
			const hasScanResultsInput = hasOwnKey(configRecord, "scanResults");
			const rawScanResultsInput = configRecord.scanResults;
			const rawScanResults = hasScanResultsInput ? normalizeScanResults(configRecord.scanResults) : null;
			const explicitResponseId = toOptionalTrimmedString(configRecord.responseId);

			if (normalizedDeployConfig.status === "stopped") {
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

			let nextResponseId: string | null = explicitResponseId ?? toOptionalTrimmedString(existing?.response_id);
			if (hasScanResultsInput) {
				if (!rawScanResults) {
					const isExplicitClear =
						rawScanResultsInput === null ||
						(rawScanResultsInput &&
							typeof rawScanResultsInput === "object" &&
							!Array.isArray(rawScanResultsInput) &&
							Object.keys(rawScanResultsInput as Record<string, unknown>).length === 0);
					if (isExplicitClear) {
						nextResponseId = null;
					}
				} else {
					const payloadResponseId = toOptionalTrimmedString(rawScanResults.response_id);
					nextResponseId = explicitResponseId ?? payloadResponseId ?? nextResponseId ?? uuidv4();
					await upsertAnalysisResponse({
						id: nextResponseId,
						payload: { ...rawScanResults, response_id: nextResponseId },
						repoUrl: String(normalizedDeployConfig.url ?? existing?.url ?? ""),
						commitSha: toOptionalTrimmedString(rawScanResults.commit_sha) ?? normalizedDeployConfig.commitSha ?? null,
						serviceName,
					});
				}
			}

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
					...deployConfigToRow(normalizedDeployConfig),
					response_id: nextResponseId,
				};

				const { error: insertError } = await supabase.from("deployments").insert(insertPayload);
				if (insertError) return { error: insertError.message };
				return { success: "New deployment created and added to user" };
			}

			// Build update payload
			const updatePayload: Record<string, unknown> = {
				revision: (existing.revision ?? 0) + 1,
				...deployConfigToRow(normalizedDeployConfig),
			};
			if (hasScanResultsInput || explicitResponseId !== null) {
				updatePayload.response_id = nextResponseId;
			}

			// Update last_deployment only if commitSha changes
			if (normalizedDeployConfig.commitSha !== existing.commit_sha) {
				updatePayload.last_deployment = new Date().toISOString();
			}

			// Update first_deployment only if status changes from didnt_deploy to running
			if (existing.status === "didnt_deploy" && normalizedDeployConfig.status === "running") {
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

			const hydratedRows = attachAnalysisPayload(
				(rows || []) as DeploymentDbRow[],
				await fetchAnalysisPayloadMap((rows || []) as DeploymentDbRow[])
			);
			const deployments = hydratedRows.map((row: Record<string, unknown>) => rowToDeployConfig(row));
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

			const hydratedRows = attachAnalysisPayload(
				(rows || []) as DeploymentDbRow[],
				await fetchAnalysisPayloadMap((rows || []) as DeploymentDbRow[])
			);
			const deployments = hydratedRows
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
			const hydratedRows = attachAnalysisPayload(
				[row as DeploymentDbRow],
				await fetchAnalysisPayloadMap([row as DeploymentDbRow])
			);
			return { deployment: rowToDeployConfig(hydratedRows[0]) };
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

	addDeploymentHistory: async function (
		repoName: string,
		serviceName: string,
		userID: string,
		entry: Omit<DeploymentHistoryEntry, "id" | "repo_name" | "service_name">
	) {
		try {
			if (!repoName || !serviceName) return { error: "repo_name and service_name are required." };

			const supabase = getSupabaseServer();
			if (!(userID || "").trim()) return { error: "User not found" };

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

	addDeploymentRemediationAttempt: async function (args: {
		userID: string;
		repoName: string;
		serviceName: string;
		deploymentHistoryId?: string | null;
		sessionId?: string | null;
		attemptNumber: number;
		triggerType: RemediationTriggerType;
		healthFailureType?: DeploymentRemediationAttempt["health_failure_type"];
		summary: string;
		rootCause?: string | null;
		evidence?: string[];
		riskLevel?: RemediationRiskLevel | null;
		confidence?: number | null;
		changes?: DeploymentRemediationChange[];
		diffPreview?: Record<string, unknown>[] | string[] | null;
		filesToModify?: string[];
		expectedOutcome?: string | null;
		canAutoApply?: boolean;
		approvedByUser?: boolean | null;
		applied?: boolean;
		success?: boolean | null;
		status?: RemediationAttemptStatus;
		error?: string | null;
	}) {
		try {
			const supabase = getSupabaseServer();
			const { data, error } = await supabase
				.from("deployment_remediation_attempts")
				.insert({
					user_id: args.userID,
					repo_name: args.repoName,
					service_name: args.serviceName,
					deployment_history_id: args.deploymentHistoryId ?? null,
					session_id: args.sessionId ?? null,
					attempt_number: args.attemptNumber,
					trigger_type: args.triggerType,
					health_failure_type: args.healthFailureType ?? null,
					summary: args.summary,
					root_cause: args.rootCause ?? null,
					evidence: args.evidence ?? [],
					risk_level: args.riskLevel ?? null,
					confidence: args.confidence ?? null,
					changes: args.changes ?? [],
					diff_preview: args.diffPreview ?? [],
					files_to_modify: args.filesToModify ?? [],
					expected_outcome: args.expectedOutcome ?? null,
					can_auto_apply: args.canAutoApply ?? false,
					approved_by_user: args.approvedByUser ?? null,
					applied: args.applied ?? false,
					success: args.success ?? null,
					status: args.status ?? "proposed",
					error: args.error ?? null,
				})
				.select("*")
				.single();

			if (error) return { error: error.message };
			return { attempt: mapRemediationAttemptRow((data ?? {}) as Record<string, unknown>) };
		} catch (error) {
			console.error("addDeploymentRemediationAttempt error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	updateDeploymentRemediationAttempt: async function (
		id: string,
		userID: string,
		patch: {
			healthFailureType?: DeploymentRemediationAttempt["health_failure_type"];
			summary?: string;
			rootCause?: string | null;
			evidence?: string[];
			riskLevel?: RemediationRiskLevel | null;
			confidence?: number | null;
			changes?: DeploymentRemediationChange[];
			diffPreview?: Record<string, unknown>[] | string[] | null;
			filesToModify?: string[];
			expectedOutcome?: string | null;
			canAutoApply?: boolean;
			approvedByUser?: boolean | null;
			applied?: boolean;
			success?: boolean | null;
			status?: RemediationAttemptStatus;
			error?: string | null;
			deploymentHistoryId?: string | null;
		}
	) {
		try {
			const supabase = getSupabaseServer();
			const updatePayload: Record<string, unknown> = {
				updated_at: new Date().toISOString(),
			};
			if (patch.healthFailureType !== undefined) updatePayload.health_failure_type = patch.healthFailureType;
			if (patch.summary !== undefined) updatePayload.summary = patch.summary;
			if (patch.rootCause !== undefined) updatePayload.root_cause = patch.rootCause;
			if (patch.evidence !== undefined) updatePayload.evidence = patch.evidence;
			if (patch.riskLevel !== undefined) updatePayload.risk_level = patch.riskLevel;
			if (patch.confidence !== undefined) updatePayload.confidence = patch.confidence;
			if (patch.changes !== undefined) updatePayload.changes = patch.changes;
			if (patch.diffPreview !== undefined) updatePayload.diff_preview = patch.diffPreview;
			if (patch.filesToModify !== undefined) updatePayload.files_to_modify = patch.filesToModify;
			if (patch.expectedOutcome !== undefined) updatePayload.expected_outcome = patch.expectedOutcome;
			if (patch.canAutoApply !== undefined) updatePayload.can_auto_apply = patch.canAutoApply;
			if (patch.approvedByUser !== undefined) updatePayload.approved_by_user = patch.approvedByUser;
			if (patch.applied !== undefined) updatePayload.applied = patch.applied;
			if (patch.success !== undefined) updatePayload.success = patch.success;
			if (patch.status !== undefined) updatePayload.status = patch.status;
			if (patch.error !== undefined) updatePayload.error = patch.error;
			if (patch.deploymentHistoryId !== undefined) updatePayload.deployment_history_id = patch.deploymentHistoryId;

			const { data, error } = await supabase
				.from("deployment_remediation_attempts")
				.update(updatePayload)
				.eq("id", id)
				.eq("user_id", userID)
				.select("*")
				.single();

			if (error) return { error: error.message };
			return { attempt: mapRemediationAttemptRow((data ?? {}) as Record<string, unknown>) };
		} catch (error) {
			console.error("updateDeploymentRemediationAttempt error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	getDeploymentRemediationAttempts: async function (
		repoName: string,
		serviceName: string,
		userID: string,
		deploymentHistoryId?: string | null
	) {
		try {
			const supabase = getSupabaseServer();
			let query = supabase
				.from("deployment_remediation_attempts")
				.select("*")
				.eq("user_id", userID)
				.eq("repo_name", repoName)
				.eq("service_name", serviceName)
				.order("attempt_number", { ascending: true })
				.order("created_at", { ascending: true });
			if (deploymentHistoryId) {
				query = query.eq("deployment_history_id", deploymentHistoryId);
			}
			const { data, error } = await query;
			if (error) return { error: error.message };
			return {
				attempts: ((data || []) as Record<string, unknown>[]).map(mapRemediationAttemptRow),
			};
		} catch (error) {
			console.error("getDeploymentRemediationAttempts error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	getDeploymentRemediationAttempt: async function (id: string, userID: string) {
		try {
			const supabase = getSupabaseServer();
			const { data, error } = await supabase
				.from("deployment_remediation_attempts")
				.select("*")
				.eq("id", id)
				.eq("user_id", userID)
				.maybeSingle();
			if (error) return { error: error.message };
			if (!data) return { attempt: null };
			return { attempt: mapRemediationAttemptRow((data ?? {}) as Record<string, unknown>) };
		} catch (error) {
			console.error("getDeploymentRemediationAttempt error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	addDeploymentHealthCheck: async function (args: {
		userID: string;
		repoName: string;
		serviceName: string;
		deploymentHistoryId?: string | null;
		url: string;
		status: DeploymentHealthCheck["status"];
		httpStatus?: number | null;
		failureType?: DeploymentHealthCheck["failure_type"];
		latencyMs?: number | null;
		errorMessage?: string | null;
		checkedAt?: string;
	}) {
		try {
			const supabase = getSupabaseServer();
			const { data, error } = await supabase
				.from("deployment_health_checks")
				.insert({
					user_id: args.userID,
					repo_name: args.repoName,
					service_name: args.serviceName,
					deployment_history_id: args.deploymentHistoryId ?? null,
					url: args.url,
					status: args.status,
					http_status: args.httpStatus ?? null,
					failure_type: args.failureType ?? null,
					latency_ms: args.latencyMs ?? null,
					error_message: args.errorMessage ?? null,
					checked_at: args.checkedAt ?? new Date().toISOString(),
				})
				.select("*")
				.single();
			if (error) return { error: error.message };
			return { healthCheck: mapHealthCheckRow((data ?? {}) as Record<string, unknown>) };
		} catch (error) {
			console.error("addDeploymentHealthCheck error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	getDeploymentHealthChecks: async function (
		repoName: string,
		serviceName: string,
		userID: string,
		options?: { deploymentHistoryId?: string | null; limit?: number }
	) {
		try {
			const supabase = getSupabaseServer();
			let query = supabase
				.from("deployment_health_checks")
				.select("*")
				.eq("user_id", userID)
				.eq("repo_name", repoName)
				.eq("service_name", serviceName)
				.order("checked_at", { ascending: false });
			if (options?.deploymentHistoryId) {
				query = query.eq("deployment_history_id", options.deploymentHistoryId);
			}
			if (typeof options?.limit === "number" && options.limit > 0) {
				query = query.limit(options.limit);
			}
			const { data, error } = await query;
			if (error) return { error: error.message };
			return {
				healthChecks: ((data || []) as Record<string, unknown>[]).map(mapHealthCheckRow),
			};
		} catch (error) {
			console.error("getDeploymentHealthChecks error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	updateDeploymentRuntimeState: async function (args: {
		repoName: string;
		serviceName: string;
		userID: string;
		status?: DeployConfig["status"];
		lifecycleState?: DeployConfig["lifecycleState"];
		latestHealthStatus?: DeployConfig["latestHealthStatus"];
		latestHealthCheckAt?: string | null;
		liveUrl?: string | null;
		activeRemediationSessionId?: string | null;
		activeRemediationAttemptCount?: number | null;
	}) {
		try {
			const supabase = getSupabaseServer();
			const updatePayload: Record<string, unknown> = {};
			if (args.status !== undefined) updatePayload.status = args.status;
			if (args.lifecycleState !== undefined) updatePayload.lifecycle_state = args.lifecycleState;
			if (args.latestHealthStatus !== undefined) updatePayload.latest_health_status = args.latestHealthStatus;
			if (args.latestHealthCheckAt !== undefined) updatePayload.latest_health_check_at = args.latestHealthCheckAt;
			if (args.liveUrl !== undefined) updatePayload.live_url = args.liveUrl;
			if (args.activeRemediationSessionId !== undefined) {
				updatePayload.active_remediation_session_id = args.activeRemediationSessionId;
			}
			if (args.activeRemediationAttemptCount !== undefined) {
				updatePayload.active_remediation_attempt_count = args.activeRemediationAttemptCount;
			}
			if (Object.keys(updatePayload).length === 0) return { success: true };

			const { error } = await supabase
				.from("deployments")
				.update(updatePayload)
				.eq("repo_name", args.repoName)
				.eq("service_name", args.serviceName)
				.eq("owner_id", args.userID);

			if (error) return { error: error.message };
			return { success: true };
		} catch (error) {
			console.error("updateDeploymentRuntimeState error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	recordHelpAgentChat: async function (args: {
		userID: string;
		question: string;
		answer: string;
		citations?: string[];
		confidence?: "high" | "medium" | "low";
		model?: string | null;
		mossRetrievalMs?: number | null;
		responseTimeMs?: number | null;
		history?: Array<{ role: "user" | "assistant"; content: string }>;
	}) {
		try {
			const { userID, question, answer } = args;
			if (!userID || !question.trim() || !answer.trim()) {
				return { error: "userID, question, and answer are required" };
			}

			const supabase = getSupabaseServer();
			const { data: inserted, error } = await supabase
				.from("help_agent_chats")
				.insert({
					user_id: userID,
					question: question.trim(),
					answer: answer.trim(),
					citations: Array.isArray(args.citations) ? args.citations : [],
					confidence: args.confidence ?? "low",
					model: args.model ?? null,
					moss_retrieval_ms: typeof args.mossRetrievalMs === "number" ? Math.round(args.mossRetrievalMs) : null,
					response_time_ms: typeof args.responseTimeMs === "number" ? Math.round(args.responseTimeMs) : null,
					chat_history: Array.isArray(args.history) ? args.history : [],
				})
				.select("id")
				.single();

			if (error) return { error };
			return { success: true, id: inserted?.id };
		} catch (error) {
			console.error("recordHelpAgentChat error:", error);
			return { error };
		}
	},

	recordArtifactGeneration: async function (args: {
		userID: string;
		repoName: string;
		serviceName: string;
		source: "scan" | "feedback" | "manual";
		dockerfilesGeneratedCount?: number;
		composeGenerated?: boolean;
		nginxGenerated?: boolean;
	}) {
		try {
			const { userID, repoName, serviceName, source } = args;
			if (!userID || !repoName || !serviceName) return { error: "userID, repoName, serviceName are required" };

			const rows: { user_id: string; repo_name: string; service_name: string; source: string; artifact_type: string; action: string; count: number }[] = [];
			const dockerCount = Math.max(0, Math.floor(args.dockerfilesGeneratedCount ?? 0));
			if (dockerCount > 0) {
				rows.push({ user_id: userID, repo_name: repoName, service_name: serviceName, source, artifact_type: "dockerfile", action: "generated", count: dockerCount });
			}
			if (args.composeGenerated) {
				rows.push({ user_id: userID, repo_name: repoName, service_name: serviceName, source, artifact_type: "compose", action: "generated", count: 1 });
			}
			if (args.nginxGenerated) {
				rows.push({ user_id: userID, repo_name: repoName, service_name: serviceName, source, artifact_type: "nginx", action: "generated", count: 1 });
			}
			if (rows.length === 0) return { success: true, inserted: 0 };

			const supabase = getSupabaseServer();
			const { error } = await supabase.from("artifact_events").insert(rows);
			if (error) return { error: error.message };
			return { success: true, inserted: rows.length };
		} catch (error) {
			console.error("recordArtifactGeneration error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	getDeploymentHistory: async function (repoName: string, serviceName: string, userID: string, page = 1, limit = 10) {
		try {
			const supabase = getSupabaseServer();
			if (!(userID || "").trim()) return { error: "User not found" };

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

			const historyIds = ((rows || []) as Record<string, unknown>[])
				.map((row) => toOptionalTrimmedString(row.id))
				.filter((value): value is string => Boolean(value));
			const [attemptsByHistoryId, healthChecksByHistoryId] = await Promise.all([
				fetchRemediationAttemptsByHistoryIds(historyIds),
				fetchHealthChecksByHistoryIds(historyIds),
			]);

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
				remediationAttempts: attemptsByHistoryId.get(String(row.id ?? "")) ?? [],
				healthChecks: healthChecksByHistoryId.get(String(row.id ?? "")) ?? [],
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
			if (!(userID || "").trim()) return { error: "User doesn't exist" };

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

			const historyIds = ((rows || []) as Record<string, unknown>[])
				.map((row) => toOptionalTrimmedString(row.id))
				.filter((value): value is string => Boolean(value));
			const [attemptsByHistoryId, healthChecksByHistoryId] = await Promise.all([
				fetchRemediationAttemptsByHistoryIds(historyIds),
				fetchHealthChecksByHistoryIds(historyIds),
			]);

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
				remediationAttempts: attemptsByHistoryId.get(String(row.id ?? "")) ?? [],
				healthChecks: healthChecksByHistoryId.get(String(row.id ?? "")) ?? [],
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

	/** One repo_services row for a user + repo URL (normalized, no .git). */
	getRepoServicesByUrl: async function (
		userID: string,
		repoUrl: string
	): Promise<{ error?: string; record?: RepoServicesRecord | null }> {
		try {
			const normalizedUrl = repoUrl.replace(/\.git$/, "").trim();
			if (!userID || !normalizedUrl) return { error: "userID and repo_url are required" };

			const supabase = getSupabaseServer();
			const { data, error } = await supabase
				.from("repo_services")
				.select("repo_url, branch, repo_owner, repo_name, services, is_monorepo, updated_at")
				.eq("user_id", userID)
				.eq("repo_url", normalizedUrl)
				.maybeSingle();

			if (error) return { error: error.message };
			if (!data) return { record: null };
			const row = data as Record<string, unknown>;
			const record: RepoServicesRecord = {
				repo_url: row.repo_url as string,
				branch: row.branch as string,
				repo_owner: row.repo_owner as string,
				repo_name: row.repo_name as string,
				services: (row.services as DetectedServiceInfo[]) ?? [],
				is_monorepo: (row.is_monorepo as boolean) ?? false,
				updated_at: row.updated_at as string,
			};
			return { record };
		} catch (err) {
			console.error("getRepoServicesByUrl error:", err);
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
