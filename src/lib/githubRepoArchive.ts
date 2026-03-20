import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import unzipper from "unzipper";

export class GithubApiError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
		this.name = "GithubApiError";
	}
}

export function parseGithubOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
	const cleaned = repoUrl.replace(/\.git$/i, "").replace(/\/$/, "");
	const marker = "github.com/";
	const idx = cleaned.toLowerCase().indexOf(marker);
	if (idx === -1) return null;
	const rest = cleaned.slice(idx + marker.length);
	const parts = rest.split("/").filter(Boolean);
	if (parts.length < 2) return null;
	return { owner: parts[0], repo: parts[1] };
}

function githubRestHeaders(token: string): HeadersInit {
	return {
		Accept: "application/vnd.github+json",
		Authorization: `Bearer ${token}`,
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "smart-deploy/detect-services",
	};
}

export async function fetchRepoMetadata(
	owner: string,
	repo: string,
	token: string
): Promise<{ default_branch: string }> {
	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
		headers: githubRestHeaders(token),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new GithubApiError(`GitHub repo metadata: ${text.slice(0, 400)}`, res.status);
	}
	const data = (await res.json()) as { default_branch: string };
	return { default_branch: data.default_branch };
}

/**
 * Download repo archive ZIP via GitHub REST (authenticated: higher rate limits than unauthenticated).
 * Follows the API redirect manually so the Authorization header is not forwarded to CDN URLs.
 */
async function streamGithubZipballToFile(
	owner: string,
	repo: string,
	ref: string,
	token: string,
	destPath: string
): Promise<void> {
	const apiUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`;
	let res = await fetch(apiUrl, { headers: githubRestHeaders(token), redirect: "manual" });

	if ([301, 302, 303, 307, 308].includes(res.status)) {
		const loc = res.headers.get("location");
		if (!loc) {
			throw new GithubApiError("GitHub archive redirect missing Location header", res.status);
		}
		res = await fetch(loc);
	}

	if (!res.ok) {
		const text = await res.text();
		throw new GithubApiError(text.slice(0, 800), res.status);
	}

	if (!res.body) {
		throw new GithubApiError("GitHub archive response had no body", res.status);
	}

	await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(destPath));
}

async function extractGithubZipArchive(zipPath: string, extractDir: string): Promise<string> {
	const directory = await unzipper.Open.file(zipPath);
	await directory.extract({ path: extractDir });

	const entries = fs.readdirSync(extractDir, { withFileTypes: true });
	const dirs = entries.filter((e) => e.isDirectory());
	if (dirs.length === 1) {
		return path.join(extractDir, dirs[0].name);
	}
	if (dirs.length === 0 && entries.some((e) => e.isFile())) {
		return extractDir;
	}
	if (dirs.length > 1) {
		return path.join(extractDir, dirs[0].name);
	}
	throw new Error("Unexpected archive layout after extract");
}

/**
 * Downloads GitHub repo ZIP for a ref, extracts it, returns filesystem root and the ref that worked.
 */
export async function prepareGithubRepoWorkspace(
	owner: string,
	repo: string,
	preferredBranch: string,
	token: string,
	tmpDir: string
): Promise<{ repoRoot: string; effectiveBranch: string }> {
	const zipPath = path.join(tmpDir, "archive.zip");
	const extractDir = path.join(tmpDir, "extract");
	fs.mkdirSync(extractDir, { recursive: true });

	let effectiveBranch = preferredBranch;

	const download = async (ref: string) => {
		try {
			if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
		} catch {
			/* ignore */
		}
		await streamGithubZipballToFile(owner, repo, ref, token, zipPath);
	};

	try {
		await download(preferredBranch);
	} catch (firstErr) {
		const status = firstErr instanceof GithubApiError ? firstErr.status : 0;
		if (status === 404) {
			const { default_branch } = await fetchRepoMetadata(owner, repo, token);
			effectiveBranch = default_branch;
			await download(effectiveBranch);
		} else {
			throw firstErr;
		}
	}

	const repoRoot = await extractGithubZipArchive(zipPath, extractDir);
	try {
		fs.unlinkSync(zipPath);
	} catch {
		/* ignore */
	}

	return { repoRoot, effectiveBranch };
}
