import "server-only";
import { execFileSync } from "child_process";
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

/** `owner/repo` for GitHub commit and PR links. */
export function getGithubRepoSlug(): string {
	const fromEnv = process.env.GITHUB_REPOSITORY?.trim();
	if (fromEnv && fromEnv.includes("/")) return fromEnv;
	return "anirudh-makuluri/smart-deploy";
}

function parsePrNumber(subject: string): number | null {
	const merge = subject.match(MERGE_PR_RE);
	if (merge) return Number.parseInt(merge[1], 10);
	const suffix = subject.match(SUBJECT_PR_SUFFIX_RE);
	if (suffix) return Number.parseInt(suffix[1], 10);
	return null;
}

/**
 * Reads recent commits from the repository git log (newest first).
 * Returns an empty array when `.git` is missing or `git` fails (e.g. some deploy images).
 */
export function getRecentGitCommits(limit = 80): GitChangelogCommit[] {
	const cwd = process.cwd();
	if (!fs.existsSync(path.join(cwd, ".git"))) {
		return [];
	}
	const RS = "\u001e";
	try {
		const out = execFileSync(
			"git",
			["log", `-${limit}`, `--pretty=format:%H${RS}%h${RS}%ad${RS}%aN${RS}%s`, "--date=short"],
			{
				encoding: "utf-8",
				cwd,
				maxBuffer: 10 * 1024 * 1024,
			},
		);
		const lines = out.trim().split("\n").filter(Boolean);
		const commits: GitChangelogCommit[] = [];
		for (const line of lines) {
			const parts = line.split(RS);
			if (parts.length < 5) continue;
			const [hash, shortHash, date, author, ...rest] = parts;
			const subject = rest.join(RS);
			commits.push({
				hash,
				shortHash,
				date,
				author,
				subject,
				prNumber: parsePrNumber(subject),
			});
		}
		return commits;
	} catch {
		return [];
	}
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
