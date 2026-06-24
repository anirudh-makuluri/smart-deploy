import { countDeployedServicesForRepo } from "@/lib/utils";
import { isDraftDeploymentStatus, isProblemDeploymentStatus } from "@/lib/deploymentStatus";
import type { DeployConfig, repoType, RepoRecord } from "@/app/types";

export function normalizeDashboardRepoUrl(url: string): string {
	return url?.replace(/\.git$/, "").toLowerCase().trim();
}

export function getDashboardErrorMessage(error?: Error | { message?: string } | null): string {
	if (!error) return "Failed to fetch repository";
	if (error instanceof Error) return error.message;
	return error.message || "Failed to fetch repository";
}

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
	try {
		let cleanUrl = url.trim();
		cleanUrl = cleanUrl.replace(/\.git$/, "");
		cleanUrl = cleanUrl.replace(/^https?:\/\//, "");
		cleanUrl = cleanUrl.replace(/^github\.com\//, "");
		cleanUrl = cleanUrl.replace(/\/$/, "");
		const parts = cleanUrl.split("/").filter(Boolean);
		if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
		return null;
	} catch {
		return null;
	}
}

export type RepoCard = {
	owner: string;
	name: string;
	subtitle: string;
	hasFailed: boolean;
	language?: string;
};

export function buildRepoCards(
	repoRecords: RepoRecord[] = [],
	repoList: repoType[] = [],
	deployments: DeployConfig[] = []
): RepoCard[] {
	return repoRecords.flatMap((record) => {
		if ((record.services?.length ?? 0) === 0) return [];

		const repoUrlNorm = normalizeDashboardRepoUrl(record.repo_url);
		const matchingRepo = repoList.find(
			(repo) =>
				normalizeDashboardRepoUrl(repo.html_url) === repoUrlNorm ||
				repo.full_name === `${record.repo_owner}/${record.repo_name}`
		);
		const repoDeployments = deployments.filter((d) => normalizeDashboardRepoUrl(d.repoUrl ?? "") === repoUrlNorm);
		const totalServices = record.services?.length ?? 0;
		const activeRepoDeployments = repoDeployments.filter((d) => !isDraftDeploymentStatus(d.status));
		const hasFailed = repoDeployments.some((d) => d.status === "failed");
		const deployedServicesCount = countDeployedServicesForRepo(record, repoDeployments);
		const isDeployed = deployedServicesCount > 0;
		const isCrashed = activeRepoDeployments.some(
			(d) => isProblemDeploymentStatus(d.status) && d.status !== "failed"
		);

		const subtitle = isCrashed
			? "Crashed"
			: hasFailed
				? "Failed"
				: isDeployed
					? "Deployed"
					: "Not deployed";
		const base: RepoCard = {
			owner: record.repo_owner,
			name: record.repo_name,
			subtitle,
			hasFailed,
			language: matchingRepo?.language ?? undefined,
		};
		if (totalServices > 0) {
			return [
				{
					...base,
					subtitle: `${subtitle} · ${deployedServicesCount}/${totalServices} service${totalServices !== 1 ? "s" : ""}`,
				},
			];
		}
		return [base];
	});
}
