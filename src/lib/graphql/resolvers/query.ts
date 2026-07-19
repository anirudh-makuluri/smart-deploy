/**
 * GraphQL Query Resolvers
 * 
 * Handles all read-only operations.
 * Extracted from /api/graphql/route.ts executeOperation function.
 */

import { dbHelper } from "@/db-helper";
import { ensureUserAndRepos } from "@/lib/sessionHelpers";
import { resolveDeploymentStatus } from "@/lib/deploymentStatus";
import { GraphQLContext, requireUser, withTiming } from "../context";
import { hostedUrlFromSubdomain } from "@/lib/hostedUrl";
import { isEcsCloudResources } from "@/lib/cloudResources";
import { getEcsServiceLogs } from "@/lib/aws/ecsCloudWatchLogs";
import {
	fetchAndBuildRepo,
	fetchLatestCommit,
	sortAndLimitRepos,
	sortReposByLatestCommit,
} from "@/lib/graphql/helpers";

// ──────────────────────────────────────────────────────────────
// Query Resolvers
// ──────────────────────────────────────────────────────────────

/**
 * Query.appOverview
 * Returns all repos, deployments, and services for authenticated user
 */
export async function appOverview(_: unknown, __: unknown, ctx: GraphQLContext) {
	return withTiming("appOverview", async () => {
		const userID = requireUser(ctx);
		const startedAt = Date.now();

		const reposPromise = withTiming("appOverview.ensureUserAndRepos", async () =>
			ensureUserAndRepos(ctx.session as any)
		);
		const deploymentsPromise = withTiming("appOverview.getUserDeployments", async () =>
			dbHelper.getUserDeployments(userID)
		);
		const servicesPromise = withTiming("appOverview.getUserRepoRecords", async () =>
			dbHelper.getUserRepoRecords(userID)
		);

		const [{ repoList }, deploymentsRes, servicesRes] = await Promise.all([
			reposPromise,
			deploymentsPromise,
			servicesPromise,
		]);

		if (deploymentsRes.error) throw new Error(String(deploymentsRes.error));
		if (servicesRes.error) throw new Error(String(servicesRes.error));

		console.debug(`[GraphQL] appOverview total backend time ${Date.now() - startedAt}ms`);

		return {
			repoList: sortAndLimitRepos(repoList),
			deployments: (deploymentsRes.deployments ?? []).map(transformDeployment),
			repoRecords: servicesRes.records ?? [],
		};
	});
}

/**
 * Query.repoDeployments
 * Returns all deployments for a specific repo
 */
export async function repoDeployments(
	_: unknown,
	{ repoName }: { repoName: string },
	ctx: GraphQLContext
) {
	return withTiming("repoDeployments", async () => {
		const userID = requireUser(ctx);
		const response = await dbHelper.getDeploymentsByRepo(userID, repoName);
		if (response.error) throw new Error(String(response.error));
		return (response.deployments ?? []).map(transformDeployment);
	});
}

/**
 * Query.repoRecord
 * Returns a single detected record for a user repo
 */
export async function repoRecord(
	_: unknown,
	{ owner, repo }: { owner: string; repo: string },
	ctx: GraphQLContext
) {
	return withTiming("repoRecord", async () => {
		const userID = requireUser(ctx);
		const ownerTrimmed = String(owner ?? "").trim();
		const repoTrimmed = String(repo ?? "").trim();

		if (!ownerTrimmed || !repoTrimmed) {
			throw new Error("Owner and repo are required");
		}

		const repoUrl = `https://github.com/${ownerTrimmed}/${repoTrimmed}`.replace(/\.git$/i, "");
		const directResponse = await dbHelper.getRepoServicesByUrl(userID, repoUrl);
		if (directResponse.error) throw new Error(String(directResponse.error));
		if (directResponse.record) return directResponse.record;

		// Fall back to a case-insensitive owner/repo match in case the URL casing differs.
		const allRecordsResponse = await dbHelper.getUserRepoRecords(userID);
		if (allRecordsResponse.error) throw new Error(String(allRecordsResponse.error));

		const ownerLower = ownerTrimmed.toLowerCase();
		const repoLower = repoTrimmed.toLowerCase();

		return (
			allRecordsResponse.records?.find(
				(record) =>
					record.repo_owner.toLowerCase() === ownerLower &&
					record.repo_name.toLowerCase() === repoLower
			) ?? null
		);
	});
}

/**
 * Query.repoRecords
 * Returns detected records for all user repos
 */
export async function repoRecords(_: unknown, __: unknown, ctx: GraphQLContext) {
	const userID = requireUser(ctx);
	const response = await dbHelper.getUserRepoRecords(userID);
	if (response.error) throw new Error(String(response.error));
	return response.records ?? [];
}

/**
 * Query.resolveRepo
 * Fetches and syncs a repository from GitHub
 */
export async function resolveRepo(
	_: unknown,
	{ owner, repo }: { owner: string; repo: string },
	ctx: GraphQLContext
) {
	return withTiming("resolveRepo", async () => {
		const userID = requireUser(ctx);
		if (!ctx.githubToken) throw new Error("GitHub not connected");

		const ownerTrimmed = (owner ?? "").trim();
		const repoTrimmed = (repo ?? "").trim();
		if (!ownerTrimmed || !repoTrimmed) throw new Error("Owner and repo are required");

		const repoData = await fetchAndBuildRepo(ownerTrimmed, repoTrimmed, ctx.githubToken);

		try {
			await dbHelper.syncUserRepos(userID, [repoData]);
		} catch (error) {
			// Resolving the repository is sufficient to render its page. A transient
			// catalog-sync failure must not hide an otherwise valid GitHub response.
			console.error("[GraphQL] resolveRepo failed to sync repository:", error);
		}

		return repoData;
	});
}

/**
 * Query.latestCommit
 * Fetches the latest commit on a branch
 */
export async function latestCommit(
	_: unknown,
	{ owner, repo, branch }: { owner: string; repo: string; branch?: string },
	ctx: GraphQLContext
) {
	return withTiming("latestCommit", async () => {
		if (!ctx.githubToken) throw new Error("GitHub not connected");

		const ownerTrimmed = (owner ?? "").trim();
		const repoTrimmed = (repo ?? "").trim();
		if (!ownerTrimmed || !repoTrimmed) throw new Error("Owner and repo are required");

		let branchTrimmed = (branch ?? "").trim();

		// If no branch specified, fetch default branch from GitHub
		if (!branchTrimmed) {
			const metaRes = await fetch(`https://api.github.com/repos/${ownerTrimmed}/${repoTrimmed}`, {
				headers: {
					Authorization: `token ${ctx.githubToken}`,
					Accept: "application/vnd.github+json",
				},
			});
			if (!metaRes.ok) {
				const err = await metaRes.json().catch(() => ({}));
				throw new Error(String((err as any)?.message ?? "Failed to load repository"));
			}
			const meta = (await metaRes.json()) as { default_branch?: string };
			branchTrimmed = meta.default_branch?.trim() ?? "";
		}
		if (!branchTrimmed) throw new Error("Could not resolve a branch for this repository");

		const commitData = await fetchLatestCommit(ownerTrimmed, repoTrimmed, branchTrimmed, ctx.githubToken);

		return commitData;
	});
}

/**
 * Query.deploymentHistory
 * Paginated deployment history for a specific service
 */
export async function deploymentHistory(
	_: unknown,
	{
		repoName,
		serviceName,
		page,
		limit,
	}: { repoName: string; serviceName: string; page?: number; limit?: number },
	ctx: GraphQLContext
) {
	return withTiming("deploymentHistory", async () => {
		const userID = requireUser(ctx);
		const repoNameStr = String(repoName ?? "");
		const serviceNameStr = String(serviceName ?? "");
		const pageNum = Number(page ?? 1);
		const limitNum = Number(limit ?? 10);

		if (!repoNameStr || !serviceNameStr) {
			throw new Error("repoName and serviceName are required");
		}

		const response = await dbHelper.getDeploymentHistory(
			repoNameStr,
			serviceNameStr,
			userID,
			pageNum,
			limitNum
		);
		if (response.error) throw new Error(String(response.error));

		return {
			history: response.history ?? [],
			page: response.page ?? Math.max(1, pageNum),
			limit: response.limit ?? Math.max(1, limitNum),
			total: response.total ?? 0,
		};
	});
}

/**
 * Query.deploymentHistoryAll
 * Paginated deployment history for all deployments of authenticated user
 */
export async function deploymentHistoryAll(
	_: unknown,
	{ page, limit }: { page?: number; limit?: number },
	ctx: GraphQLContext
) {
	return withTiming("deploymentHistoryAll", async () => {
		const userID = requireUser(ctx);
		const pageNum = Number(page ?? 1);
		const limitNum = Number(limit ?? 10);

		const response = await dbHelper.getAllDeploymentHistory(userID, pageNum, limitNum);
		if (response.error) throw new Error(String(response.error));

		return {
			history: response.history ?? [],
			page: response.page ?? Math.max(1, pageNum),
			limit: response.limit ?? Math.max(1, limitNum),
			total: response.total ?? 0,
		};
	});
}

/**
 * Query.session
 * Returns current session info with user repos
 */
export async function session(
	_: unknown,
	{ limit }: { limit?: number },
	ctx: GraphQLContext
) {
	return withTiming("session", async () => {
		const userID = requireUser(ctx);
		const { repoList } = await ensureUserAndRepos(ctx.session as any);

		const limitNum = Number(limit ?? 0);
		const shouldApplyLimit = Number.isFinite(limitNum) && limitNum > 0;
		const sortedRepos = sortReposByLatestCommit(repoList);

		return {
			userID,
			name: (ctx.session as any)?.user?.name ?? null,
			image: (ctx.session as any)?.user?.image ?? null,
			repoList: shouldApplyLimit ? sortedRepos.slice(0, limitNum) : sortedRepos,
		};
	});
}

/**
 * Query.serviceLogs
 * Fetches logs for an AWS service
 */
export async function serviceLogs(
	_: unknown,
	{
		repoName,
		serviceName,
		limit,
	}: { repoName?: string; serviceName: string; limit?: number },
	ctx: GraphQLContext
) {
	return withTiming("serviceLogs", async () => {
		const repoNameStr = String(repoName ?? "").trim();
		const serviceNameStr = String(serviceName ?? "").trim();
		let limitNum = Number(limit ?? 50);

		if (!Number.isFinite(limitNum) || limitNum <= 0) limitNum = 50;
		limitNum = Math.min(limitNum, 5000);

		if (!serviceNameStr) {
			throw new Error("serviceName is required");
		}

		if (repoNameStr) {
			const deploymentRes = await dbHelper.getDeployment(repoNameStr, serviceNameStr);
			const deployConfig = deploymentRes.deployment;
			if (!deployConfig) {
				throw new Error("Deployment not found");
			}
			
			const ecsResources = isEcsCloudResources(deployConfig?.cloudResources)
				? deployConfig.cloudResources
				: null;

			if (ecsResources) {
				const logs = await getEcsServiceLogs({
					ecs: ecsResources,
					limit: limitNum,
				});
				return {
					logs,
					source: "ecs",
				};
			}
		}

		return {
			logs: [],
			source: "ecs",
		};
	});
}

// ──────────────────────────────────────────────────────────────
// Helper Functions
// ──────────────────────────────────────────────────────────────

/**
 * Map database cloudProvider to GraphQL enum value
 */
function mapCloudProviderToEnum(provider: string | null | undefined): string | null {
	if (!provider) return null;
	
	const providerMap: Record<string, string> = {
		"aws": "aws",
		"gcp": "gcp",
	};
	
	return providerMap[provider.toLowerCase()] || null;
}

/**
 * Map database deploymentTarget to GraphQL enum value
 */
function mapDeploymentTargetToEnum(target: string | null | undefined): string | null {
	if (!target) return null;
	
	const targetMap: Record<string, string> = {
		"ecs": "ecs",
		"static_s3": "static_s3",
	};
	
	return targetMap[target.toLowerCase().replace(/-/g, "_")] || null;
}

/**
 * Transform deployment from database format to GraphQL format
 * Spreads JSONB data fields to root level
 * 
 * Note: branch and url are stored in JSONB data column and populated
 * when user opens repo page. Use empty string as fallback for missing values.
 */
function transformDeployment(deployment: any) {
	// Helper to convert empty objects to null
	const nullifyIfEmpty = (obj: any) => {
		if (!obj || (typeof obj === "object" && Object.keys(obj).length === 0)) {
			return null;
		}
		return obj;
	};

	const hostedSubdomain = deployment.hostedSubdomain ?? null;

	return {
		id: deployment.id,
		repoName: deployment.repoName,
		serviceName: deployment.serviceName,
		status: resolveDeploymentStatus({
			status: deployment.status,
			hostedSubdomain,
			screenshotUrl: deployment.screenshotUrl,
		}),
		firstDeployment: deployment.firstDeployment,
		lastDeployment: deployment.lastDeployment,
		revision: deployment.revision,
		repoUrl: deployment.repoUrl || "",
		branch: deployment.branch || "main",
		responseId: deployment.responseId ?? null,
		commitSha: deployment.commitSha || undefined,
		hostedSubdomain: hostedSubdomain || undefined,
		hostedUrl: hostedUrlFromSubdomain(hostedSubdomain) || undefined,
		screenshotUrl: deployment.screenshotUrl || undefined,
		scanResults: deployment.scanResults || {},
		cloudProvider: deployment.cloudProvider ? mapCloudProviderToEnum(deployment.cloudProvider) : null,
		deploymentTarget: deployment.deploymentTarget ? mapDeploymentTargetToEnum(deployment.deploymentTarget) : null,
		region: deployment.region || undefined,
		secretsArn: deployment.secretsArn || undefined,
		cloudResources: nullifyIfEmpty(deployment.cloudResources),
	};
}
