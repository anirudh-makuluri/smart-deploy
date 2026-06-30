import { getSupabaseServer } from "./lib/supabaseServer";
import { getDbPool } from "./lib/dbPool";
import { DeployConfig, DeploymentHistoryEntry, DeployStep, repoType, DetectedServiceInfo, RepoRecord, StaticServiceType } from "./app/types";
import type { DeployLogLine, DeployStepSummary } from "./lib/aws/deployRunLogs";
import { deployStepsFromLogLines } from "./lib/aws/deployRunLogs";
import { withDeployInfraDefaults } from "./lib/deployInfraDefaults";
import { generateDefaultHostedSubdomain, normalizeHostedSubdomain } from "./lib/hostedUrl";
import { isDraftDeploymentStatus, normalizeDeploymentStatus, resolveDeploymentStatus } from "./lib/deploymentStatus";

function hasOwnKey<T extends object>(obj: T, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

function toOptionalTrimmedString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
	return UUID_RE.test(value);
}

function resolveAnalysisResponseId(
	explicitResponseId: string | null | undefined,
	payloadResponseId: string | null | undefined,
	existingResponseId: string | null | undefined
): string {
	const candidates = [explicitResponseId, payloadResponseId, existingResponseId];
	for (const candidate of candidates) {
		if (candidate && isValidUuid(candidate)) return candidate;
	}
	return crypto.randomUUID();
}

function normalizeScanResults(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (Object.keys(record).length === 0) return null;
	return record;
}

function normalizeStaticServiceType(value: unknown): StaticServiceType | undefined {
	return value === "vite" ||
		value === "cra" ||
		value === "vue" ||
		value === "angular" ||
		value === "svelte" ||
		value === "astro" ||
		value === "next-export" ||
		value === "static-html"
		? value
		: undefined;
}

function normalizeDetectedServiceInfo(value: unknown): DetectedServiceInfo | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : "";
	const path = typeof record.path === "string" && record.path.trim() ? record.path.trim() : ".";
	if (!name) return null;

	return {
		name,
		path,
		language: typeof record.language === "string" && record.language.trim() ? record.language : "unknown",
		framework: typeof record.framework === "string" && record.framework.trim() ? record.framework : undefined,
		port: typeof record.port === "number" ? record.port : null,
		deployMode: "container",
		serviceType: normalizeStaticServiceType(record.serviceType),
	};
}

function normalizeDetectedServiceList(value: unknown): DetectedServiceInfo[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => normalizeDetectedServiceInfo(item))
		.filter((item): item is DetectedServiceInfo => Boolean(item));
}

type DeploymentDbRow = Record<string, unknown>;
type AnalysisPayloadMap = Map<string, Record<string, unknown>>;
async function upsertAnalysisResponse(args: {
	id: string;
	payload: Record<string, unknown>;
	repoUrl: string;
	commitSha: string | null;
	serviceName: string;
	packagePath?: string | null;
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
				package_path: toOptionalTrimmedString(args.packagePath) ?? ".",
				service_name: args.serviceName || null,
				from_cache: false,
				passed: args.payload.build_status === "passed" || args.payload.build_status === "partial",
				payload: args.payload,
			},
			{ onConflict: "id" }
		);
	if (error) throw new Error(error.message);
}

function toSqlInsertValue(value: unknown): unknown {
	if (value == null) return value;
	if (typeof value === "object") {
		return JSON.stringify(value);
	}
	return value;
}

async function insertDeploymentRow(row: Record<string, unknown>): Promise<void> {
	const keys = Object.keys(row);
	const placeholders = keys.map((_, index) => `$${index + 1}`);
	const values = keys.map((key) => toSqlInsertValue(row[key]));
	const sql = `insert into deployments (${keys.map((key) => `"${key}"`).join(", ")}) values (${placeholders.join(", ")})`;
	await getDbPool().query(sql, values);
}

function quoteSqlIdentifier(identifier: string): string {
	return `"${identifier.replace(/"/g, "\"\"")}"`;
}

async function insertTableRow(
	tableName: string,
	row: Record<string, unknown>,
	options?: {
		returning?: string[];
	}
): Promise<Record<string, unknown> | null> {
	const keys = Object.keys(row);
	const placeholders = keys.map((_, index) => `$${index + 1}`);
	const values = keys.map((key) => toSqlInsertValue(row[key]));
	const returningClause = options?.returning?.length
		? ` returning ${options.returning.map((column) => quoteSqlIdentifier(column)).join(", ")}`
		: "";
	const sql = `insert into ${quoteSqlIdentifier(tableName)} (${keys.map((key) => quoteSqlIdentifier(key)).join(", ")}) values (${placeholders.join(", ")})${returningClause}`;
	const result = await getDbPool().query(sql, values);
	return (result.rows?.[0] as Record<string, unknown> | undefined) ?? null;
}

async function insertTableRows(tableName: string, rows: Record<string, unknown>[]): Promise<void> {
	if (rows.length === 0) return;

	const keys = Object.keys(rows[0]);
	const values: unknown[] = [];
	const valueGroups = rows.map((row, rowIndex) => {
		const placeholders = keys.map((key, columnIndex) => {
			values.push(toSqlInsertValue(row[key]));
			return `$${rowIndex * keys.length + columnIndex + 1}`;
		});
		return `(${placeholders.join(", ")})`;
	});
	const sql = `insert into ${quoteSqlIdentifier(tableName)} (${keys.map((key) => quoteSqlIdentifier(key)).join(", ")}) values ${valueGroups.join(", ")}`;
	await getDbPool().query(sql, values);
}

async function updateTableRows(
	tableName: string,
	payload: Record<string, unknown>,
	filters: Record<string, unknown>
): Promise<void> {
	const payloadKeys = Object.keys(payload);
	if (payloadKeys.length === 0) return;

	const filterKeys = Object.keys(filters);
	const values = [
		...payloadKeys.map((key) => toSqlInsertValue(payload[key])),
		...filterKeys.map((key) => toSqlInsertValue(filters[key])),
	];
	const setClause = payloadKeys
		.map((key, index) => `${quoteSqlIdentifier(key)} = $${index + 1}`)
		.join(", ");
	const whereClause = filterKeys
		.map((key, index) => `${quoteSqlIdentifier(key)} = $${payloadKeys.length + index + 1}`)
		.join(" and ");
	const sql = `update ${quoteSqlIdentifier(tableName)} set ${setClause} where ${whereClause}`;
	await getDbPool().query(sql, values);
}

async function upsertTableRows(
	tableName: string,
	rows: Record<string, unknown>[],
	conflictColumns: string[]
): Promise<void> {
	if (rows.length === 0) return;

	const keys = Object.keys(rows[0]);
	const values: unknown[] = [];
	const valueGroups = rows.map((row, rowIndex) => {
		const placeholders = keys.map((key, columnIndex) => {
			values.push(toSqlInsertValue(row[key]));
			return `$${rowIndex * keys.length + columnIndex + 1}`;
		});
		return `(${placeholders.join(", ")})`;
	});
	const updateColumns = keys.filter((key) => !conflictColumns.includes(key));
	const updateClause = updateColumns
		.map((key) => `${quoteSqlIdentifier(key)} = excluded.${quoteSqlIdentifier(key)}`)
		.join(", ");
	const sql = `insert into ${quoteSqlIdentifier(tableName)} (${keys.map((key) => quoteSqlIdentifier(key)).join(", ")}) values ${valueGroups.join(", ")} on conflict (${conflictColumns.map((key) => quoteSqlIdentifier(key)).join(", ")}) do update set ${updateClause}`;
	await getDbPool().query(sql, values);
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
function rowToDeployConfig(row: Record<string, unknown>): DeployConfig {
	const {
		id,
		repo_name,
		service_name,
		owner_id,
		repo_url,
		branch,
		commit_sha,
		hosted_subdomain,
		screenshot_url,
		cloud_provider,
		deployment_target,
		region,
		status,
		first_deployment,
		last_deployment,
		revision,
		response_id,
		cloud_resources,
		secrets_arn,
		scan_results,
	} = row;

	const hostedSubdomain = toOptionalTrimmedString(hosted_subdomain);
	const normalized = withDeployInfraDefaults({
		id: String(id ?? ""),
		repoName: String(repo_name || ""),
		serviceName: String(service_name || ""),
		repoUrl: String(repo_url || ""),
		branch: String(branch || "main"),
		responseId: toOptionalTrimmedString(response_id),
		commitSha: (commit_sha as string | null) ?? null,
		hostedSubdomain,
		screenshotUrl: (screenshot_url as string | null) ?? null,
		status: resolveDeploymentStatus({
			status: status as string | null | undefined,
			hostedSubdomain,
			screenshotUrl: (screenshot_url as string | null | undefined) ?? null,
		}),
		firstDeployment: (first_deployment as string | null) ?? null,
		lastDeployment: (last_deployment as string | null) ?? null,
		revision: (revision as number | null) ?? 0,
		cloudProvider: (cloud_provider as "aws" | "gcp") || "aws",
		deploymentTarget: (deployment_target as DeployConfig["deploymentTarget"]) || "ecs",
		region: String(region || ""),
		secretsArn: toOptionalTrimmedString(secrets_arn),
		cloudResources: (cloud_resources as DeployConfig["cloudResources"]) ?? null,
		scanResults: (scan_results || {}) as DeployConfig["scanResults"],
	});
	return normalized;
}

/**
 * Transform DeployConfig (camelCase) to database row (snake_case)
 */
function deployConfigToRow(
	config: Partial<DeployConfig> & Record<string, unknown>,
	options?: {
		includeStatus?: boolean;
		resolvedStatus?: DeployConfig["status"];
	}
): Record<string, unknown> {
	const row: Record<string, unknown> = {};
	if (hasOwnKey(config, "repoUrl")) row.repo_url = config.repoUrl;
	if (hasOwnKey(config, "branch")) row.branch = config.branch;
	if (hasOwnKey(config, "commitSha")) row.commit_sha = config.commitSha;
	if (hasOwnKey(config, "hostedSubdomain")) row.hosted_subdomain = config.hostedSubdomain;
	if (hasOwnKey(config, "screenshotUrl")) row.screenshot_url = config.screenshotUrl;
	if (hasOwnKey(config, "cloudProvider")) row.cloud_provider = config.cloudProvider;
	if (hasOwnKey(config, "deploymentTarget")) row.deployment_target = config.deploymentTarget;
	if (hasOwnKey(config, "region")) row.region = config.region;
	if (options?.includeStatus) {
		row.status = normalizeDeploymentStatus(options.resolvedStatus ?? (config.status as string | null | undefined));
	}
	if (hasOwnKey(config, "cloudResources")) row.cloud_resources = config.cloudResources;
	if (hasOwnKey(config, "secretsArn")) row.secrets_arn = config.secretsArn ?? null;
	return row;
}

function rowToDeploymentHistoryEntryFromRun(row: Record<string, unknown>): DeploymentHistoryEntry {
	const stepSummary = (row.step_summary as DeployStepSummary[]) ?? [];
	const logTail = (row.log_tail as DeployLogLine[]) ?? [];
	const steps =
		stepSummary.length > 0
			? deployStepsFromLogLines(stepSummary, logTail)
			: logTail.length > 0
				? deployStepsFromLogLines([], logTail)
				: [];

	return {
		id: row.id as string,
		repo_name: row.repo_name as string,
		service_name: row.service_name as string,
		timestamp: (row.started_at as string) ?? new Date().toISOString(),
		success: Boolean(row.success),
		steps,
		configSnapshot: {},
		releaseArtifact: (row.release_artifact as DeploymentHistoryEntry["releaseArtifact"]) ?? {},
		commitSha: (row.commit_sha as string | undefined) ?? undefined,
		commitMessage: (row.commit_message as string | undefined) ?? undefined,
		branch: (row.branch as string | undefined) ?? undefined,
		durationMs: row.duration_ms as number | undefined,
		failureCode: (row.failure_code as DeploymentHistoryEntry["failureCode"]) ?? null,
		failureClassification: (row.failure_classification as DeploymentHistoryEntry["failureClassification"]) ?? null,
		logRef: (row.log_ref as string | null) ?? null,
	};
}

async function fetchDeploymentRuns(args: {
	accountId: string;
	repoName?: string;
	serviceName?: string;
	page: number;
	limit: number;
}): Promise<{ history: DeploymentHistoryEntry[]; total: number; page: number; limit: number; error?: unknown }> {
	const supabase = getSupabaseServer();
	const from = (args.page - 1) * args.limit;
	const to = from + args.limit - 1;

	let query = supabase
		.from("deployment_runs")
		.select("*", { count: "exact" })
		.eq("user_id", args.accountId)
		.order("started_at", { ascending: false })
		.range(from, to);

	if (args.repoName && args.serviceName) {
		query = query.eq("repo_name", args.repoName).eq("service_name", args.serviceName);
	}

	const { data, error, count } = await query;
	if (error) return { error, history: [], total: 0, page: args.page, limit: args.limit };

	const history = (data ?? []).map((row) =>
		rowToDeploymentHistoryEntryFromRun(row as Record<string, unknown>)
	);

	return {
		history,
		total: count ?? history.length,
		page: args.page,
		limit: args.limit,
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

	const rowUrl = normalizeRepoIdentifier(String(row.repo_url ?? ""));
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
	updateDeployments: async function (deployConfig: DeployConfig, accountId: string) {
		try {
			const { repoName, serviceName } = deployConfig;
			if (!repoName || !serviceName) return { error: "repoName and serviceName are required" };

			const supabase = getSupabaseServer();
			const configRecord = deployConfig as unknown as Record<string, unknown>;
			const hasStatusInput = hasOwnKey(configRecord, "status");
			const explicitStatus = hasStatusInput
				? normalizeDeploymentStatus(configRecord.status as string | null | undefined)
				: null;
			const hasScanResultsInput = hasOwnKey(configRecord, "scanResults");
			const rawScanResultsInput = configRecord.scanResults;
			const rawScanResults = hasScanResultsInput ? normalizeScanResults(configRecord.scanResults) : null;
			const hasResponseIdInput = hasOwnKey(configRecord, "responseId");
			const explicitResponseId = hasResponseIdInput
				? toOptionalTrimmedString(configRecord.responseId)
				: undefined;

			if (explicitStatus === "stopped") {
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
			const currentStatus = normalizeDeploymentStatus(existing?.status as string | null | undefined);
			const nextStatus = explicitStatus ?? currentStatus ?? "didnt_deploy";

			let nextResponseId: string | null =
				explicitResponseId === undefined
					? toOptionalTrimmedString(existing?.response_id)
					: (explicitResponseId ?? toOptionalTrimmedString(existing?.response_id));
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
					nextResponseId = resolveAnalysisResponseId(
						explicitResponseId,
						payloadResponseId,
						toOptionalTrimmedString(existing?.response_id)
					);
					try {
						await upsertAnalysisResponse({
							id: nextResponseId,
							payload: { ...rawScanResults, response_id: nextResponseId },
							repoUrl: String(deployConfig.repoUrl ?? existing?.repo_url ?? ""),
							commitSha: toOptionalTrimmedString(rawScanResults.commit_sha) ?? deployConfig.commitSha ?? null,
							serviceName,
							packagePath: toOptionalTrimmedString(rawScanResults.package_path),
						});
					} catch (analysisError) {
						console.error("updateDeployments: analysis_responses upsert failed (continuing):", analysisError);
					}
				}
			}

			if (!existing) {
				const now = new Date().toISOString();
				const isDraft = isDraftDeploymentStatus(nextStatus);
				// Create new deployment with provided data
				const insertRow = deployConfigToRow(configRecord, {
					includeStatus: true,
					resolvedStatus: nextStatus,
				});
				if (!normalizeHostedSubdomain(insertRow.hosted_subdomain as string | null | undefined)) {
					insertRow.hosted_subdomain = generateDefaultHostedSubdomain(repoName);
				}
				const insertPayload: Record<string, unknown> = {
					id: crypto.randomUUID(),
					repo_name: repoName,
					service_name: serviceName,
					owner_id: accountId,
					first_deployment: nextStatus === "running" ? now : null,
					last_deployment: isDraft ? null : now,
					revision: isDraft ? 0 : 1,
					...insertRow,
					response_id: nextResponseId,
				};

				await insertDeploymentRow(insertPayload);
				return { success: "New deployment created and added to user", responseId: nextResponseId };
			}

			// Build update payload
			const inProgressStatuses = new Set<DeployConfig["status"]>(["deploying"]);
			const isAttemptStart =
				(nextStatus === "deploying") &&
				!inProgressStatuses.has(currentStatus);
			const updatePayload: Record<string, unknown> = {
				revision: isAttemptStart ? (existing.revision ?? 0) + 1 : (existing.revision ?? 0),
				...deployConfigToRow(configRecord, {
					includeStatus: hasStatusInput,
					resolvedStatus: nextStatus,
				}),
			};
			if (hasScanResultsInput || hasResponseIdInput) {
				updatePayload.response_id = nextResponseId;
			}

			// Update last_deployment when a fresh attempt starts or a new commit is targeted.
			if (isAttemptStart || deployConfig.commitSha !== existing.commit_sha) {
				updatePayload.last_deployment = new Date().toISOString();
			}

			// Set first_deployment only on the first successful release.
			if (isDraftDeploymentStatus(currentStatus) && nextStatus === "running") {
				updatePayload.first_deployment = new Date().toISOString();
			}

			const { error: updateError } = await supabase
				.from("deployments")
				.update(updatePayload)
				.eq("repo_name", repoName)
				.eq("service_name", serviceName);

			if (updateError) return { error: updateError.message };
			return { success: "Deployment data updated successfully", responseId: nextResponseId };
		} catch (error) {
			console.error("updateDeployments error:", error);
			return { error };
		}
	},

	deleteDeployment: async function (repoName: string, serviceName: string, accountId: string) {
		try {
			if (!repoName || !serviceName || !accountId) return { error: "repoName, serviceName, and user ID are required" };

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
			if (deployment.owner_id !== accountId) return { error: "Unauthorized: deployment does not belong to user" };

			await supabase.from("deployments").delete()
				.eq("repo_name", repoName)
				.eq("service_name", serviceName);

			return { success: "Deployment deleted" };
		} catch (error) {
			console.error("deleteDeployment error:", error);
			return { error };
		}
	},

	listDeploymentsForHealthReconcile: async function () {
		try {
			const supabase = getSupabaseServer();
			const { data: rows, error } = await supabase
				.from("deployments")
				.select("*")
				.in("status", ["running", "failed"]);

			if (error) return { error: error.message };

			const hydratedRows = attachAnalysisPayload(
				(rows || []) as DeploymentDbRow[],
				await fetchAnalysisPayloadMap((rows || []) as DeploymentDbRow[])
			);
			const deployments = hydratedRows.map((row: Record<string, unknown>) => ({
				deployment: rowToDeployConfig(row),
				ownerID: toOptionalTrimmedString(row.owner_id),
			}));
			return { deployments };
		} catch (error) {
			console.error("listDeploymentsForHealthReconcile error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	getUserDeployments: async function (accountId: string) {
		try {
			const supabase = getSupabaseServer();

			const { data: rows, error } = await supabase
				.from("deployments")
				.select("*")
				.eq("owner_id", accountId);

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

	getDeploymentsByRepo: async function (accountId: string, repoIdentifier: string) {
		try {
			const supabase = getSupabaseServer();

			const { data: rows, error } = await supabase
				.from("deployments")
				.select("*")
				.eq("owner_id", accountId);

			if (error) return { error: error.message };

			const hydratedRows = attachAnalysisPayload(
				(rows || []) as DeploymentDbRow[],
				await fetchAnalysisPayloadMap((rows || []) as DeploymentDbRow[])
			);
			const deployments = hydratedRows.flatMap((row: Record<string, unknown>) =>
				matchesRepoIdentifier(row, repoIdentifier) ? [rowToDeployConfig(row)] : []
			);
			return { deployments };
		} catch (error) {
			console.error("getDeploymentsByRepo error:", error);
			return { error };
		}
	},

	deleteDeploymentsByRepo: async function (accountId: string, repoIdentifier: string) {
		try {
			const { deployments, error } = await this.getDeploymentsByRepo(accountId, repoIdentifier);
			if (error) return { error };
			const repoDeployments = deployments ?? [];
			if (repoDeployments.length === 0) return { deleted: 0 };

			const results = await Promise.all(
				repoDeployments.map((deployment) =>
					this.deleteDeployment(deployment.repoName, deployment.serviceName, accountId)
				)
			);
			const failedResult = results.find((result) => result.error);
			if (failedResult?.error) {
				return { error: typeof failedResult.error === "string" ? failedResult.error : String(failedResult.error) };
			}

			return { deleted: repoDeployments.length };
		} catch (error) {
			console.error("deleteDeploymentsByRepo error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	getDeployment: async function (repoName: string, serviceName: string): Promise<{ error?: string; deployment?: DeployConfig }> {
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

	getDeploymentForUser: async function (repoName: string, serviceName: string, accountId: string): Promise<{ error?: string; deployment?: DeployConfig }> {
		try {
			const supabase = getSupabaseServer();
			const { data: row, error } = await supabase
				.from("deployments")
				.select("*")
				.eq("repo_name", repoName)
				.eq("service_name", serviceName)
				.eq("owner_id", accountId)
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
			console.error("getDeploymentForUser error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	updateDeploymentSystem: async function (deployConfig: Partial<DeployConfig> & { repoName: string; serviceName: string }) {
		try {
			const supabase = getSupabaseServer();
			const updatePayload = deployConfigToRow(deployConfig, {
				includeStatus: Object.prototype.hasOwnProperty.call(deployConfig, "status"),
				resolvedStatus: deployConfig.status,
			});
			const { error } = await supabase
				.from("deployments")
				.update(updatePayload)
				.eq("repo_name", deployConfig.repoName)
				.eq("service_name", deployConfig.serviceName);

			if (error) return { error: error.message };
			return { success: "Deployment updated" };
		} catch (error) {
			console.error("updateDeploymentSystem error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	syncUserRepos: async function (userID: string, repoList: repoType[]) {
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

		try {
			await upsertTableRows("user_repos", rows, ["user_id", "repo_name"]);
		} catch (error) {
			throw new Error(`Failed to sync repos: ${error instanceof Error ? error.message : String(error)}`);
		}
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

	createDeploymentRun: async function (args: {
		userId: string;
		repoName: string;
		serviceName: string;
		branch?: string;
		commitSha?: string;
		responseId?: string | null;
	}): Promise<{ error?: unknown; runId?: string }> {
		try {
			const userId = (args.userId || "").trim();
			if (!userId) return { error: "User not found" };
			if (!args.repoName || !args.serviceName) {
				return { error: "repo_name and service_name are required." };
			}

			const inserted = await insertTableRow(
				"deployment_runs",
				{
					user_id: userId,
					repo_name: args.repoName,
					service_name: args.serviceName,
					branch: args.branch ?? null,
					commit_sha: args.commitSha ?? null,
					response_id: args.responseId ?? null,
					log_store: "s3",
				},
				{ returning: ["id"] }
			);

			return { runId: inserted?.id as string | undefined };
		} catch (error) {
			console.error("createDeploymentRun error:", error);
			return { error };
		}
	},

	updateDeploymentRunProgress: async function (
		runId: string,
		userId: string,
		progress: {
			logRef: string;
			stepSummary: DeployStepSummary[];
			logTail: DeployLogLine[];
		}
	): Promise<{ error?: unknown }> {
		try {
			await updateTableRows(
				"deployment_runs",
				{
					log_ref: progress.logRef,
					step_summary: progress.stepSummary,
					log_tail: progress.logTail,
				},
				{ id: runId, user_id: userId }
			);
			return {};
		} catch (error) {
			console.error("updateDeploymentRunProgress error:", error);
			return { error };
		}
	},

	finalizeDeploymentRun: async function (args: {
		runId: string;
		userId: string;
		success: boolean;
		durationMs?: number;
		steps: DeployStep[];
		releaseArtifact?: DeploymentHistoryEntry["releaseArtifact"];
		failureCode?: DeploymentHistoryEntry["failureCode"];
		failureClassification?: DeploymentHistoryEntry["failureClassification"];
		logRef?: string | null;
		stepSummary?: DeployStepSummary[];
		logTail?: DeployLogLine[];
	}): Promise<{ error?: unknown }> {
		try {
			await updateTableRows(
				"deployment_runs",
				{
					finished_at: new Date().toISOString(),
					success: args.success,
					duration_ms: args.durationMs ?? null,
					release_artifact: args.releaseArtifact ?? {},
					failure_code: args.failureCode ?? null,
					failure_classification: args.failureClassification ?? null,
					...(args.logRef ? { log_ref: args.logRef } : {}),
					...(args.stepSummary ? { step_summary: args.stepSummary } : {}),
					...(args.logTail ? { log_tail: args.logTail } : {}),
				},
				{ id: args.runId, user_id: args.userId }
			);
			return {};
		} catch (error) {
			console.error("finalizeDeploymentRun error:", error);
			return { error };
		}
	},

	recordDeploymentAgentMessage: async function (args: {
		userID: string;
		conversationId: string;
		runId: string;
		role: "user" | "assistant";
		content: string;
		metadata: Record<string, unknown>;
	}) {
		try {
			const { userID, conversationId, runId, role, content } = args;
			if (!userID || !conversationId.trim() || !runId || !content.trim()) {
				return { error: "userID, conversationId, runId, and content are required" };
			}
			if (role !== "user" && role !== "assistant") {
				return { error: "role must be user or assistant" };
			}
			if (!isValidUuid(runId)) {
				return { error: "runId must be a valid uuid" };
			}

			const inserted = await insertTableRow(
				"deployment_agent_messages",
				{
					user_id: userID,
					conversation_id: conversationId.trim(),
					run_id: runId,
					role,
					content: content.trim(),
					metadata: args.metadata ?? {},
				},
				{ returning: ["id"] }
			);
			return { success: true, id: inserted?.id };
		} catch (error) {
			console.error("recordDeploymentAgentMessage error:", error);
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

			await insertTableRows("artifact_events", rows);
			return { success: true, inserted: rows.length };
		} catch (error) {
			console.error("recordArtifactGeneration error:", error);
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},

	getDeploymentHistory: async function (repoName: string, serviceName: string, userID: string, page = 1, limit = 10) {
		try {
			if (!(userID || "").trim()) return { error: "User not found" };
			const safePage = Math.max(1, page);
			const safeLimit = Math.max(1, limit);
			const merged = await fetchDeploymentRuns({
				accountId: userID,
				repoName,
				serviceName,
				page: safePage,
				limit: safeLimit,
			});
			if (merged.error) return { error: merged.error };
			return {
				history: merged.history,
				total: merged.total,
				page: merged.page,
				limit: merged.limit,
			};
		} catch (error) {
			console.error("getDeploymentHistory error:", error);
			return { error };
		}
	},

	getAllDeploymentHistory: async function (userID: string, page = 1, limit = 10) {
		try {
			if (!(userID || "").trim()) return { error: "User doesn't exist" };
			const safePage = Math.max(1, page);
			const safeLimit = Math.max(1, limit);
			const merged = await fetchDeploymentRuns({
				accountId: userID,
				page: safePage,
				limit: safeLimit,
			});
			if (merged.error) return { error: merged.error };
			return {
				history: merged.history,
				total: merged.total,
				page: merged.page,
				limit: merged.limit,
			};
		} catch (error) {
			console.error("getAllDeploymentHistory error:", error);
			return { error };
		}
	},

	getLastSuccessfulDeploymentHistory: async function (
		repoName: string,
		serviceName: string,
		userID: string
	): Promise<{ error?: unknown; history?: DeploymentHistoryEntry | null }> {
		try {
			const supabase = getSupabaseServer();
			if (!(userID || "").trim()) return { error: "User doesn't exist" };

			const { data: runRow, error: runError } = await supabase
				.from("deployment_runs")
				.select("*")
				.eq("user_id", userID)
				.eq("repo_name", repoName)
				.eq("service_name", serviceName)
				.eq("success", true)
				.order("started_at", { ascending: false })
				.limit(1)
				.maybeSingle();

			if (runError) return { error: runError };
			return {
				history: runRow
					? rowToDeploymentHistoryEntryFromRun(runRow as Record<string, unknown>)
					: null,
			};
		} catch (error) {
			console.error("getLastSuccessfulDeploymentHistory error:", error);
			return { error };
		}
	},

	getDeploymentHistoryEntryById: async function (
		historyEntryId: string,
		userID: string
	): Promise<{ error?: unknown; history?: DeploymentHistoryEntry | null }> {
		try {
			const supabase = getSupabaseServer();
			if (!(userID || "").trim()) return { error: "User doesn't exist" };
			const entryId = String(historyEntryId ?? "").trim();
			if (!entryId) return { error: "History entry ID is required" };

			const { data: runRow, error: runError } = await supabase
				.from("deployment_runs")
				.select("*")
				.eq("user_id", userID)
				.eq("id", entryId)
				.maybeSingle();

			if (runError) return { error: runError };
			return {
				history: runRow
					? rowToDeploymentHistoryEntryFromRun(runRow as Record<string, unknown>)
					: null,
			};
		} catch (error) {
			console.error("getDeploymentHistoryEntryById error:", error);
			return { error };
		}
	},

	getDeploymentRunLogRef: async function (
		runId: string,
		userID: string
	): Promise<{ error?: unknown; logRef?: string | null }> {
		try {
			const supabase = getSupabaseServer();
			if (!(userID || "").trim()) return { error: "User doesn't exist" };
			const { data, error } = await supabase
				.from("deployment_runs")
				.select("log_ref")
				.eq("user_id", userID)
				.eq("id", runId)
				.maybeSingle();
			if (error) return { error };
			return { logRef: (data?.log_ref as string | null) ?? null };
		} catch (error) {
			console.error("getDeploymentRunLogRef error:", error);
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

			await upsertTableRows(
				"repo_services",
				[{
					user_id: userID,
					repo_url: normalizedUrl,
					branch: payload.branch,
					repo_owner: payload.repo_owner,
					repo_name: payload.repo_name,
					services: payload.services,
					is_monorepo: payload.is_monorepo,
					updated_at: new Date().toISOString(),
				}],
				["user_id", "repo_url"]
			);
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
	): Promise<{ error?: string; record?: RepoRecord | null }> {
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
			const record: RepoRecord = {
				repo_url: row.repo_url as string,
				branch: row.branch as string,
				repo_owner: row.repo_owner as string,
				repo_name: row.repo_name as string,
				services: normalizeDetectedServiceList(row.services),
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
	getUserRepoRecords: async function (userID: string): Promise<{ error?: string; records?: RepoRecord[] }> {
		try {
			const supabase = getSupabaseServer();
			const { data: rows, error } = await supabase
				.from("repo_services")
				.select("repo_url, branch, repo_owner, repo_name, services, is_monorepo, updated_at")
				.eq("user_id", userID)
				.order("updated_at", { ascending: false });

			if (error) return { error: error.message };
			const records: RepoRecord[] = (rows || []).map((r: Record<string, unknown>) => ({
			repo_url: r.repo_url as string,
			branch: r.branch as string,
			repo_owner: r.repo_owner as string,
			repo_name: r.repo_name as string,
			services: normalizeDetectedServiceList(r.services),
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

export const __testing = {
	rowToDeploymentHistoryEntryFromRun,
};

export default dbHelper;
