/**
 * GraphQL Helper Functions
 * 
 * Extracted from the previous RPC-style route.ts implementation.
 * These helpers are used by query and mutation resolvers.
 */

import { detectMultiService } from "@/lib/multiServiceDetector";
import { buildPrefilledScanResults } from "@/lib/infrastructurePrefill";
import { getSubnetIds, deleteHostRule, ensureSharedAlb } from "@/lib/aws/awsHelpers";
import { configureAlb } from "@/lib/aws/handleEC2";
import { parseGithubOwnerRepo, fetchRepoMetadata, prepareGithubRepoWorkspace } from "@/lib/githubRepoArchive";
import { deleteDeploymentForUser, controlDeploymentForUser } from "@/lib/deploymentActions";
import { getGithubRepos } from "@/github-helper";
import { invalidateRepoCache, ensureUserAndRepos } from "@/lib/sessionHelpers";
import { createWebSocketLogger } from "@/lib/websocketLogger";
import { addVercelDnsRecord } from "@/lib/vercelDns";
import { getInitialEc2ServiceLogs } from "@/lib/aws/ec2ServiceLogs";
import { dbHelper } from "@/db-helper";
import { getInitialLogs } from "@/gcloud-logs/getInitialLogs";
import type { DetectedServiceInfo, repoType } from "@/app/types";
import config from "@/config";
import fs from "fs";
import path from "path";
import os from "os";

export function githubHeaders(token: string): HeadersInit {
	return {
		Authorization: `token ${token}`,
		Accept: "application/vnd.github+json",
	};
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

export async function fetchLatestCommit(owner: string, repoName: string, branch: string, token: string) {
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

export function toDetectedService(s: any, repoRoot: string): DetectedServiceInfo {
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
	const services = (deployment.scanResults?.services || []).filter(Boolean);
	const fallbackName = deployment.serviceName || deployment.repoName;
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

export async function configureCustomDomainForDeployment(
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

	const net: any = {
		vpcId,
		subnetIds,
		securityGroupId,
	};

	const services = buildServicesForDeployment(deployment);
	const certificateArn = config.EC2_ACM_CERTIFICATE_ARN?.trim() || "";
	const send = createWebSocketLogger(null);

	// First: Create the NEW domain configuration (ALB rule + DNS)
	// If this fails, old domain remains active as fallback
	await configureAlb({
		deployConfig: deployment,
		instanceId,
		existingInstanceId: undefined,
		services,
		repoName: deployment.repoName,
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

	// Second: Only after new domain is fully configured, remove the old one
	// If old domain deletion fails, new domain is already live (degraded state, but working)
	if (previousCustomUrl) {
		try {
			const alb = await ensureSharedAlb({
				vpcId: net.vpcId,
				subnetIds: net.subnetIds.slice(0, 2),
				region,
				ws: null,
				certificateArn,
			});

			// Extract hostname from the previous custom URL
			const oldHostname = (previousCustomUrl || "")
				.replace(/^https?:\/\//, "")
				.replace(/\/.*$/, "")
				.trim();

			if (oldHostname) {
				// Determine which listener to query based on certificate config
				const listenerArn = certificateArn ? alb.httpsListenerArn : alb.httpListenerArn;
				if (listenerArn) {
					const deleted = await deleteHostRule(listenerArn, oldHostname, region, null);
					if (deleted) {
						send(`Removed ALB listener rule for old domain: ${oldHostname}`, "deploy");
					}
				}
			}
		} catch (error) {
			// Log but don't fail - old domain deletion issues should not block the update
			// New domain is already live at this point
			console.error("Error removing old domain rule:", error);
			send(`Warning: Could not remove old domain rule: ${error}`, "deploy");
		}
	}
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
	return [...repoList]
		.sort((a, b) => {
			const dateA = a.latest_commit?.date ? new Date(a.latest_commit.date).getTime() : 0;
			const dateB = b.latest_commit?.date ? new Date(b.latest_commit.date).getTime() : 0;
			return dateB - dateA;
		})
		.slice(0, APP_OVERVIEW_REPO_LIMIT);
}

export function sortReposByLatestCommit(repoList: Awaited<ReturnType<typeof ensureUserAndRepos>>["repoList"]) {
	return [...repoList].sort((a, b) => {
		const dateA = a.latest_commit?.date ? new Date(a.latest_commit.date).getTime() : 0;
		const dateB = b.latest_commit?.date ? new Date(b.latest_commit.date).getTime() : 0;
		return dateB - dateA;
	});
}

export function githubAuthenticatedCloneUrl(repoUrl: string, token: string): string {
	return repoUrl.replace("https://", `https://${token}:x-oauth-basic@`);
}
