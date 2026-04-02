import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { exec } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

import { authOptions } from "@/app/api/auth/authOptions";
import type { DetectedServiceInfo, repoType } from "@/app/types";
import { dbHelper } from "@/db-helper";
import { getGithubRepos } from "@/github-helper";
import config from "@/config";
import { getSubnetIds } from "@/lib/aws/awsHelpers";
import { configureAlb, type NetworkingResult, type ServiceDef } from "@/lib/aws/handleEC2";
import { controlDeploymentForUser, deleteDeploymentForUser } from "@/lib/deploymentActions";
import { githubAuthenticatedCloneUrl } from "@/lib/githubGitAuth";
import {
	fetchRepoMetadata,
	GithubApiError,
	parseGithubOwnerRepo,
	prepareGithubRepoWorkspace,
} from "@/lib/githubRepoArchive";
import { buildPrefilledScanResults } from "@/lib/infrastructurePrefill";
import { detectMultiService, type ServiceDefinition } from "@/lib/multiServiceDetector";
import { ensureUserAndRepos, invalidateRepoCache } from "@/lib/sessionHelpers";
import { addVercelDnsRecord } from "@/lib/vercelDns";
import { createWebSocketLogger } from "@/lib/websocketLogger";

type GraphQLContext = {
	session: Awaited<ReturnType<typeof getServerSession>>;
	userID?: string;
	token?: string;
};

type GraphQLPayload = {
	query?: string;
	variables?: Record<string, unknown>;
};

const APP_OVERVIEW_REPO_LIMIT = 10;
const execAsync = promisify(exec);

type GraphQLResult =
	| { data: Record<string, unknown> }
	| { errors: { message: string }[] };

function graphQLError(message: string): GraphQLResult {
	return { errors: [{ message }] };
}

async function withTiming<T>(label: string, fn: () => Promise<T>) {
	const start = Date.now();
	try {
		return await fn();
	} finally {
		console.debug(`[GraphQL] ${label} completed in ${Date.now() - start}ms`);
	}
}

function requireUser(ctx: GraphQLContext): string {
	if (!ctx.userID || !ctx.session) {
		throw new Error("Unauthorized");
	}
	return ctx.userID;
}

function detectOperation(query: string): string | null {
	if (query.includes("appOverview")) return "appOverview";
	if (query.includes("repoDeployments")) return "repoDeployments";
	if (query.includes("repoServices")) return "repoServices";
	if (query.includes("resolveRepo")) return "resolveRepo";
	if (query.includes("detectServices")) return "detectServices";
	if (query.includes("addPublicRepo")) return "addPublicRepo";
	if (query.includes("updateCustomDomain")) return "updateCustomDomain";
	if (query.includes("verifyDns")) return "verifyDns";
	if (query.includes("cloneRepo")) return "cloneRepo";
	if (query.includes("prefillInfra")) return "prefillInfra";
	if (query.includes("latestCommit")) return "latestCommit";
	if (query.includes("deploymentHistoryAll")) return "deploymentHistoryAll";
	if (query.includes("deploymentHistory")) return "deploymentHistory";
	if (query.includes("session")) return "session";
	if (query.includes("updateDeployment")) return "updateDeployment";
	if (query.includes("deleteDeployment")) return "deleteDeployment";
	if (query.includes("deploymentControl")) return "deploymentControl";
	if (query.includes("refreshRepos")) return "refreshRepos";
	return null;
}

function githubHeaders(token: string): HeadersInit {
	return {
		Authorization: `token ${token}`,
		Accept: "application/vnd.github+json",
	};
}

function mapGithubRepoToAppRepo(repoData: any, latestCommit: any, branches: any[]): repoType {
	return {
		id: String(repoData.id),
		name: repoData.name,
		full_name: repoData.full_name,
		html_url: repoData.html_url,
		language: repoData.language || "",
		languages_url: repoData.languages_url,
		created_at: repoData.created_at,
		updated_at: repoData.updated_at,
		pushed_at: repoData.pushed_at,
		default_branch: repoData.default_branch,
		private: repoData.private,
		description: repoData.description,
		visibility: repoData.visibility,
		license: repoData.license ? { spdx_id: repoData.license.spdx_id } : null,
		forks_count: repoData.forks_count,
		watchers_count: repoData.watchers_count,
		open_issues_count: repoData.open_issues_count,
		owner: { login: repoData.owner.login },
		latest_commit: latestCommit
			? {
					message: latestCommit.commit.message,
					author: latestCommit.commit.author.name,
					date: latestCommit.commit.author.date,
					sha: latestCommit.sha,
					url: latestCommit.html_url,
			  }
			: null,
		branches: branches.map((b: any) => ({
			name: b.name,
			commit_sha: b.commit.sha,
			protected: b.protected,
		})),
	};
}

async function fetchAndBuildRepo(owner: string, repoName: string, token: string): Promise<repoType> {
	const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
		headers: githubHeaders(token),
	});
	if (!repoRes.ok) {
		const errorData = await repoRes.json().catch(() => ({}));
		throw new Error(String(errorData?.message ?? "Failed to fetch repository"));
	}
	const repoData = await repoRes.json();

	const commitRes = await fetch(
		`https://api.github.com/repos/${owner}/${repoName}/commits/${repoData.default_branch}`,
		{ headers: githubHeaders(token) }
	);
	const latestCommit = commitRes.ok ? await commitRes.json() : null;

	const branchesRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/branches`, {
		headers: githubHeaders(token),
	});
	const branches = branchesRes.ok ? await branchesRes.json() : [];

	return mapGithubRepoToAppRepo(repoData, latestCommit, branches);
}

async function fetchLatestCommit(owner: string, repoName: string, branch: string, token: string) {
	const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/commits/${branch}`, {
		headers: githubHeaders(token),
	});

	if (!commitRes.ok) {
		const error = await commitRes.json().catch(() => ({}));
		throw new Error(String(error?.message ?? "Failed to fetch commit"));
	}

	const commit = await commitRes.json();
	return {
		sha: commit.sha,
		message: commit.commit.message,
		author: commit.commit.author.name,
		date: commit.commit.author.date,
		url: commit.html_url,
	};
}

function toDetectedService(s: ServiceDefinition, repoRoot: string): DetectedServiceInfo {
	const pathRel =
		s.relativePath ??
		(path.isAbsolute(s.workdir) ? path.relative(repoRoot, s.workdir).replace(/\\/g, "/") : s.workdir.replace(/\\/g, "/"));
	return {
		name: s.name,
		path: pathRel,
		language: s.language || "",
		framework: s.framework,
		port: s.port,
	};
}

function redactTokenInText(text: string, token: string): string {
	if (!token) return text;
	return text.split(token).join("[REDACTED]");
}

type CustomDomainRequest = {
	repoName?: string;
	serviceName?: string;
	customUrl?: string;
};

function normalizeCustomUrlInput(value?: string): string | null {
	const trimmed = (value || "").trim();
	if (!trimmed) return null;
	return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function buildServicesForDeployment(deployment: any): ServiceDef[] {
	const services = (deployment.scan_results?.services || []).filter(Boolean);
	const fallbackName = deployment.service_name || deployment.repo_name;
	if (services.length === 0) {
		return [{ name: fallbackName, dir: ".", port: 8080 }];
	}
	return services.map((svc: any) => ({
		name: svc.name || fallbackName,
		dir: svc.build_context || ".",
		port: svc.port || 8080,
		relativePath: svc.build_context,
		framework: svc.framework,
		language: svc.language,
	}));
}

async function configureCustomDomainForDeployment(
	deployment: any,
	previousCustomUrl: string | null
): Promise<void> {
	const instanceId = deployment.ec2?.instanceId?.trim();
	const vpcId = deployment.ec2?.vpcId?.trim();
	const securityGroupId = deployment.ec2?.securityGroupId?.trim();
	if (!instanceId || !vpcId || !securityGroupId) {
		throw new Error("EC2 metadata missing; cannot reconfigure custom domain.");
	}

	const region = (deployment.awsRegion || config.AWS_REGION).trim();
	if (!region) {
		throw new Error("Missing AWS region for deployment.");
	}

	const subnetIds = await getSubnetIds(vpcId, null);
	if (!subnetIds.length) {
		throw new Error(`Unable to determine subnet IDs in VPC ${vpcId}.`);
	}

	const net: NetworkingResult = {
		vpcId,
		subnetIds,
		securityGroupId,
	};

	const services = buildServicesForDeployment(deployment);
	const certificateArn = config.EC2_ACM_CERTIFICATE_ARN?.trim() || "";
	const send = createWebSocketLogger(null);

	await configureAlb({
		deployConfig: deployment,
		instanceId,
		existingInstanceId: undefined,
		services,
		repoName: deployment.repo_name,
		net,
		region,
		certificateArn,
		ws: null,
		send,
	});

	const deployUrl = (deployment.deployUrl || deployment.ec2?.sharedAlbDns || deployment.ec2?.baseUrl || "").trim();
	if (!deployUrl) {
		throw new Error("Missing deployment URL for Vercel DNS configuration.");
	}

	const target = deployment.deploymentTarget ?? "ec2";
	const result = await addVercelDnsRecord(deployUrl, deployment.service_name, {
		deploymentTarget: target,
		previousCustomUrl,
	});

	if (!result.success) {
		throw new Error(result.error ?? "Failed to add Vercel DNS record");
	}
}

function sanitizeSubdomain(subdomain: string): string {
	const out = subdomain
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 63);
	return out || "app";
}

function sortAndLimitRepos(repoList: Awaited<ReturnType<typeof ensureUserAndRepos>>["repoList"]) {
	return [...repoList]
		.sort((a, b) => {
			const dateA = a.latest_commit?.date ? new Date(a.latest_commit.date).getTime() : 0;
			const dateB = b.latest_commit?.date ? new Date(b.latest_commit.date).getTime() : 0;
			return dateB - dateA;
		})
		.slice(0, APP_OVERVIEW_REPO_LIMIT);
}

async function executeOperation(
	operation: string,
	variables: Record<string, unknown>,
	ctx: GraphQLContext
): Promise<Record<string, unknown>> {
	switch (operation) {
		case "appOverview":
			return withTiming("appOverview", async () => {
				const userID = requireUser(ctx);
				const startedAt = Date.now();

				const reposPromise = withTiming("appOverview.ensureUserAndRepos", async () => ensureUserAndRepos(ctx.session as any));
				const deploymentsPromise = withTiming("appOverview.getUserDeployments", async () => dbHelper.getUserDeployments(userID));
				const servicesPromise = withTiming("appOverview.getUserRepoServices", async () => dbHelper.getUserRepoServices(userID));

				const [{ repoList }, deploymentsRes, servicesRes] = await Promise.all([
					reposPromise,
					deploymentsPromise,
					servicesPromise,
				]);

				if (deploymentsRes.error) throw new Error(String(deploymentsRes.error));
				if (servicesRes.error) throw new Error(String(servicesRes.error));

				console.debug(`[GraphQL] appOverview total backend time ${Date.now() - startedAt}ms`);

				return {
					appOverview: {
						repoList: sortAndLimitRepos(repoList),
						deployments: deploymentsRes.deployments ?? [],
						repoServices: servicesRes.records ?? [],
					},
				};
			});
		case "repoDeployments":
			return withTiming("repoDeployments", async () => {
				const userID = requireUser(ctx);
				const repoName = String(variables.repoName ?? "");
				const response = await dbHelper.getDeploymentsByRepo(userID, repoName);
				if (response.error) throw new Error(String(response.error));
				return { repoDeployments: response.deployments ?? [] };
			});
		case "repoServices":
			return withTiming("repoServices", async () => {
				const userID = requireUser(ctx);
				const response = await dbHelper.getUserRepoServices(userID);
				if (response.error) throw new Error(String(response.error));
				return { repoServices: response.records ?? [] };
			});
		case "resolveRepo":
			return withTiming("resolveRepo", async () => {
				const userID = requireUser(ctx);
				if (!ctx.token) throw new Error("Missing access token");
				const owner = String(variables.owner ?? "").trim();
				const repoName = String(variables.repo ?? "").trim();
				if (!owner || !repoName) throw new Error("Owner and repo are required");

				const repo = await fetchAndBuildRepo(owner, repoName, ctx.token);
				await dbHelper.syncUserRepos(userID, [repo]);
				return { resolveRepo: { repo } };
			});
		case "addPublicRepo":
			return withTiming("addPublicRepo", async () => {
				const userID = requireUser(ctx);
				if (!ctx.token) throw new Error("Missing access token");
				const owner = String(variables.owner ?? "").trim();
				const repoName = String(variables.repo ?? "").trim();
				if (!owner || !repoName) throw new Error("Owner and repo are required");

				const repo = await fetchAndBuildRepo(owner, repoName, ctx.token);
				if (repo.private) {
					throw new Error("Private repositories are not supported. Please use your own repositories.");
				}

				await dbHelper.syncUserRepos(userID, [repo]);
				return { addPublicRepo: { repo } };
			});
		case "detectServices":
			return withTiming("detectServices", async () => {
				const userID = requireUser(ctx);
				if (!ctx.token) throw new Error("Missing access token");

				const url = String(variables.url ?? "").trim();
				let branch = String(variables.branch ?? "").trim();
				if (!url) throw new Error("Missing url");

				let repoUrl = url.replace(/\.git$/, "");
				if (!repoUrl.startsWith("http")) {
					repoUrl = repoUrl.includes("/") ? `https://github.com/${repoUrl}` : "";
				}
				if (!repoUrl || !repoUrl.includes("github.com")) {
					throw new Error("Invalid repository URL");
				}

				const parsed = parseGithubOwnerRepo(repoUrl);
				if (!parsed) throw new Error("Could not parse GitHub owner/repo from URL");
				const { owner, repo } = parsed;
				const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-services-"));

				try {
					if (!branch) {
						const { default_branch } = await fetchRepoMetadata(owner, repo, ctx.token);
						branch = default_branch;
					}

					const { repoRoot, effectiveBranch } = await prepareGithubRepoWorkspace(owner, repo, branch, ctx.token, tmpDir);
					const multiServiceConfig = detectMultiService(repoRoot);
					const services: DetectedServiceInfo[] =
						multiServiceConfig.services.length > 0
							? multiServiceConfig.services.map((s) => toDetectedService(s, repoRoot))
							: [{ name: "app", path: ".", language: "node", port: 3000 }];

					await dbHelper.upsertRepoServices(userID, repoUrl, {
						branch: effectiveBranch,
						repo_owner: owner,
						repo_name: repo,
						services,
						is_monorepo: multiServiceConfig.isMonorepo ?? false,
					});

					return {
						detectServices: {
							isMonorepo: multiServiceConfig.isMonorepo ?? false,
							isMultiService: multiServiceConfig.isMultiService ?? false,
							services,
							packageManager: multiServiceConfig.packageManager ?? null,
						},
					};
				} catch (inner: unknown) {
					if (inner instanceof GithubApiError) {
						throw new Error(`Failed to fetch repository from GitHub: ${redactTokenInText(inner.message, ctx.token)}`);
					}
					throw inner;
				} finally {
					try {
						fs.rmSync(tmpDir, { recursive: true, force: true });
					} catch {
						// ignore cleanup errors
					}
				}
			});
		case "updateCustomDomain":
			return withTiming("updateCustomDomain", async () => {
				const userID = requireUser(ctx);
				const { repoName, serviceName, customUrl } = variables as CustomDomainRequest;
				if (!repoName || !serviceName) {
					throw new Error("repoName and serviceName are required");
				}

				const hasValue = typeof customUrl === "string" && customUrl.trim() !== "";
				const formattedCustomUrl = hasValue ? normalizeCustomUrlInput(customUrl) : null;
				if (hasValue && !formattedCustomUrl) {
					throw new Error("Invalid customUrl format");
				}

				const { deployment, error } = await dbHelper.getDeployment(repoName, serviceName);
				if (error || !deployment) {
					throw new Error("Deployment not found");
				}
				if (deployment.ownerID !== userID) {
					throw new Error("Unauthorized: deployment does not belong to you");
				}

				const updateResponse = await dbHelper.updateDeployments(
					{
						...deployment,
						custom_url: formattedCustomUrl ?? undefined,
					},
					userID
				);
				if (updateResponse.error) {
					throw new Error("Failed to persist custom domain");
				}

				let configureMessage: string | null = null;
				if (deployment.status === "running" && deployment.ec2?.instanceId && formattedCustomUrl) {
					const previousCustomUrl = deployment.custom_url || null;
					const updatedDeployment = {
						...deployment,
						custom_url: formattedCustomUrl ?? undefined,
					};
					await configureCustomDomainForDeployment(updatedDeployment, previousCustomUrl);
					configureMessage = "ALB and Vercel DNS updated";
				}

				const message = formattedCustomUrl
					? configureMessage ?? "Custom domain saved. It will apply after your next deployment."
					: "Custom domain cleared";
				return {
					updateCustomDomain: {
						status: "success",
						message,
						customUrl: formattedCustomUrl,
					},
				};
			});
		case "verifyDns":
			return withTiming("verifyDns", async () => {
				const subdomain = String(variables.subdomain ?? "").trim();
				const repoName = String(variables.repoName ?? "").trim();
				const serviceName = String(variables.serviceName ?? "").trim();
				if (!subdomain) throw new Error("Subdomain is required");

				const token = (process.env.VERCEL_TOKEN || "").trim();
				const domain = (
					process.env.VERCEL_DOMAIN ||
					process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN ||
					""
				).trim();
				if (!token || !domain) throw new Error("Vercel DNS not configured");

				const baseDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
				const sanitized = sanitizeSubdomain(subdomain);
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
						verifyDns: {
							available: true,
							subdomain: sanitized,
							customUrl: `https://${sanitized}.${baseDomain}`,
							isOwned: false,
							alternatives: [],
							message: null,
						},
					};
				}

				if (repoName && serviceName) {
					const { deployment } = await dbHelper.getDeployment(repoName, serviceName);
					if (deployment) {
						const currentCustomUrl = deployment.custom_url || "";
						const currentSubdomain = currentCustomUrl.replace(/^https?:\/\//, "").replace(/\..*$/, "");
						if (currentSubdomain === sanitized) {
							return {
								verifyDns: {
									available: true,
									isOwned: true,
									subdomain: sanitized,
									customUrl: `https://${sanitized}.${baseDomain}`,
									alternatives: [],
									message: null,
								},
							};
						}
					}
				}

				const alternatives: string[] = [];
				for (let i = 1; i <= 5; i += 1) {
					const alt = `${sanitized}-${i}`;
					const altExists = records.find(
						(r: any) => r.name === alt && (r.type === "A" || r.type === "CNAME")
					);
					if (!altExists) alternatives.push(alt);
					if (alternatives.length >= 3) break;
				}
				return {
					verifyDns: {
						available: false,
						subdomain: sanitized,
						customUrl: null,
						isOwned: false,
						alternatives,
						message: `Subdomain "${sanitized}" is already taken`,
					},
				};
			});
		case "cloneRepo":
			return withTiming("cloneRepo", async () => {
				if (!ctx.token) throw new Error("Missing access token");
				const repoUrl = String(variables.repoUrl ?? "").trim();
				const repoName = String(variables.repoName ?? "").trim();
				if (!repoUrl || !repoName) {
					throw new Error("Missing repo URL or repo name");
				}

				const repoDir = path.join(process.cwd(), "clones", repoName);
				const authenticatedUrl = githubAuthenticatedCloneUrl(repoUrl, ctx.token);
				await execAsync(`git clone ${authenticatedUrl} ${repoDir}`);

				return {
					cloneRepo: {
						message: `Repo cloned to ${repoDir}`,
					},
				};
			});
		case "prefillInfra":
			return withTiming("prefillInfra", async () => {
				if (!ctx.token) throw new Error("Unauthorized");

				const url = String(variables.url ?? "").trim();
				const packagePath = String(variables.packagePath ?? "").trim();
				let branch = String(variables.branch ?? "").trim();
				if (!url) throw new Error("Missing url");

				let repoUrl = url.replace(/\.git$/, "");
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
					if (!branch) {
						const { default_branch } = await fetchRepoMetadata(parsed.owner, parsed.repo, ctx.token);
						branch = default_branch;
					}

					const { repoRoot, effectiveBranch } = await prepareGithubRepoWorkspace(parsed.owner, parsed.repo, branch, ctx.token, tmpDir);
					const results = buildPrefilledScanResults(repoRoot, packagePath);

					if (!results) {
						return {
							prefillInfra: {
								found: false,
								branch: effectiveBranch,
								results: null,
							},
						};
					}

					return {
						prefillInfra: {
							found: true,
							branch: effectiveBranch,
							results,
						},
					};
				} catch (inner: unknown) {
					if (inner instanceof GithubApiError) {
						throw new Error(`Failed to fetch repository from GitHub: ${redactTokenInText(inner.message, ctx.token)}`);
					}
					throw inner;
				} finally {
					try {
						fs.rmSync(tmpDir, { recursive: true, force: true });
					} catch {
						// ignore cleanup errors
					}
				}
			});
		case "latestCommit":
			return withTiming("latestCommit", async () => {
				if (!ctx.token) throw new Error("Missing access token");

				const owner = String(variables.owner ?? "").trim();
				const repoName = String(variables.repo ?? "").trim();
				let branch = String(variables.branch ?? "").trim();
				if (!owner || !repoName) throw new Error("Owner and repo are required");

				if (!branch) {
					const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
						headers: githubHeaders(ctx.token),
					});
					if (!metaRes.ok) {
						const err = await metaRes.json().catch(() => ({}));
						throw new Error(String(err?.message ?? "Failed to load repository"));
					}
					const meta = (await metaRes.json()) as { default_branch?: string };
					branch = meta.default_branch?.trim() ?? "";
				}
				if (!branch) throw new Error("Could not resolve a branch for this repository");

				const commit = await fetchLatestCommit(owner, repoName, branch, ctx.token);
				return { latestCommit: { commit } };
			});
		case "deploymentHistory":
			return withTiming("deploymentHistory", async () => {
				const userID = requireUser(ctx);
				const repoName = String(variables.repoName ?? "");
				const serviceName = String(variables.serviceName ?? "");
				const page = Number(variables.page ?? 1);
				const limit = Number(variables.limit ?? 10);
				if (!repoName || !serviceName) {
					throw new Error("repoName and serviceName are required");
				}
				const response = await dbHelper.getDeploymentHistory(repoName, serviceName, userID, page, limit);
				if (response.error) throw new Error(String(response.error));
				return {
					deploymentHistory: {
						history: response.history ?? [],
						page: response.page ?? Math.max(1, page),
						limit: response.limit ?? Math.max(1, limit),
						total: response.total ?? 0,
					},
				};
			});
		case "deploymentHistoryAll":
			return withTiming("deploymentHistoryAll", async () => {
				const userID = requireUser(ctx);
				const page = Number(variables.page ?? 1);
				const limit = Number(variables.limit ?? 10);
				const response = await dbHelper.getAllDeploymentHistory(userID, page, limit);
				if (response.error) throw new Error(String(response.error));
				return {
					deploymentHistoryAll: {
						history: response.history ?? [],
						page: response.page ?? Math.max(1, page),
						limit: response.limit ?? Math.max(1, limit),
						total: response.total ?? 0,
					},
				};
			});
		case "session":
			return withTiming("session", async () => {
				const userID = requireUser(ctx);
				const { repoList } = await ensureUserAndRepos(ctx.session as any);
				return {
					session: {
						userID,
						name: (ctx.session as any)?.user?.name ?? null,
						image: (ctx.session as any)?.user?.image ?? null,
						repoList: sortAndLimitRepos(repoList),
					},
				};
			});
		case "updateDeployment":
			return withTiming("updateDeployment", async () => {
				const userID = requireUser(ctx);
				const config = variables.config;
				const response = await dbHelper.updateDeployments(config as never, userID);
				if (response.error) throw new Error(String(response.error));
				return {
					updateDeployment: {
						status: "success",
						message: response.success ?? null,
					},
				};
			});
		case "deleteDeployment":
			return withTiming("deleteDeployment", async () => {
				const userID = requireUser(ctx);
				const payload = (variables.payload ?? {}) as { repoName?: string; serviceName?: string };
				const result = await deleteDeploymentForUser({
					repoName: payload.repoName ?? "",
					serviceName: payload.serviceName ?? "",
					userID,
				});
				if (result.status === "error") throw new Error(result.message ?? "Failed to delete deployment");
				return {
					deleteDeployment: {
						status: "success",
						message: result.message ?? null,
						vercelDnsDeleted: result.vercelDnsDeleted ?? 0,
					},
				};
			});
		case "deploymentControl":
			return withTiming("deploymentControl", async () => {
				const userID = requireUser(ctx);
				const input = (variables.input ?? {}) as {
					repoName?: string;
					serviceName?: string;
					action?: "pause" | "resume" | "stop";
				};
				const result = await controlDeploymentForUser({
					repoName: input.repoName,
					serviceName: input.serviceName,
					action: input.action ?? "pause",
					userID,
				});
				if (result.status === "error") throw new Error(result.message ?? "Failed to control deployment");
				return {
					deploymentControl: {
						status: "success",
						message: result.message ?? null,
					},
				};
			});
		case "refreshRepos":
			return withTiming("refreshRepos", async () => {
				const userID = requireUser(ctx);
				if (!ctx.token) throw new Error("Missing access token");

				const response = await getGithubRepos(ctx.token);
				if (response.error) throw new Error(String(response.error));

				const repoList = response.data ?? [];
				await dbHelper.syncUserRepos(userID, repoList);
				invalidateRepoCache(userID);
				return {
					refreshRepos: {
						status: "success",
						message: "Repos refreshed",
						repoList,
					},
				};
			});
		default:
			throw new Error(`Unsupported GraphQL operation: ${operation}`);
	}
}

async function handleGraphQL(req: NextRequest) {
	try {
		const payload = (await req.json()) as GraphQLPayload;
		const query = payload.query?.trim();
		if (!query) {
			return NextResponse.json(graphQLError("Missing GraphQL query"), { status: 400 });
		}

		const operation = detectOperation(query);
		if (!operation) {
			return NextResponse.json(graphQLError("Unknown GraphQL operation"), { status: 400 });
		}

		const session = await getServerSession(authOptions);
		const ctx: GraphQLContext = {
			session,
			userID: session?.userID,
			token: session?.accessToken,
		};

		const result = await executeOperation(operation, payload.variables ?? {}, ctx);
		return NextResponse.json({ data: result });
	} catch (error) {
		const message = error instanceof Error ? error.message : "GraphQL request failed";
		return NextResponse.json(graphQLError(message), { status: 500 });
	}
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
	return handleGraphQL(req);
}

export async function GET() {
	return NextResponse.json({
		data: {
			health: "ok",
			endpoint: "/api/graphql",
		},
	});
}
