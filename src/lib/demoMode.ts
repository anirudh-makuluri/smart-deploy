import type { repoType, SDArtifactsResponse } from "../app/types";
import { demoRepos } from "../config/demoRepos";
import config from "../config";

export type AccountMode = "internal" | "demo";

export type DemoRepoConfig = {
	demoRepoKey: string;
	owner: string;
	repo: string;
	branch: string;
	commitSha?: string;
	title?: string;
	description?: string;
	scan_results?: SDArtifactsResponse;
};

type RawDemoRepoConfig = Partial<DemoRepoConfig> & {
	scan_results?: SDArtifactsResponse;
};

function normalizeRepoUrl(url: string): string {
	return url.replace(/\.git$/, "").trim().toLowerCase();
}

function sanitizeDemoRepoConfig(raw: RawDemoRepoConfig, index: number): DemoRepoConfig | null {
	const owner = raw.owner?.trim();
	const repo = raw.repo?.trim();
	const branch = raw.branch?.trim();
	const commitSha = raw.commitSha?.trim() || undefined;
	const demoRepoKey = raw.demoRepoKey?.trim() || `${owner ?? "repo"}-${repo ?? index}`;

	if (!owner || !repo || !branch) return null;

	return {
		demoRepoKey,
		owner,
		repo,
		branch,
		commitSha,
		title: raw.title?.trim() || undefined,
		description: raw.description?.trim() || undefined,
		scan_results: raw.scan_results,
	};
}

export function getInternalEmailMatchers(): string[] {
	const raw = config.DEMO_INTERNAL_EMAIL_MATCHERS?.trim();
	if (!raw) return [];
	return raw
		.split(",")
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean);
}

export function getAccountModeForEmail(email?: string | null): AccountMode {
	const normalized = (email || "").trim().toLowerCase();
	if (!normalized) return "demo";

	const isInternal = getInternalEmailMatchers().some((matcher) => normalized.includes(matcher));
	return isInternal ? "internal" : "demo";
}

export function getDemoRepoCatalog(): DemoRepoConfig[] {
	return demoRepos
		.map((entry, index) => sanitizeDemoRepoConfig(entry, index))
		.filter((entry): entry is DemoRepoConfig => Boolean(entry));
}

export function findDemoRepoConfig(input: { owner?: string | null; repo?: string | null; url?: string | null }): DemoRepoConfig | null {
	const owner = input.owner?.trim().toLowerCase();
	const repo = input.repo?.trim().toLowerCase();
	const url = input.url ? normalizeRepoUrl(input.url) : "";

	for (const entry of getDemoRepoCatalog()) {
		const entryUrl = normalizeRepoUrl(`https://github.com/${entry.owner}/${entry.repo}`);
		if (owner && repo && entry.owner.toLowerCase() === owner && entry.repo.toLowerCase() === repo) {
			return entry;
		}
		if (url && entryUrl === url) {
			return entry;
		}
	}

	return null;
}

export function buildDemoRepoList(): repoType[] {
	return getDemoRepoCatalog().map((entry) => ({
		id: entry.demoRepoKey,
		name: entry.repo,
		full_name: `${entry.owner}/${entry.repo}`,
		html_url: `https://github.com/${entry.owner}/${entry.repo}`,
		language: "",
		languages_url: `https://api.github.com/repos/${entry.owner}/${entry.repo}/languages`,
		created_at: new Date(0).toISOString(),
		updated_at: new Date(0).toISOString(),
		pushed_at: new Date(0).toISOString(),
		default_branch: entry.branch,
		private: false,
		description: entry.description ?? null,
		visibility: "public",
		license: null,
		forks_count: 0,
		watchers_count: 0,
		open_issues_count: 0,
		owner: {
			login: entry.owner,
		},
		latest_commit: entry.commitSha
			? {
				message: entry.title || `Pinned demo commit for ${entry.repo}`,
				author: "Smart Deploy",
				date: new Date(0).toISOString(),
				sha: entry.commitSha,
				url: `https://github.com/${entry.owner}/${entry.repo}/commit/${entry.commitSha}`,
			}
			: null,
		branches: [
			{
				name: entry.branch,
				commit_sha: entry.commitSha || "",
				protected: true,
			},
		],
	}));
}

export function getDemoTtlMinutes(): number {
	const parsed = Number(config.DEMO_TTL_MINUTES || "10");
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

export function getDemoPrefix(): string {
	return config.DEMO_SUBDOMAIN_PREFIX?.trim() || "demo";
}

export function getDemoMaxActivePerUser(): number {
	const parsed = Number(config.DEMO_MAX_ACTIVE_PER_USER || "1");
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function getDemoMaxGlobalActive(): number {
	const parsed = Number(config.DEMO_MAX_GLOBAL_ACTIVE || "3");
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

export function getDemoRedeployCooldownSeconds(): number {
	const parsed = Number(config.DEMO_REDEPLOY_COOLDOWN_SECONDS || "300");
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 300;
}

export function getDemoMaxDeploysPerDay(): number {
	const parsed = Number(config.DEMO_MAX_DEPLOYS_PER_DAY || "3");
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}
