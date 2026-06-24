/**
 * Repo-relative path where a Dockerfile will be written on deploy.
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

/** Paths allowed inside generated SSM/bash scripts (no metacharacters, traversal, etc.). */
export function isSafeRepoRelPathForShell(p: string): boolean {
	const t = p.replace(/\\/g, "/").trim();
	if (!t || t.includes("..")) return false;
	if (t.startsWith("/") || /^[a-zA-Z]:/.test(t)) return false;
	return /^[a-zA-Z0-9._\/-]+$/.test(t);
}

function canonicalDockerfileKeysFromRecord(dockerfiles: Record<string, string>): string[] {
	const set = new Set<string>();
	for (const k of Object.keys(dockerfiles || {})) {
		const raw = k.replace(/^\.\//, "").replace(/\\/g, "/");
		if (!isValidRepoRelativeDockerfilePath(raw)) continue;
		set.add(canonicalDockerfileDeployPath(raw));
	}
	return [...set];
}

type ScanServiceHint = { dockerfile_path?: string; build_context?: string };

/**
 * When there is no docker-compose, Smart Deploy uses a single `docker build`. Infer -f and context from
 * scan_results.dockerfiles (one key) or a lone service's dockerfile_path / build_context.
 */
export function inferSingleDockerfileBuild(
	dockerfiles: Record<string, string>,
	services?: ScanServiceHint[] | null,
): { dockerfile: string; context: string } | null {
	const fromRecord = canonicalDockerfileKeysFromRecord(dockerfiles);
	let dockerfileRel: string | null = null;

	if (fromRecord.length === 1) {
		dockerfileRel = fromRecord[0];
	} else if (fromRecord.length === 0 && services?.length === 1) {
		const dp = services[0].dockerfile_path?.trim();
		if (dp) {
			const raw = dp.replace(/^\.\//, "").replace(/\\/g, "/");
			if (!isValidRepoRelativeDockerfilePath(raw)) return null;
			dockerfileRel = canonicalDockerfileDeployPath(raw);
		}
	}

	if (!dockerfileRel || !isSafeRepoRelPathForShell(dockerfileRel)) return null;

	const svc = services?.length === 1 ? services[0] : undefined;
	let context = "";
	if (svc?.build_context != null && String(svc.build_context).trim() !== "") {
		context = String(svc.build_context).trim().replace(/^\.\//, "").replace(/\\/g, "/").replace(/\/+$/, "") || ".";
	} else {
		const lastSlash = dockerfileRel.lastIndexOf("/");
		context = lastSlash >= 0 ? dockerfileRel.slice(0, lastSlash) : ".";
	}

	if (!isSafeRepoRelPathForShell(context)) return null;

	return { dockerfile: dockerfileRel, context };
}

const DOCKERFILE_COMPOSE_LINE_REGEX = /^(\s*dockerfile:\s*)(.+?)(\s*(?:#.*)?)$/i;

/**
 * When the user renames a Dockerfile key, keep docker-compose dockerfile: lines in sync when they reference the old path.
 */
export function syncDockerfilePathInCompose(compose: string, oldKey: string, newKey: string): string {
	if (!compose || !oldKey || !newKey || oldKey === newKey) return compose;
	const variants = Array.from(
		new Set([oldKey, canonicalDockerfileDeployPath(oldKey)].filter((v) => v && v !== newKey)),
	);
	const variantSet = new Set(variants.map((variant) => variant.toLowerCase()));
	return compose
		.split("\n")
		.map((line) => {
			const match = DOCKERFILE_COMPOSE_LINE_REGEX.exec(line);
			if (!match) return line;
			const path = match[2].trim();
			if (!variantSet.has(path.toLowerCase())) return line;
			return `${match[1]}${newKey}${match[3]}`;
		})
		.join("\n");
}
