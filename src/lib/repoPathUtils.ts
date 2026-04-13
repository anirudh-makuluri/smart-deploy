import fs from "fs";
import path from "path";

/**
 * Resolve a user-provided repo-relative path under `repoRoot` and block `..` escapes.
 * Returns POSIX path relative to repo (`"."` for root).
 */
export function safeResolveUnderRepoRoot(repoRoot: string, userPath: string): { absPath: string; relPosix: string } {
	const raw = String(userPath ?? "").trim().replace(/\\/g, "/");
	const stripped = raw.replace(/^\/+/, "");
	const candidate = path.resolve(repoRoot, stripped);
	const rootResolved = path.resolve(repoRoot);
	if (candidate !== rootResolved && !candidate.startsWith(rootResolved + path.sep)) {
		throw new Error("Path escapes repository root");
	}
	if (!fs.existsSync(candidate)) {
		throw new Error("Path does not exist in repository");
	}
	const rel = path.relative(rootResolved, candidate).replace(/\\/g, "/");
	return { absPath: candidate, relPosix: rel || "." };
}

/**
 * Normalize a compose file path relative to repo root (POSIX, no leading slash).
 */
export function normalizeComposeRelativePath(composeFile: string): string {
	const raw = String(composeFile ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
	if (!raw || raw.includes("..")) {
		throw new Error("Invalid compose file path");
	}
	return raw;
}
