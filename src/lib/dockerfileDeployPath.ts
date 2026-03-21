/**
 * Repo-relative path where a Dockerfile will be written on deploy (EC2 SSM, etc.).
 * Folder-only keys like "client" become "client/Dockerfile".
 * Paths that already end with Dockerfile or Dockerfile.* are left as-is (aside from slash normalization).
 */
export function canonicalDockerfileDeployPath(rel: string): string {
	const p = rel.replace(/^\.\//, "").replace(/\\/g, "/").replace(/\/+$/, "");
	if (!p) return "Dockerfile";
	const base = p.split("/").pop() || "";
	const baseLower = base.toLowerCase();
	if (baseLower === "dockerfile" || baseLower.startsWith("dockerfile.")) return p;
	return `${p}/Dockerfile`;
}

export function isValidRepoRelativeDockerfilePath(p: string): boolean {
	const t = p.trim().replace(/\\/g, "/");
	if (!t || t.includes("..")) return false;
	if (/^[a-zA-Z]:/.test(t)) return false;
	if (t.startsWith("/")) return false;
	return true;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * When the user renames a Dockerfile key, keep docker-compose dockerfile: lines in sync when they reference the old path.
 */
export function syncDockerfilePathInCompose(compose: string, oldKey: string, newKey: string): string {
	if (!compose || !oldKey || !newKey || oldKey === newKey) return compose;
	const variants = Array.from(
		new Set([oldKey, canonicalDockerfileDeployPath(oldKey)].filter((v) => v && v !== newKey)),
	);
	let out = compose;
	for (const old of variants) {
		out = out.replace(
			new RegExp(`^(\\s*dockerfile:\\s*)${escapeRegex(old)}(\\s*(?:#.*)?)$`, "gim"),
			(_m, prefix: string, suffix: string) => `${prefix}${newKey}${suffix}`,
		);
	}
	return out;
}
