import fs from "fs";
import path from "path";
import yaml from "js-yaml";

export interface ServiceDefinition {
	name: string;
	workdir: string;
	language?: string;
	dockerfile?: string;
	port?: number;
	env_vars?: Record<string, string>;
	depends_on?: string[];
	build_context?: string;
	/** For monorepo services: the relative path from the repo root to the service (e.g. "apps/web") */
	relativePath?: string;
	/** The framework detected for this service (e.g. "nextjs", "express") */
	framework?: string;
}

export interface MultiServiceConfig {
	isMultiService: boolean;
	services: ServiceDefinition[];
	hasDockerCompose: boolean;
	/** True when the repo uses workspace tooling (pnpm workspaces, turborepo, lerna, nx, etc.) */
	isMonorepo: boolean;
	/** The package manager used by the monorepo (pnpm, npm, yarn) */
	packageManager?: string;
	/** The monorepo root directory (usually the repo root) */
	monorepoRoot?: string;
}

/** Optional hints when detecting from a known GitHub clone (stable service ids for analyze / deployments). */
export type DetectMultiServiceOptions = {
	/**
	 * GitHub repo short name (e.g. `chatify-next`) for a single root app.
	 * Prefer over `package.json` `name` so service keys match the repository and `package_path` stays correct for scan/analyze.
	 */
	rootServiceNameHint?: string;
};

/** Infer dockerfile path when compose omits build.dockerfile (legacy root Dockerfile.<name> or service-dir Dockerfile). */
function inferDockerfileFromCompose(appDir: string, serviceName: string, buildContextRaw: string | undefined): string | undefined {
	const rootLegacy = path.join(appDir, `Dockerfile.${serviceName}`);
	if (fs.existsSync(rootLegacy)) return `Dockerfile.${serviceName}`;

	const ctx = (buildContextRaw || ".").replace(/^\.\//, "").trim();
	if (ctx && ctx !== ".") {
		const nested = path.join(appDir, ctx, "Dockerfile");
		if (fs.existsSync(nested)) {
			return path.posix.join(ctx.replace(/\\/g, "/"), "Dockerfile");
		}
	}
	return undefined;
}

const COMPOSE_FILE_NAMES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"] as const;

/**
 * Parses a single compose file and returns non-database compose services (same rules as detectDockerCompose).
 */
export function parseComposeFileNonDbServices(composeAbsPath: string): ServiceDefinition[] {
	const composeDir = path.dirname(composeAbsPath);
	const appDir = composeDir;
	try {
		const content = fs.readFileSync(composeAbsPath, "utf-8");
		const compose = yaml.load(content) as any;
		if (!compose?.services) return [];

		const services: ServiceDefinition[] = [];
		for (const [serviceName, serviceConfig] of Object.entries(compose.services as any)) {
			const config = serviceConfig as any;
			if (isDatabaseService(serviceName, config)) continue;

			const contextFromCompose = config.build?.context;
			const workdir = contextFromCompose || appDir;
			const service: ServiceDefinition = {
				name: serviceName,
				workdir,
				dockerfile:
					config.build?.dockerfile ||
					inferDockerfileFromCompose(appDir, serviceName, contextFromCompose),
				port: extractPort(config),
				env_vars: config.environment || {},
				depends_on: config.depends_on || [],
				build_context: contextFromCompose || appDir,
			};

			if (!service.dockerfile && service.workdir) {
				service.language = detectLanguage(service.workdir);
			}
			services.push(service);
		}
		return services;
	} catch (error) {
		console.error(`Error parsing docker-compose file ${composeAbsPath}: ${error}`);
		return [];
	}
}

/**
 * Detects if a docker-compose.yml file exists and parses it
 */
export function detectDockerCompose(appDir: string): MultiServiceConfig | null {
	console.log("detectDockerCompose", appDir);

	for (const file of COMPOSE_FILE_NAMES) {
		const composePath = path.join(appDir, file);
		if (!fs.existsSync(composePath)) continue;

		console.log("composePath", composePath);
		const services = parseComposeFileNonDbServices(composePath);
		if (services.length > 0) {
			return {
				isMultiService: true,
				services,
				hasDockerCompose: true,
				isMonorepo: false,
			};
		}
	}

	return null;
}

const COMPOSE_CATALOG_SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"coverage",
	"vendor",
	"__pycache__",
]);

function rankComposeFile(f: string): number {
	const b = path.basename(f);
	const i = (COMPOSE_FILE_NAMES as readonly string[]).indexOf(b);
	return i === -1 ? 999 : i;
}

/** One compose file per directory (prefer docker-compose.yml over compose.yaml when both exist). */
function dedupedComposePaths(repoRoot: string, maxDepth = 6): string[] {
	const found: string[] = [];
	function walk(dir: string, depth: number) {
		if (depth > maxDepth) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name.startsWith(".")) continue;
			const full = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (COMPOSE_CATALOG_SKIP_DIRS.has(e.name)) continue;
				walk(full, depth + 1);
			} else if ((COMPOSE_FILE_NAMES as readonly string[]).includes(e.name)) {
				found.push(full);
			}
		}
	}
	walk(repoRoot, 0);

	const byDir = new Map<string, string>();
	for (const p of found) {
		const dKey = path.resolve(path.dirname(p));
		const prev = byDir.get(dKey);
		if (!prev || rankComposeFile(p) < rankComposeFile(prev)) {
			byDir.set(dKey, p);
		}
	}
	return [...byDir.values()].sort((a, b) => a.localeCompare(b));
}

function allocateCatalogServiceName(used: Set<string>, base: string): string {
	let n = sanitizeFolderServiceId(base) || "compose";
	if (!used.has(n)) {
		used.add(n);
		return n;
	}
	let i = 2;
	while (used.has(`${n}-${i}`)) i += 1;
	const out = `${n}-${i}`;
	used.add(out);
	return out;
}

function normalizeCatalogPath(rel: string): string {
	return (rel || ".").replace(/\\/g, "/").replace(/\/+$/g, "") || ".";
}

function dedupeCombinedServiceNames(services: ServiceDefinition[]): ServiceDefinition[] {
	const seen = new Set<string>();
	return services.map((s) => {
		let n = s.name;
		if (!seen.has(n)) {
			seen.add(n);
			return s;
		}
		let i = 2;
		while (seen.has(`${n}-${i}`)) i += 1;
		n = `${n}-${i}`;
		seen.add(n);
		return { ...s, name: n };
	});
}

function summarizeComposeDirectoryForCatalog(
	repoRoot: string,
	composeAbsPath: string,
	repoSlug: string,
	usedNames: Set<string>
): ServiceDefinition | null {
	const inner = parseComposeFileNonDbServices(composeAbsPath);
	if (inner.length === 0) return null;

	const composeDir = path.dirname(composeAbsPath);
	const relPosix = normalizeCatalogPath(path.relative(repoRoot, composeDir));

	const baseName =
		relPosix === "."
			? sanitizeFolderServiceId(repoSlug) || "compose"
			: sanitizeFolderServiceId(path.basename(relPosix)) || "compose";
	const name = allocateCatalogServiceName(usedNames, baseName);

	const primary =
		inner.find((s) => s.port != null) ??
		inner.find((s) => Boolean(s.dockerfile)) ??
		inner[0];
	const framework = detectFramework(composeDir);
	const language =
		inner.map((s) => s.language).find((l) => Boolean(l)) ||
		detectLanguage(composeDir) ||
		"node";
	const port =
		primary.port ??
		inner.find((s) => s.port != null)?.port ??
		(framework === "nextjs" ? 3000 : getDefaultPort(language));

	return {
		name,
		workdir: composeDir,
		relativePath: relPosix,
		language,
		port,
		framework: framework || primary.framework,
		build_context: ".",
	};
}

function discoverComposeCatalogEntries(repoRoot: string, repoSlug: string, usedNames: Set<string>): ServiceDefinition[] {
	const out: ServiceDefinition[] = [];
	for (const composeAbs of dedupedComposePaths(repoRoot)) {
		const row = summarizeComposeDirectoryForCatalog(repoRoot, composeAbs, repoSlug, usedNames);
		if (row) out.push(row);
	}
	return out;
}

/** Parent directory of each Dockerfile found (same depth/skip rules as compose catalog walk). */
function dedupedDockerfileParentDirs(repoRoot: string, maxDepth = 6): string[] {
	const found = new Set<string>();
	function walk(dir: string, depth: number) {
		if (depth > maxDepth) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name.startsWith(".")) continue;
			const full = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (COMPOSE_CATALOG_SKIP_DIRS.has(e.name)) continue;
				walk(full, depth + 1);
			} else if (e.name === "Dockerfile" || e.name.startsWith("Dockerfile.")) {
				found.add(path.resolve(dir));
			}
		}
	}
	walk(repoRoot, 0);
	return [...found].sort((a, b) => a.localeCompare(b));
}

function pickPrimaryDockerfileInDir(absDir: string): string | null {
	let names: string[];
	try {
		names = fs.readdirSync(absDir);
	} catch {
		return null;
	}
	if (names.includes("Dockerfile")) return "Dockerfile";
	const alt = names.filter((n) => n.startsWith("Dockerfile.") && n !== "Dockerfile");
	if (alt.length === 0) return null;
	alt.sort();
	return alt[0] ?? null;
}

function discoverDockerfileCatalogEntries(
	repoRoot: string,
	repoSlug: string,
	usedNames: Set<string>,
	excludedRelPaths: Set<string>
): ServiceDefinition[] {
	const out: ServiceDefinition[] = [];
	for (const absDir of dedupedDockerfileParentDirs(repoRoot)) {
		const relPosix = normalizeCatalogPath(path.relative(repoRoot, absDir));
		if (excludedRelPaths.has(relPosix)) continue;

		const dockerfile = pickPrimaryDockerfileInDir(absDir);
		if (!dockerfile) continue;

		const detectedLang = detectLanguage(absDir);
		const lang = detectedLang || "unknown";
		const framework = detectFramework(absDir);
		const port = framework === "nextjs" ? 3000 : getDefaultPort(lang);

		const baseName =
			relPosix === "."
				? sanitizeFolderServiceId(repoSlug) || "app"
				: sanitizeFolderServiceId(path.basename(relPosix)) || "app";
		const name = allocateCatalogServiceName(usedNames, baseName);

		out.push({
			name,
			workdir: absDir,
			language: lang,
			framework,
			port,
			dockerfile,
			relativePath: relPosix,
			build_context: relPosix === "." ? "." : relPosix,
		});
	}
	return out;
}

/**
 * Top-level directories that look like separate apps (e.g. `api` + `ui` with no workspace root).
 * Skips paths already claimed by compose, monorepo, or Dockerfile catalog rows.
 */
function discoverRootSiblingAppEntries(
	repoRoot: string,
	usedNames: Set<string>,
	excludedRelPaths: Set<string>
): ServiceDefinition[] {
	const out: ServiceDefinition[] = [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(repoRoot, { withFileTypes: true });
	} catch {
		return out;
	}

	for (const e of entries) {
		if (!e.isDirectory() || e.name.startsWith(".")) continue;
		if (COMPOSE_CATALOG_SKIP_DIRS.has(e.name)) continue;

		const relPosix = normalizeCatalogPath(e.name);
		if (excludedRelPaths.has(relPosix)) continue;

		const absPath = path.join(repoRoot, e.name);
		if (isMobileOnlyDir(e.name, absPath)) continue;

		const language = detectLanguage(absPath);
		if (!language) continue;

		const framework = detectFramework(absPath);
		const port = framework === "nextjs" ? 3000 : getDefaultPort(language);
		const name = allocateCatalogServiceName(usedNames, sanitizeFolderServiceId(e.name) || e.name);

		out.push({
			name,
			workdir: absPath,
			language,
			framework,
			port,
			relativePath: relPosix,
			build_context: relPosix,
		});
	}
	return out;
}

/** Compose service names that usually mean observability / messaging stacks, not user apps. */
function isLikelyInfraComposeServiceName(serviceName: string): boolean {
	const n = serviceName.toLowerCase();
	const patterns = [
		/kafka/,
		/zookeeper/,
		/^zk$/,
		/\bzk\b/,
		/prometheus/,
		/grafana/,
		/\bredis\b/,
		/elastic(search)?/,
		/kibana/,
		/jaeger/,
		/postgres/,
		/\bmysql\b/,
		/\bmongo(db)?\b/,
		/rabbit/,
		/minio/,
		/clickhouse/,
		/\bconsul\b/,
		/\bvault\b/,
		/cadvisor/,
		/alertmanager/,
		/node-exporter/,
		/otel/,
		/\bcollector\b/,
		/temporal/,
		/mailhog/,
		/schema-registry/,
		/ksqldb/,
		/kafka-ui/,
	];
	return patterns.some((re) => re.test(n));
}

function isInfraOnlyComposeServiceList(services: ServiceDefinition[]): boolean {
	if (services.length === 0) return false;
	return services.every((s) => isLikelyInfraComposeServiceName(s.name));
}

export function sanitizeFolderServiceId(name: string): string {
	const cleaned = name
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "-")
		.replace(/^-+|-+$/g, "");
	return (cleaned || "app").slice(0, 64);
}

/**
 * When the repo has `projects/<name>/docker-compose*.yml`, treat each subfolder with a compose file as a deployable unit.
 * Used when the root compose is only infra (Kafka, Prometheus, etc.) so real apps are not drowned out.
 */
function detectProjectsSubfolderComposes(repoRoot: string): MultiServiceConfig | null {
	const projectsDir = path.join(repoRoot, "projects");
	if (!fs.existsSync(projectsDir) || !fs.statSync(projectsDir).isDirectory()) return null;

	const merged: ServiceDefinition[] = [];

	for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const projectAbs = path.join(projectsDir, entry.name);
		const composeCfg = detectDockerCompose(projectAbs);
		if (!composeCfg || composeCfg.services.length === 0) continue;

		const folderId = sanitizeFolderServiceId(entry.name);
		const relBase = path.posix.join("projects", entry.name.replace(/\\/g, "/"));

		if (composeCfg.services.length === 1) {
			const s = composeCfg.services[0];
			merged.push({
				...s,
				name: folderId,
				relativePath: relBase,
			});
		} else {
			for (const s of composeCfg.services) {
				merged.push({
					...s,
					name: `${folderId}-${sanitizeFolderServiceId(s.name)}`,
					relativePath: relBase,
				});
			}
		}
	}

	if (merged.length === 0) return null;

	return {
		isMultiService: merged.length > 1,
		services: merged,
		hasDockerCompose: true,
		isMonorepo: false,
	};
}

/** Directories that commonly hold deployable apps inside a monorepo */
const MONOREPO_APP_ROOTS = ["apps", "services", "packages", "modules", "projects"];

/** Service directory names to skip (mobile-only, not deployable to cloud) */
const MOBILE_ONLY_DIRS = ["mobile", "ios", "android", "react-native", "flutter", "expo"];

/**
 * Detects monorepo workspace tooling at a given directory.
 * Returns the package manager and monorepo kind if found.
 */
export function detectMonorepoTooling(appDir: string): { isMonorepo: boolean; packageManager?: string; workspaceGlobs?: string[] } {
	// pnpm workspaces
	const pnpmWorkspacePath = path.join(appDir, "pnpm-workspace.yaml");
	if (fs.existsSync(pnpmWorkspacePath)) {
		try {
			const content = fs.readFileSync(pnpmWorkspacePath, "utf-8");
			const parsed = yaml.load(content) as any;
			const globs: string[] = parsed?.packages || [];
			return { isMonorepo: true, packageManager: "pnpm", workspaceGlobs: globs };
		} catch { /* ignore parse errors */ }
	}

	// npm/yarn workspaces (in package.json)
	const rootPkgPath = path.join(appDir, "package.json");
	if (fs.existsSync(rootPkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
			if (pkg.workspaces) {
				const globs = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages || [];
				const pm = pkg.packageManager?.startsWith("yarn") ? "yarn" : "npm";
				return { isMonorepo: true, packageManager: pm, workspaceGlobs: globs };
			}
		} catch { /* ignore */ }
	}

	// Turborepo / Nx / Lerna
	const monorepoMarkers = ["turbo.json", "nx.json", "lerna.json"];
	for (const marker of monorepoMarkers) {
		if (fs.existsSync(path.join(appDir, marker))) {
			// Try to determine package manager from root package.json
			let pm = "npm";
			if (fs.existsSync(rootPkgPath)) {
				try {
					const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
					if (pkg.packageManager?.startsWith("pnpm")) pm = "pnpm";
					else if (pkg.packageManager?.startsWith("yarn")) pm = "yarn";
				} catch { /* ignore */ }
			}
			if (fs.existsSync(pnpmWorkspacePath)) pm = "pnpm";
			return { isMonorepo: true, packageManager: pm };
		}
	}

	return { isMonorepo: false };
}

/**
 * Checks if a directory is a mobile-only project (not deployable to cloud).
 */
function isMobileOnlyDir(dirName: string, dirPath: string): boolean {
	if (MOBILE_ONLY_DIRS.includes(dirName.toLowerCase())) return true;

	// Check for React Native / Expo / Flutter markers
	const pkgPath = path.join(dirPath, "package.json");
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			// React Native or Expo project
			if (deps["react-native"] || deps["expo"] || deps["@expo/cli"]) return true;
		} catch { /* ignore */ }
	}
	if (fs.existsSync(path.join(dirPath, "pubspec.yaml"))) return true; // Flutter
	if (fs.existsSync(path.join(dirPath, "android")) && fs.existsSync(path.join(dirPath, "ios"))) return true;

	return false;
}

/**
 * Detects the framework used in a directory.
 */
function detectFramework(dir: string): string | undefined {
	const pkgPath = path.join(dir, "package.json");
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			if (deps["next"]) return "nextjs";
			if (deps["express"]) return "express";
			if (deps["fastify"]) return "fastify";
			if (deps["@nestjs/core"]) return "nestjs";
			if (deps["nuxt"]) return "nuxt";
			if (deps["react"]) return "react";
			if (deps["vue"]) return "vue";
			if (deps["@angular/core"]) return "angular";
			if (deps["svelte"]) return "svelte";
		} catch { /* ignore */ }
	}
	if (fs.existsSync(path.join(dir, "requirements.txt"))) {
		try {
			const reqs = fs.readFileSync(path.join(dir, "requirements.txt"), "utf-8");
			if (reqs.includes("django")) return "django";
			if (reqs.includes("flask")) return "flask";
			if (reqs.includes("fastapi")) return "fastapi";
		} catch { /* ignore */ }
	}
	return undefined;
}

/**
 * Detects monorepo services by scanning workspace directories (apps/*, services/*, etc.).
 * This handles repos like turborepo/pnpm workspaces with apps/web, apps/backend, apps/mobile.
 */
export function detectMonorepoServices(appDir: string): MultiServiceConfig | null {
	console.log("detectMonorepoServices", appDir);

	const tooling = detectMonorepoTooling(appDir);
	if (!tooling.isMonorepo) return null;

	console.log("Monorepo detected:", tooling);

	const services: ServiceDefinition[] = [];

	// Scan known monorepo app roots (apps/, services/, etc.)
	for (const rootDir of MONOREPO_APP_ROOTS) {
		const rootPath = path.join(appDir, rootDir);
		if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) continue;

		try {
			const entries = fs.readdirSync(rootPath, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

				const servicePath = path.join(rootPath, entry.name);
				const relativePath = path.join(rootDir, entry.name).replace(/\\/g, "/");

				// Skip mobile-only directories
				if (isMobileOnlyDir(entry.name, servicePath)) {
					console.log(`Skipping mobile-only directory: ${relativePath}`);
					continue;
				}

				const language = detectLanguage(servicePath);
				if (!language) continue;

				// Skip shared packages that are libraries (no start/run script)
				if (rootDir === "packages") {
					const pkgPath = path.join(servicePath, "package.json");
					if (fs.existsSync(pkgPath)) {
						try {
							const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
							if (!pkg.scripts?.start && !pkg.scripts?.serve && !pkg.scripts?.dev) {
								console.log(`Skipping library package: ${relativePath}`);
								continue;
							}
						} catch { /* include it */ }
					}
				}

				const framework = detectFramework(servicePath);
				const port = framework === "nextjs" ? 3000 : getDefaultPort(language);

				services.push({
					name: entry.name,
					workdir: servicePath,
					language,
					port,
					relativePath,
					framework,
					build_context: appDir, // monorepo root is the build context
				});
			}
		} catch (error) {
			console.error(`Error scanning ${rootPath}:`, error);
		}
	}

	if (services.length > 0) {
		console.log(`Detected ${services.length} monorepo service(s):`, services.map(s => s.name));
		return {
			isMultiService: services.length > 1,
			services,
			hasDockerCompose: false,
			isMonorepo: true,
			packageManager: tooling.packageManager,
			monorepoRoot: appDir,
		};
	}

	return null;
}

/**
 * Algorithmically detects multiple services by looking for common patterns
 */
export function detectMultiServicePatterns(appDir: string): MultiServiceConfig | null {
	const services: ServiceDefinition[] = [];
	const commonServiceDirs = [
		"ui", "frontend", "web", "client",
		"api", "backend", "server",
		"app", "service"
	];

	// Check for multiple service directories
	const foundDirs: string[] = [];
	for (const dir of commonServiceDirs) {
		const dirPath = path.join(appDir, dir);
		if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
			// Skip mobile-only dirs
			if (isMobileOnlyDir(dir, dirPath)) continue;
			foundDirs.push(dir);
		}
	}

	// If we found multiple service directories, treat as multi-service
	if (foundDirs.length > 1) {
		for (const dir of foundDirs) {
			const serviceDir = path.join(appDir, dir);
			const language = detectLanguage(serviceDir);
			
			if (language) {
				const framework = detectFramework(serviceDir);
				services.push({
					name: dir,
					workdir: serviceDir,
					language,
					port: framework === "nextjs" ? 3000 : getDefaultPort(language),
					framework,
				});
			}
		}

		if (services.length > 1) {
			return {
				isMultiService: true,
				services,
				hasDockerCompose: false,
				isMonorepo: false,
			};
		}
	}

	// Check for multiple Dockerfiles
	const dockerfiles = findDockerfiles(appDir);
		if (dockerfiles.length > 1) {
			for (const dockerfile of dockerfiles) {
				const serviceName = extractServiceNameFromDockerfile(dockerfile);
				const dockerfileDir = path.dirname(dockerfile);
				const language = detectLanguage(dockerfileDir);

				if (language) {
					services.push({
						name: serviceName,
						workdir: dockerfileDir,
						language,
						dockerfile: path.basename(dockerfile),
						port: getDefaultPort(language)
					});
				}
			}

		if (services.length > 1) {
			return {
				isMultiService: true,
				services,
				hasDockerCompose: false,
				isMonorepo: false,
			};
		}
	}

	return null;
}

/**
 * Detects the programming language of a directory
 */
function detectLanguage(dir: string): string | undefined {
	if (fs.existsSync(path.join(dir, "package.json"))) return "node";
	if (fs.existsSync(path.join(dir, "requirements.txt"))) return "python";
	if (fs.existsSync(path.join(dir, "go.mod"))) return "go";
	if (fs.existsSync(path.join(dir, "pom.xml")) || fs.existsSync(path.join(dir, "build.gradle"))) return "java";
	if (fs.existsSync(path.join(dir, "Cargo.toml"))) return "rust";
	// Check for .NET projects
	if (globMatch(dir, "*.csproj") || globMatch(dir, "*.sln")) return "dotnet";
	if (fs.existsSync(path.join(dir, "composer.json"))) return "php";
	return undefined;
}

/**
 * Finds all Dockerfiles in a directory
 */
function findDockerfiles(dir: string): string[] {
	const dockerfiles: string[] = [];
	
	function search(currentDir: string, depth: number = 0) {
		if (depth > 3) return; // Limit search depth

		try {
			const entries = fs.readdirSync(currentDir);
			
			for (const entry of entries) {
				const fullPath = path.join(currentDir, entry);
				const stat = fs.statSync(fullPath);

				if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
					search(fullPath, depth + 1);
				} else if (entry === "Dockerfile" || entry.startsWith("Dockerfile.")) {
					dockerfiles.push(fullPath);
				}
			}
		} catch (error) {
			// Ignore permission errors
		}
	}

	search(dir);
	return dockerfiles;
}

/**
 * Extracts service name from Dockerfile path
 */
function extractServiceNameFromDockerfile(dockerfilePath: string): string {
	const basename = path.basename(dockerfilePath);
	if (basename.startsWith("Dockerfile.")) {
		return basename.replace("Dockerfile.", "");
	}
	const dirname = path.basename(path.dirname(dockerfilePath));
	return dirname || "app";
}

/**
 * Checks if a service is a database service
 */
function isDatabaseService(serviceName: string, config: any): boolean {
	const dbKeywords = ["db", "database", "postgres", "mysql", "mssql", "mongodb", "redis", "sqlite"];
	const image = config.image || "";
	const serviceLower = serviceName.toLowerCase();
	
	return dbKeywords.some(keyword => 
		serviceLower.includes(keyword) || image.toLowerCase().includes(keyword)
	);
}

/**
 * Extracts port from docker-compose service config
 */
function extractPort(config: any): number | undefined {
	if (config.ports && Array.isArray(config.ports)) {
		const portMapping = config.ports[0];
		if (typeof portMapping === "string") {
			const match = portMapping.match(/:(\d+)/);
			return match ? parseInt(match[1]) : undefined;
		}
	}
	return undefined;
}

/**
 * Gets default port for a language
 */
function getDefaultPort(language: string): number {
	const portMap: Record<string, number> = {
		node: 3000,
		python: 8000,
		go: 8080,
		java: 8080,
		rust: 8080,
		dotnet: 5000,
		php: 8000
	};
	return portMap[language] || 8080;
}

/**
 * Simple glob matching helper
 */
function globMatch(dir: string, pattern: string): boolean {
	try {
		const files = fs.readdirSync(dir);
		const regex = new RegExp(pattern.replace("*", ".*"));
		return files.some(file => regex.test(file));
	} catch {
		return false;
	}
}

/**
 * True when the repo root looks like Expo / React Native / Flutter (not a cloud server app).
 */
function isMobileOnlyRootProject(appDir: string): boolean {
	const pkgPath = path.join(appDir, "package.json");
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			if (deps["react-native"] || deps["expo"] || deps["@expo/cli"]) return true;
		} catch {
			/* ignore */
		}
	}
	if (fs.existsSync(path.join(appDir, "pubspec.yaml"))) return true;
	return false;
}

function inferRootServiceName(appDir: string): string {
	const pkgPath = path.join(appDir, "package.json");
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
			if (typeof pkg.name === "string" && pkg.name.trim()) {
				const raw = pkg.name.trim();
				const cleaned = raw
					.replace(/^@[^/]+\//, "")
					.replace(/[^a-zA-Z0-9._-]/g, "-")
					.replace(/^-+|-+$/g, "");
				if (cleaned) return cleaned.slice(0, 64);
			}
		} catch {
			/* ignore */
		}
	}
	return "app";
}

/**
 * One deployable app at the repository root (standalone Next.js, Express, etc.).
 * Skipped when workspace-style monorepo tooling is present so we do not treat a turbo/pnpm root as a runnable service when apps live under workspaces.
 */
function resolveComposeBuildContextAbs(composeDirAbs: string, contextRaw: unknown, fallbackAbs: string): string {
	const raw = typeof contextRaw === "string" ? contextRaw.trim() : "";
	const ctx = (raw || ".").replace(/^\.\//, "");
	try {
		return path.resolve(composeDirAbs, ctx);
	} catch {
		return fallbackAbs;
	}
}

function serviceDedupeKeyFromDefinition(appDir: string, s: ServiceDefinition): string {
	const rp = s.relativePath?.trim();
	if (rp && rp !== ".") return normalizeCatalogPath(rp);
	if (typeof s.workdir === "string" && path.isAbsolute(s.workdir)) {
		return normalizeCatalogPath(path.relative(appDir, s.workdir));
	}
	if (typeof s.workdir === "string") {
		return normalizeCatalogPath(s.workdir);
	}
	return normalizeCatalogPath(s.name || "app");
}

/**
 * Deploy-time discovery aligned with the repo catalog: nested compose (no root compose result),
 * Dockerfile directories (depth 6), root-level sibling apps, merge with pattern-based detection,
 * then optional root app at "." when missing.
 */
function buildNonMonorepoDeployServiceList(
	appDir: string,
	rootServiceNameHint?: string
): { services: ServiceDefinition[]; hasDockerCompose: boolean } {
	const hint = rootServiceNameHint?.trim();
	const usedNames = new Set<string>();
	let hasDockerCompose = false;
	const out: ServiceDefinition[] = [];
	const composeStackRels = new Set<string>();

	for (const composeAbs of dedupedComposePaths(appDir)) {
		const composeDirAbs = path.dirname(composeAbs);
		const relStack = normalizeCatalogPath(path.relative(appDir, composeDirAbs));
		if (relStack === ".") continue;

		const inner = parseComposeFileNonDbServices(composeAbs);
		if (inner.length === 0) continue;

		hasDockerCompose = true;
		composeStackRels.add(relStack);

		const folderId =
			relStack === "."
				? sanitizeFolderServiceId(hint || path.basename(appDir)) || "compose"
				: sanitizeFolderServiceId(path.basename(relStack)) || "compose";

		if (inner.length === 1) {
			const s = inner[0];
			const ctx = (s as ServiceDefinition & { build_context?: string }).build_context;
			const workAbs = resolveComposeBuildContextAbs(composeDirAbs, ctx, composeDirAbs);
			const buildCtxRel = normalizeCatalogPath(path.relative(appDir, workAbs));
			const nm = allocateCatalogServiceName(usedNames, folderId);
			out.push({
				...s,
				name: nm,
				workdir: workAbs,
				relativePath: relStack,
				build_context: buildCtxRel,
			});
		} else {
			for (const s of inner) {
				const ctx = (s as ServiceDefinition & { build_context?: string }).build_context;
				const workAbs = resolveComposeBuildContextAbs(composeDirAbs, ctx, composeDirAbs);
				const buildCtxRel = normalizeCatalogPath(path.relative(appDir, workAbs));
				const nm = allocateCatalogServiceName(usedNames, `${folderId}-${sanitizeFolderServiceId(s.name)}`);
				out.push({
					...s,
					name: nm,
					workdir: workAbs,
					relativePath: relStack,
					build_context: buildCtxRel,
				});
			}
		}
	}

	const claimedForDockerSibling = new Set<string>([...composeStackRels]);

	const dockerSlug = sanitizeFolderServiceId(hint || path.basename(appDir)) || "app";
	for (const absDir of dedupedDockerfileParentDirs(appDir)) {
		const relPosix = normalizeCatalogPath(path.relative(appDir, absDir));
		if (claimedForDockerSibling.has(relPosix)) continue;

		const dockerfile = pickPrimaryDockerfileInDir(absDir);
		if (!dockerfile) continue;

		const detectedLang = detectLanguage(absDir);
		const lang = detectedLang || "unknown";
		const framework = detectFramework(absDir);
		const port = framework === "nextjs" ? 3000 : getDefaultPort(lang);
		const baseName =
			relPosix === "." ? dockerSlug : sanitizeFolderServiceId(path.basename(relPosix)) || "app";
		const name = allocateCatalogServiceName(usedNames, baseName);

		out.push({
			name,
			workdir: absDir,
			language: lang,
			framework,
			port,
			dockerfile,
			relativePath: relPosix,
			build_context: relPosix === "." ? "." : relPosix,
		});
		claimedForDockerSibling.add(relPosix);
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(appDir, { withFileTypes: true });
	} catch {
		entries = [];
	}
	for (const e of entries) {
		if (!e.isDirectory() || e.name.startsWith(".")) continue;
		if (COMPOSE_CATALOG_SKIP_DIRS.has(e.name)) continue;
		const relPosix = normalizeCatalogPath(e.name);
		if (claimedForDockerSibling.has(relPosix)) continue;
		const absPath = path.join(appDir, e.name);
		if (isMobileOnlyDir(e.name, absPath)) continue;
		const language = detectLanguage(absPath);
		if (!language) continue;
		const framework = detectFramework(absPath);
		const port = framework === "nextjs" ? 3000 : getDefaultPort(language);
		const name = allocateCatalogServiceName(usedNames, sanitizeFolderServiceId(e.name) || e.name);
		out.push({
			name,
			workdir: absPath,
			language,
			framework,
			port,
			relativePath: relPosix,
			build_context: relPosix,
		});
		claimedForDockerSibling.add(relPosix);
	}

	let combined = dedupeCombinedServiceNames(out);

	const keySet = new Set(combined.map((s) => serviceDedupeKeyFromDefinition(appDir, s)));
	const patternConfig = detectMultiServicePatterns(appDir);
	if (patternConfig?.services?.length) {
		for (const p of patternConfig.services) {
			const k = serviceDedupeKeyFromDefinition(appDir, p);
			if (keySet.has(k)) continue;
			keySet.add(k);
			combined.push(p);
		}
		combined = dedupeCombinedServiceNames(combined);
	}

	const pathSet = new Set(combined.map((s) => normalizeCatalogPath(s.relativePath || ".")));
	if (!pathSet.has(".")) {
		const rootApp = detectSingleRootService(appDir, hint);
		if (rootApp) {
			combined = dedupeCombinedServiceNames([...combined, rootApp]);
		}
	}

	return { services: combined, hasDockerCompose };
}

function detectSingleRootService(appDir: string, rootServiceNameHint?: string): ServiceDefinition | null {
	const tooling = detectMonorepoTooling(appDir);
	if (tooling.isMonorepo) return null;
	if (isMobileOnlyRootProject(appDir)) return null;

	const language = detectLanguage(appDir);
	if (!language) return null;

	const framework = detectFramework(appDir);
	const port = framework === "nextjs" ? 3000 : getDefaultPort(language);

	const hint = rootServiceNameHint?.trim();
	const stableName = hint ? sanitizeFolderServiceId(hint) : inferRootServiceName(appDir);

	return {
		name: stableName,
		workdir: appDir,
		language,
		port,
		framework,
		relativePath: ".",
		build_context: ".",
	};
}

/**
 * Main function to detect multi-service configuration
 */
export function detectMultiService(appDir: string, options?: DetectMultiServiceOptions): MultiServiceConfig {
	const rootServiceNameHint = options?.rootServiceNameHint;

	// Root docker-compose
	const composeConfig = detectDockerCompose(appDir);
	if (composeConfig && isInfraOnlyComposeServiceList(composeConfig.services)) {
		const projectsCompose = detectProjectsSubfolderComposes(appDir);
		if (projectsCompose && projectsCompose.services.length > 0) {
			return projectsCompose;
		}
	}
	if (composeConfig) {
		return composeConfig;
	}

	// Compose only under projects/ (no root docker-compose)
	const projectsOnlyCompose = detectProjectsSubfolderComposes(appDir);
	if (projectsOnlyCompose && projectsOnlyCompose.services.length > 0) {
		return projectsOnlyCompose;
	}

	// Then, try monorepo detection (pnpm workspaces, turborepo, nx, lerna)
	const monorepoConfig = detectMonorepoServices(appDir);
	if (monorepoConfig) {
		return monorepoConfig;
	}

	// Nested compose + Dockerfile walk + root siblings, merged with pattern heuristics (aligned with discoverServiceCatalog)
	const mergedNonMono = buildNonMonorepoDeployServiceList(appDir, rootServiceNameHint);
	if (mergedNonMono.services.length > 0) {
		return {
			isMultiService: mergedNonMono.services.length > 1,
			services: mergedNonMono.services,
			hasDockerCompose: mergedNonMono.hasDockerCompose,
			isMonorepo: false,
		};
	}

	const singleRoot = detectSingleRootService(appDir, rootServiceNameHint);
	if (singleRoot) {
		return {
			isMultiService: false,
			services: [singleRoot],
			hasDockerCompose: false,
			isMonorepo: false,
		};
	}

	// Nothing detected
	return {
		isMultiService: false,
		services: [],
		hasDockerCompose: false,
		isMonorepo: false,
	};
}

/**
 * Service catalog for the repo **settings** list (not deploy-time `detectMultiService`).
 *
 * 1. **Docker Compose** — every directory (up to a depth limit) that has a compose file with at least one
 *    non-database service becomes one catalog row. Multiple compose files → multiple rows.
 * 2. **JavaScript monorepo** — workspace packages under apps/*, services/*, packages/*, modules/*, projects/*, merged in after compose rows;
 *    entries whose path matches a compose directory are skipped to avoid duplicates.
 * 3. **Dockerfile** — each directory (same depth/skip rules) that contains a Dockerfile becomes a row when the path
 *    is not already claimed by compose or monorepo.
 * 4. **Root sibling apps** — immediate subdirectories with a detectable stack (package.json, .csproj, etc.) that are
 *    not already claimed; covers repos like `api/` + `ui/` with no root package.json.
 * 5. **Repository root app** — when a runnable root app exists and `.` is not already a catalog path (e.g. Next.js at
 *    root plus a sibling `api/` folder).
 * 6. Otherwise one **placeholder** at `.`.
 */
export function discoverServiceCatalog(repoRoot: string, repoSlug: string): MultiServiceConfig {
	const usedNames = new Set<string>();
	const composeEntries = discoverComposeCatalogEntries(repoRoot, repoSlug, usedNames);

	const monorepoConfig = detectMonorepoServices(repoRoot);
	const composeRelSet = new Set(composeEntries.map((s) => normalizeCatalogPath(s.relativePath || ".")));

	const monorepoServices =
		monorepoConfig?.services.filter((svc) => {
			const p = normalizeCatalogPath(svc.relativePath || ".");
			return !composeRelSet.has(p);
		}) ?? [];

	for (const s of monorepoServices) {
		if (s.name) usedNames.add(s.name);
	}

	const claimedPaths = new Set<string>([
		...composeRelSet,
		...monorepoServices.map((s) => normalizeCatalogPath(s.relativePath || ".")),
	]);

	const dockerfileEntries = discoverDockerfileCatalogEntries(repoRoot, repoSlug, usedNames, claimedPaths);
	for (const s of dockerfileEntries) {
		claimedPaths.add(normalizeCatalogPath(s.relativePath || "."));
	}

	const siblingEntries = discoverRootSiblingAppEntries(repoRoot, usedNames, claimedPaths);
	for (const s of siblingEntries) {
		claimedPaths.add(normalizeCatalogPath(s.relativePath || "."));
	}

	let combinedRaw = [...composeEntries, ...monorepoServices, ...dockerfileEntries, ...siblingEntries];

	const pathSet = new Set(combinedRaw.map((s) => normalizeCatalogPath(s.relativePath || ".")));
	if (!pathSet.has(".")) {
		const rootApp = detectSingleRootService(repoRoot, repoSlug);
		if (rootApp) {
			combinedRaw = [...combinedRaw, rootApp];
		}
	}

	if (combinedRaw.length > 0) {
		const combined = dedupeCombinedServiceNames(combinedRaw);
		return {
			isMultiService: combined.length > 1,
			services: combined,
			hasDockerCompose: composeEntries.length > 0,
			isMonorepo: Boolean(monorepoConfig?.isMonorepo && monorepoServices.length > 0),
			packageManager: monorepoConfig?.packageManager,
		};
	}

	const singleRoot = detectSingleRootService(repoRoot, repoSlug);
	if (singleRoot) {
		return {
			isMultiService: false,
			services: [singleRoot],
			hasDockerCompose: false,
			isMonorepo: false,
		};
	}

	const fallbackName = sanitizeFolderServiceId(repoSlug) || "app";
	return {
		isMultiService: false,
		services: [
			{
				name: fallbackName,
				workdir: repoRoot,
				language: "unknown",
				relativePath: ".",
				build_context: ".",
			},
		],
		hasDockerCompose: false,
		isMonorepo: false,
	};
}
