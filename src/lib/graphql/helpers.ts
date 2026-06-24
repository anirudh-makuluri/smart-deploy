/**
 * GraphQL Helper Functions
 * 
 * Extracted from the previous RPC-style route.ts implementation.
 * These helpers are used by query and mutation resolvers.
 */

import { detectMultiService } from "@/lib/multiServiceDetector";
import {
	getSubnetIds,
	deleteHostRule,
	ensureHostRule,
	ensureSharedAlb,
	findTargetGroupArnByName,
} from "@/lib/aws/awsHelpers";
import { ensureUserAndRepos } from "@/lib/sessionHelpers";
import { createWebSocketLogger } from "@/lib/websocketLogger";
import { addRoute53DnsRecord } from "@/lib/route53Dns";
import type { DetectedServiceInfo, repoType } from "@/app/types";
import { classifyServiceForDetection } from "@/lib/serviceDetectionClassification";
import { isEcsDeployment, isEcsCloudResources } from "@/lib/cloudResources";
import { hostedUrlFromSubdomain } from "@/lib/hostedUrl";
import config from "@/config";
import path from "path";

export function githubHeaders(token: string): HeadersInit {
	return {
		Authorization: `token ${token}`,
		Accept: "application/vnd.github+json",
	};
}

function mapGithubErrorMessage(raw: unknown): string {
	const message = String(raw ?? "Failed to fetch repository");
	if (/bad credentials/i.test(message)) {
		return "GitHub authentication expired. Please reconnect GitHub and try again.";
	}
	return message;
}

export function mapGithubRepoToAppRepo(repoData: any, latestCommit: any, branches: any[]): repoType {
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
		visibility: repoData.visibility,
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

export async function fetchAndBuildRepo(owner: string, repoName: string, token: string): Promise<repoType> {
	const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
		headers: githubHeaders(token),
	});
	if (!repoRes.ok) {
		const errorData = await repoRes.json().catch(() => ({}));
		throw new Error(mapGithubErrorMessage(errorData?.message ?? "Failed to fetch repository"));
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

export async function fetchLatestCommit(owner: string, repoName: string, branch: string, token: string) {
	const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/commits/${branch}`, {
		headers: githubHeaders(token),
	});

	if (!commitRes.ok) {
		const error = await commitRes.json().catch(() => ({}));
		throw new Error(mapGithubErrorMessage(error?.message ?? "Failed to fetch commit"));
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

export function toDetectedService(s: any, repoRoot: string): DetectedServiceInfo {
	const pathRel =
		s.relativePath ??
		(path.isAbsolute(s.workdir) ? path.relative(repoRoot, s.workdir).replace(/\\/g, "/") : s.workdir.replace(/\\/g, "/"));
	const classification = classifyServiceForDetection(repoRoot, {
		workdir: s.workdir,
		relativePath: pathRel,
		framework: s.framework,
		dockerfile: s.dockerfile,
	});
	return {
		name: s.name,
		path: pathRel,
		language: s.language || "",
		framework: s.framework,
		port: s.port,
		deployMode: classification.deployMode,
		...(classification.serviceType ? { serviceType: classification.serviceType } : {}),
	};
}

export function redactTokenInText(text: string, token: string): string {
	if (!token) return text;
	return text.split(token).join("[REDACTED]");
}

export function normalizeCustomUrlInput(value?: string): string | null {
	const trimmed = (value || "").trim();
	if (!trimmed) return null;
	return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function buildServicesForDeployment(deployment: any): any[] {
	const fallbackName = deployment.serviceName || deployment.repoName;
	const scan = deployment.scanResults;
	if (scan?.deploy_units && Array.isArray(scan.deploy_units)) {
		const units = scan.deploy_units.filter(Boolean);
		if (units.length === 0) {
			return [{ name: fallbackName, dir: ".", port: 8080 }];
		}
		return units.map((unit: { name?: string; root?: string; port?: number; framework?: string | null; provider?: string }) => ({
			name: unit.name || fallbackName,
			dir: unit.root || ".",
			port: unit.port || 8080,
			relativePath: unit.root,
			framework: unit.framework,
			language: unit.provider,
		}));
	}
	return [{ name: fallbackName, dir: ".", port: 8080 }];
}

function hostnameFromUrl(url: string | null | undefined): string | null {
	if (!url?.trim()) return null;
	return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim() || null;
}

function awsNameChunk(s: string, max: number): string {
	const out = s
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, max);
	return out || "app";
}

async function resolveEcsTargetGroupArn(deployment: any, region: string): Promise<string | null> {
	const stored = isEcsCloudResources(deployment.cloudResources)
		? deployment.cloudResources.targetGroupArn?.trim()
		: "";
	if (stored) return stored;

	const repoName = String(deployment.repoName || "").trim();
	const services = buildServicesForDeployment(deployment);
	const unitName = services[0]?.name || deployment.serviceName || "app";
	const serviceName = deployment.serviceName || deployment.repoName || "app";
	const candidates = [
		awsNameChunk(`sd-${repoName}-${unitName}-tg`, 32),
		awsNameChunk(`sd-${repoName}-${serviceName}-tg`, 32),
	];
	const arns = await Promise.all(
		[...new Set(candidates)].map((name) => findTargetGroupArnByName(name, region, null))
	);
	return arns.find((arn) => arn) ?? null;
}

async function removeOldAlbHostRule(
	listenerArn: string | undefined,
	previousCustomUrl: string | null,
	newHostname: string | null,
	region: string,
	send: ReturnType<typeof createWebSocketLogger>
): Promise<void> {
	if (!previousCustomUrl || !listenerArn) return;
	const oldHostname = hostnameFromUrl(previousCustomUrl);
	if (!oldHostname || oldHostname === newHostname) return;
	try {
		const deleted = await deleteHostRule(listenerArn, oldHostname, region, null);
		if (deleted) {
			send(`Removed ALB listener rule for old domain: ${oldHostname}`, "deploy");
		}
	} catch (error) {
		console.error("Error removing old domain rule:", error);
		send(`Warning: Could not remove old domain rule: ${error}`, "deploy");
	}
}

async function configureCustomDomainForEcs(
	deployment: any,
	previousCustomUrl: string | null,
	region: string
): Promise<void> {
	const ecsResources = isEcsCloudResources(deployment.cloudResources) ? deployment.cloudResources : null;
	const vpcId = ecsResources?.vpcId?.trim();
	if (!vpcId) {
		throw new Error("ECS deployment metadata missing; cannot reconfigure custom domain.");
	}

	const subnetIds = await getSubnetIds(vpcId, null);
	if (!subnetIds.length) {
		throw new Error(`Unable to determine subnet IDs in VPC ${vpcId}.`);
	}

	const certificateArn = config.DEPLOYMENT_ACM_CERTIFICATE_ARN?.trim() || "";
	const send = createWebSocketLogger(null);
	const hostname = hostnameFromUrl(hostedUrlFromSubdomain(deployment.hostedSubdomain));
	if (!hostname) {
		throw new Error("Invalid custom domain hostname.");
	}

	const alb = await ensureSharedAlb({
		vpcId,
		subnetIds: subnetIds.slice(0, 2),
		region,
		ws: null,
		certificateArn,
	});

	const listenerArn =
		ecsResources?.alb?.listenerArn?.trim() ||
		(certificateArn ? alb.httpsListenerArn : alb.httpListenerArn) ||
		alb.httpsListenerArn ||
		alb.httpListenerArn;
	if (!listenerArn) {
		throw new Error("ALB listener not found for ECS custom domain update.");
	}

	const targetGroupArn = await resolveEcsTargetGroupArn(deployment, region);
	if (!targetGroupArn) {
		throw new Error("ECS target group not found; redeploy once then retry.");
	}

	await ensureHostRule(listenerArn, hostname, targetGroupArn, region, null);

	const serviceName = deployment.serviceName || deployment.service_name || deployment.repoName;
	const sharedAlbDns = String(ecsResources?.alb?.dnsName ?? alb.dnsName ?? "").trim();
	const deployUrl = sharedAlbDns
		? `https://${sharedAlbDns}`
		: deployment.deployUrl || ecsResources?.baseUrl || "";
	if (!deployUrl) {
		throw new Error("Missing deployment URL for Route 53 DNS configuration.");
	}

	const result = await addRoute53DnsRecord(deployUrl, deployment.hostedSubdomain, serviceName, {
		deploymentTarget: "ecs",
		sharedAlbDns: sharedAlbDns || null,
		awsRegion: region,
	});
	if (!result.success) {
		throw new Error(result.error ?? "Failed to add Route 53 DNS record");
	}

	await removeOldAlbHostRule(listenerArn, previousCustomUrl, hostname, region, send);
}

export async function configureCustomDomainForDeployment(
	deployment: any,
	previousCustomUrl: string | null
): Promise<void> {
	const region = (deployment.region || config.AWS_REGION).trim();
	if (!region) {
		throw new Error("Missing AWS region for deployment.");
	}

	if (!isEcsDeployment(deployment)) {
		throw new Error("Custom domain updates are only supported for ECS deployments.");
	}

	await configureCustomDomainForEcs(deployment, previousCustomUrl, region);
}

export function sanitizeSubdomain(subdomain: string): string {
	const out = subdomain
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 63);
	return out || "app";
}

export function sortAndLimitRepos(repoList: Awaited<ReturnType<typeof ensureUserAndRepos>>["repoList"]) {
	const APP_OVERVIEW_REPO_LIMIT = 25;
	return repoList
		.toSorted((a, b) => {
			const dateA = a.latest_commit?.date ? new Date(a.latest_commit.date).getTime() : 0;
			const dateB = b.latest_commit?.date ? new Date(b.latest_commit.date).getTime() : 0;
			return dateB - dateA;
		})
		.slice(0, APP_OVERVIEW_REPO_LIMIT);
}

export function sortReposByLatestCommit(repoList: Awaited<ReturnType<typeof ensureUserAndRepos>>["repoList"]) {
	return repoList.toSorted((a, b) => {
		const dateA = a.latest_commit?.date ? new Date(a.latest_commit.date).getTime() : 0;
		const dateB = b.latest_commit?.date ? new Date(b.latest_commit.date).getTime() : 0;
		return dateB - dateA;
	});
}

export function githubAuthenticatedCloneUrl(repoUrl: string, token: string): string {
	return repoUrl.replace("https://", `https://${token}:x-oauth-basic@`);
}
