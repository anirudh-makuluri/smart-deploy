/**
 * GraphQL Mutation Resolvers
 * 
 * Handles all write operations (create, update, delete).
 * Extracted from /api/graphql/route.ts executeOperation function.
 */

import { dbHelper } from "@/db-helper";
import { GraphQLContext, requireUser, withTiming } from "../context";
import { deleteDeploymentForUser, controlDeploymentForUser } from "@/lib/deploymentActions";
import { getGithubRepos } from "@/github-helper";
import { invalidateRepoCache } from "@/lib/sessionHelpers";
import { parseGithubOwnerRepo, fetchRepoMetadata, prepareGithubRepoWorkspace, GithubApiError } from "@/lib/githubRepoArchive";
import { detectMultiService } from "@/lib/multiServiceDetector";
import { buildPrefilledScanResults } from "@/lib/infrastructurePrefill";
import { getSubnetIds } from "@/lib/aws/awsHelpers";
import { configureAlb } from "@/lib/aws/handleEC2";
import { addVercelDnsRecord } from "@/lib/vercelDns";
import {
	fetchAndBuildRepo,
	toDetectedService,
	redactTokenInText,
	normalizeCustomUrlInput,
	configureCustomDomainForDeployment,
	sanitizeSubdomain,
	githubAuthenticatedCloneUrl,
} from "@/lib/graphql/helpers";
import config from "@/config";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

// ──────────────────────────────────────────────────────────────
// Mutation Resolvers
// ──────────────────────────────────────────────────────────────

/**
 * Mutation.updateDeployment
 * Updates deployment configuration
 */
export async function updateDeployment(
	_: unknown,
	{ config }: { config: Record<string, unknown> },
	ctx: GraphQLContext
) {
	return withTiming("updateDeployment", async () => {
		const userID = requireUser(ctx);
		const response = await dbHelper.updateDeployments(config as never, userID);

		if (response.error) throw new Error(String(response.error));

		return {
			status: "success",
			message: response.success ?? null,
		};
	});
}

/**
 * Mutation.deleteDeployment
 * Deletes a deployment and related resources (Vercel DNS records, etc.)
 */
export async function deleteDeployment(
	_: unknown,
	{ payload }: { payload: { repoName?: string; serviceName?: string } },
	ctx: GraphQLContext
) {
	return withTiming("deleteDeployment", async () => {
		const userID = requireUser(ctx);
		const repoName = String(payload.repoName ?? "");
		const serviceName = String(payload.serviceName ?? "");

		const result = await deleteDeploymentForUser({
			repoName,
			serviceName,
			userID,
		});

		if (result.status === "error") {
			throw new Error(result.message ?? "Failed to delete deployment");
		}

		return {
			status: "success",
			message: result.message ?? null,
			vercelDnsDeleted: result.vercelDnsDeleted ?? 0,
		};
	});
}

/**
 * Mutation.deploymentControl
 * Controls deployment state (pause, resume, stop)
 */
export async function deploymentControl(
	_: unknown,
	{
		input,
	}: {
		input: {
			repoName?: string;
			serviceName?: string;
			action?: "pause" | "resume" | "stop";
		};
	},
	ctx: GraphQLContext
) {
	return withTiming("deploymentControl", async () => {
		const userID = requireUser(ctx);

		const result = await controlDeploymentForUser({
			repoName: input.repoName,
			serviceName: input.serviceName,
			action: input.action ?? "pause",
			userID,
		});

		if (result.status === "error") {
			throw new Error(result.message ?? "Failed to control deployment");
		}

		return {
			status: "success",
			message: result.message ?? null,
		};
	});
}

/**
 * Mutation.detectServices
 * Detects services in a repository by cloning and analyzing it
 */
export async function detectServices(
	_: unknown,
	{ url, branch }: { url: string; branch?: string },
	ctx: GraphQLContext
) {
	return withTiming("detectServices", async () => {
		const userID = requireUser(ctx);
		if (!ctx.token) throw new Error("Missing access token");

		const urlTrimmed = String(url ?? "").trim();
		let branchTrimmed = String(branch ?? "").trim();

		if (!urlTrimmed) throw new Error("Missing url");

		let repoUrl = urlTrimmed.replace(/\.git$/, "");
		if (!repoUrl.startsWith("http")) {
			repoUrl = repoUrl.includes("/") ? `https://github.com/${repoUrl}` : "";
		}
		if (!repoUrl || !repoUrl.includes("github.com")) {
			throw new Error("Invalid repository URL");
		}

		const parsed = parseGithubOwnerRepo(repoUrl);
		if (!parsed) throw new Error("Could not parse GitHub owner/repo from URL");

		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-services-"));

		try {
			if (!branchTrimmed) {
				const { default_branch } = await fetchRepoMetadata(parsed.owner, parsed.repo, ctx.token);
				branchTrimmed = default_branch;
			}

			const { repoRoot, effectiveBranch } = await prepareGithubRepoWorkspace(
				parsed.owner,
				parsed.repo,
				branchTrimmed,
				ctx.token,
				tmpDir
			);

			const multiServiceConfig = detectMultiService(repoRoot);
			const services =
				multiServiceConfig.services.length > 0
					? multiServiceConfig.services.map((s: any) => toDetectedService(s, repoRoot))
					: [{ name: "app", path: ".", language: "node", port: 3000 }];

			await dbHelper.upsertRepoServices(userID, repoUrl, {
				branch: effectiveBranch,
				repo_owner: parsed.owner,
				repo_name: parsed.repo,
				services,
				is_monorepo: multiServiceConfig.isMonorepo ?? false,
			});

			return {
				isMonorepo: multiServiceConfig.isMonorepo ?? false,
				isMultiService: multiServiceConfig.isMultiService ?? false,
				services,
				packageManager: multiServiceConfig.packageManager ?? null,
			};
		} catch (inner: unknown) {
			const message = inner instanceof GithubApiError 
				? `Failed to fetch repository from GitHub: ${redactTokenInText(inner.message, ctx.token)}`
				: inner instanceof Error
					? inner.message
					: "Failed to detect services";
			throw new Error(message);
		} finally {
			try {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			} catch {
				// ignore cleanup errors
			}
		}
	});
}

/**
 * Mutation.addPublicRepo
 * Adds a public repository from GitHub
 */
export async function addPublicRepo(
	_: unknown,
	{ owner, repo }: { owner: string; repo: string },
	ctx: GraphQLContext
) {
	return withTiming("addPublicRepo", async () => {
		const userID = requireUser(ctx);
		if (!ctx.token) throw new Error("Missing access token");

		const ownerTrimmed = String(owner ?? "").trim();
		const repoTrimmed = String(repo ?? "").trim();
		if (!ownerTrimmed || !repoTrimmed) throw new Error("Owner and repo are required");

		const repoData = await fetchAndBuildRepo(ownerTrimmed, repoTrimmed, ctx.token);

		if (repoData.private) {
			throw new Error("Private repositories are not supported. Please use your own repositories.");
		}

		await dbHelper.syncUserRepos(userID, [repoData]);

		return {
			repo: repoData,
		};
	});
}

/**
 * Mutation.updateCustomDomain
 * Updates the custom domain for a deployment
 */
export async function updateCustomDomain(
	_: unknown,
	{
		repoName,
		serviceName,
		customUrl,
	}: { repoName: string; serviceName: string; customUrl?: string },
	ctx: GraphQLContext
) {
	return withTiming("updateCustomDomain", async () => {
		const userID = requireUser(ctx);

		const repoNameTrimmed = String(repoName ?? "").trim();
		const serviceNameTrimmed = String(serviceName ?? "").trim();

		if (!repoNameTrimmed || !serviceNameTrimmed) {
			throw new Error("repoName and serviceName are required");
		}

		const hasValue = typeof customUrl === "string" && customUrl.trim() !== "";
		const formattedCustomUrl = hasValue ? normalizeCustomUrlInput(customUrl) : null;

		if (hasValue && !formattedCustomUrl) {
			throw new Error("Invalid customUrl format");
		}

		const { deployment, error: getFetchError } = await dbHelper.getDeployment(repoNameTrimmed, serviceNameTrimmed);
		if (getFetchError || !deployment) {
			throw new Error("Deployment not found");
		}

		if (deployment.ownerID !== userID) {
			throw new Error("Unauthorized: deployment does not belong to you");
		}

		const updateResponse = await dbHelper.updateDeployments(
			{
				...deployment,
				liveUrl: formattedCustomUrl ?? null,
			},
			userID
		);

		if (updateResponse.error) {
			throw new Error("Failed to persist custom domain");
		}

		let configureMessage: string | null = null;
		if (deployment.status === "running" && ((deployment.ec2 || {}) as Record<string, unknown>)?.instanceId && formattedCustomUrl) {
			const previousCustomUrl = deployment.liveUrl || null;
			const updatedDeployment = {
				...deployment,
				liveUrl: formattedCustomUrl ?? null,
			};
			await configureCustomDomainForDeployment(updatedDeployment, previousCustomUrl);
			configureMessage = "ALB and Vercel DNS updated";
		}

		const message = formattedCustomUrl
			? configureMessage ?? "Custom domain saved. It will apply after your next deployment."
			: "Custom domain cleared";

		return {
			status: "success",
			message,
			customUrl: formattedCustomUrl,
		};
	});
}

/**
 * Mutation.verifyDns
 * Verifies DNS subdomain availability via Vercel API
 */
export async function verifyDns(
	_: unknown,
	{
		subdomain,
		repoName,
		serviceName,
	}: { subdomain: string; repoName?: string; serviceName?: string },
	ctx: GraphQLContext
) {
	return withTiming("verifyDns", async () => {
		const subdomainTrimmed = String(subdomain ?? "").trim();
		const repoNameTrimmed = String(repoName ?? "").trim();
		const serviceNameTrimmed = String(serviceName ?? "").trim();

		if (!subdomainTrimmed) throw new Error("Subdomain is required");

		const token = (process.env.VERCEL_TOKEN || "").trim();
		const domain = (process.env.VERCEL_DOMAIN || process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN || "").trim();

		if (!token || !domain) throw new Error("Vercel DNS not configured");

		const baseDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
		const sanitized = sanitizeSubdomain(subdomainTrimmed);
		const listUrl = `https://api.vercel.com/v4/domains/${encodeURIComponent(baseDomain)}/records`;
		const headers = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};

		const listRes = await fetch(listUrl, { headers });
		if (!listRes.ok) throw new Error("Failed to fetch DNS records");

		const listData = await listRes.json();
		const records = Array.isArray(listData.records)
			? listData.records
			: Array.isArray(listData)
				? listData
				: [];

		const existingRecord = records.find(
			(r: any) => r.name === sanitized && (r.type === "A" || r.type === "CNAME")
		);

		if (!existingRecord) {
			return {
				available: true,
				subdomain: sanitized,
				customUrl: `https://${sanitized}.${baseDomain}`,
				isOwned: false,
				alternatives: [],
				message: null,
			};
		}

		// If subdomain exists, check if it belongs to the current deployment
		if (repoNameTrimmed && serviceNameTrimmed) {
			const deploymentRes = await dbHelper.getDeployment(repoNameTrimmed, serviceNameTrimmed);
			if (deploymentRes.deployment) {
				const currentCustomUrl = deploymentRes.deployment.liveUrl || "";
				const currentSubdomain = currentCustomUrl.replace(/^https?:\/\//, "").replace(/\..*$/, "");

				if (currentSubdomain === sanitized) {
					return {
						available: true,
						isOwned: true,
						subdomain: sanitized,
						customUrl: `https://${sanitized}.${baseDomain}`,
						alternatives: [],
						message: null,
					};
				}
			}
		}

		// Subdomain is taken, suggest alternatives
		const alternatives: string[] = [];
		for (let i = 1; i <= 5; i += 1) {
			const alt = `${sanitized}-${i}`;
			const altExists = records.find((r: any) => r.name === alt && (r.type === "A" || r.type === "CNAME"));
			if (!altExists) alternatives.push(alt);
			if (alternatives.length >= 3) break;
		}

		return {
			available: false,
			subdomain: sanitized,
			customUrl: null,
			isOwned: false,
			alternatives,
			message: `Subdomain "${sanitized}" is already taken`,
		};
	});
}

/**
 * Mutation.cloneRepo
 * Clones a repository to the server
 */
export async function cloneRepo(
	_: unknown,
	{ repoUrl, repoName }: { repoUrl: string; repoName: string },
	ctx: GraphQLContext
) {
	return withTiming("cloneRepo", async () => {
		if (!ctx.token) throw new Error("Missing access token");

		const repoUrlTrimmed = String(repoUrl ?? "").trim();
		const repoNameTrimmed = String(repoName ?? "").trim();

		if (!repoUrlTrimmed || !repoNameTrimmed) {
			throw new Error("Missing repo URL or repo name");
		}

		const repoDir = path.join(process.cwd(), "clones", repoNameTrimmed);
		const authenticatedUrl = githubAuthenticatedCloneUrl(repoUrlTrimmed, ctx.token);

		try {
			execSync(`git clone ${authenticatedUrl} ${repoDir}`, { stdio: "pipe" });
		} catch (error) {
			throw new Error(`Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`);
		}

		return {
			message: `Repo cloned to ${repoDir}`,
		};
	});
}

/**
 * Mutation.prefillInfra
 * Prefills infrastructure detection for a repository
 */
export async function prefillInfra(
	_: unknown,
	{
		url,
		branch,
		packagePath,
	}: { url: string; branch?: string; packagePath?: string },
	ctx: GraphQLContext
) {
	return withTiming("prefillInfra", async () => {
		if (!ctx.token) throw new Error("Unauthorized");

		const urlTrimmed = String(url ?? "").trim();
		let branchTrimmed = String(branch ?? "").trim();
		const packagePathTrimmed = String(packagePath ?? "").trim();

		if (!urlTrimmed) throw new Error("Missing url");

		let repoUrl = urlTrimmed.replace(/\.git$/, "");
		if (!repoUrl.startsWith("http")) {
			repoUrl = repoUrl.includes("/") ? `https://github.com/${repoUrl}` : "";
		}
		if (!repoUrl || !repoUrl.includes("github.com")) {
			throw new Error("Invalid repository URL");
		}

		const parsed = parseGithubOwnerRepo(repoUrl);
		if (!parsed) throw new Error("Could not parse GitHub owner/repo from URL");

		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prefill-infra-"));

		try {
			if (!branchTrimmed) {
				const { default_branch } = await fetchRepoMetadata(parsed.owner, parsed.repo, ctx.token);
				branchTrimmed = default_branch;
			}

			const { repoRoot, effectiveBranch } = await prepareGithubRepoWorkspace(
				parsed.owner,
				parsed.repo,
				branchTrimmed,
				ctx.token,
				tmpDir
			);

			const results = buildPrefilledScanResults(repoRoot, packagePathTrimmed || undefined);

			if (!results) {
				return {
					found: false,
					branch: effectiveBranch,
					results: null,
				};
			}

			return {
				found: true,
				branch: effectiveBranch,
				results,
			};
		} catch (inner: unknown) {
			const message = inner instanceof GithubApiError 
				? `Failed to fetch repository from GitHub: ${redactTokenInText(inner.message, ctx.token)}`
				: inner instanceof Error
					? inner.message
					: "Failed to prefill infrastructure";
			throw new Error(message);
		} finally {
			try {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			} catch {
				// ignore cleanup errors
			}
		}
	});
}

/**
 * Mutation.refreshRepos
 * Refreshes the user's repository list from GitHub
 */
export async function refreshRepos(_: unknown, __: unknown, ctx: GraphQLContext) {
	return withTiming("refreshRepos", async () => {
		const userID = requireUser(ctx);
		if (!ctx.token) throw new Error("Missing access token");

		const response = await getGithubRepos(ctx.token);
		if (response.error) throw new Error(String(response.error));

		const repoList = response.data ?? [];
		await dbHelper.syncUserRepos(userID, repoList);
		invalidateRepoCache(userID);

		return {
			status: "success",
			message: "Repos refreshed",
			repoList,
		};
	});
}
