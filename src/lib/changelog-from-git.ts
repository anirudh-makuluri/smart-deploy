import "server-only";
import fs from "fs";
import path from "path";

const MERGE_PR_RE = /Merge pull request #(\d+)/i;
const SUBJECT_PR_SUFFIX_RE = /\(#(\d+)\)\s*$/;

export type GitChangelogCommit = {
	hash: string;
	shortHash: string;
	date: string;
	author: string;
	subject: string;
	prNumber: number | null;
};

type ChangelogReadOptions = {
	limit?: number;
};

type ChangelogSnapshotFile = {
	generatedAt?: string;
	commitCount?: number;
	commits: GitChangelogCommit[];
};

const SNAPSHOT_PATH = path.join(process.cwd(), "src", "data", "changelog-commits.json");

/** `owner/repo` for GitHub commit and PR links. */
export function getGithubRepoSlug(): string {
	const fromEnv = process.env.GITHUB_REPOSITORY?.trim();
	if (fromEnv && fromEnv.includes("/")) return fromEnv;
	return "anirudh-makuluri/smart-deploy";
}

/**
 * Commits shown on the public changelog. Sourced from a checked-in JSON snapshot
 * (`src/data/changelog-commits.json`) so production builds without `.git` still render history.
 * Regenerate locally: `npm run changelog:snapshot`
 */
export function getChangelogCommits(options: ChangelogReadOptions = {}): GitChangelogCommit[] {
	try {
		const raw = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
		const data = JSON.parse(raw) as ChangelogSnapshotFile;
		if (!Array.isArray(data.commits)) return [];
		const normalized = data.commits.map((c) => ({
			...c,
			prNumber:
				typeof c.prNumber === "number"
					? c.prNumber
					: parsePrNumberFromSubject(c.subject),
		}));
		if (!options.limit || options.limit <= 0) return normalized;
		return normalized.slice(0, options.limit);
	} catch {
		return [];
	}
}

function parsePrNumberFromSubject(subject: string): number | null {
	const merge = subject.match(MERGE_PR_RE);
	if (merge) return Number.parseInt(merge[1], 10);
	const suffix = subject.match(SUBJECT_PR_SUFFIX_RE);
	if (suffix) return Number.parseInt(suffix[1], 10);
	return null;
}

export function groupCommitsByDate(commits: GitChangelogCommit[]): { date: string; commits: GitChangelogCommit[] }[] {
	const map = new Map<string, GitChangelogCommit[]>();
	for (const c of commits) {
		const list = map.get(c.date) ?? [];
		list.push(c);
		map.set(c.date, list);
	}
	return [...map.entries()]
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([date, list]) => ({ date, commits: list }));
}

export function commitUrl(hash: string): string {
	const slug = getGithubRepoSlug();
	return `https://github.com/${slug}/commit/${hash}`;
}

export function pullRequestUrl(pr: number): string {
	const slug = getGithubRepoSlug();
	return `https://github.com/${slug}/pull/${pr}`;
}
