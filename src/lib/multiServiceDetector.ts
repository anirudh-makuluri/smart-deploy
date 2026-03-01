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

/**
 * Detects if a docker-compose.yml file exists and parses it
 */
export function detectDockerCompose(appDir: string): MultiServiceConfig | null {
	console.log("detectDockerCompose", appDir);
	const composeFiles = [
		"docker-compose.yml",
		"docker-compose.yaml",
		"compose.yml",
		"compose.yaml"
	];

	for (const file of composeFiles) {
		const composePath = path.join(appDir, file);
		
		if (fs.existsSync(composePath)) {
			console.log("composePath", composePath);
			try {
				const content = fs.readFileSync(composePath, "utf-8");
				const compose = yaml.load(content) as any;

				console.log("compose", compose);

				if (compose && compose.services) {
					const services: ServiceDefinition[] = [];

					for (const [serviceName, serviceConfig] of Object.entries(compose.services as any)) {
						const config = serviceConfig as any;

						console.log("serviceConfig", serviceConfig);
						
						// Skip database services (we'll handle them separately)
						if (isDatabaseService(serviceName, config)) {
							continue;
						}

						const service: ServiceDefinition = {
							name: serviceName,
							workdir: config.build?.context || appDir,
							dockerfile: config.build?.dockerfile || (fs.existsSync(path.join(appDir, `Dockerfile.${serviceName}`)) ? `Dockerfile.${serviceName}` : undefined),
							port: extractPort(config),
							env_vars: config.environment || {},
							depends_on: config.depends_on || [],
							build_context: config.build?.context || appDir
						};

						// Detect language if no dockerfile specified
						if (!service.dockerfile && service.workdir) {
							service.language = detectLanguage(service.workdir);
						}

						services.push(service);
					}

					if (services.length > 0) {
						return {
							isMultiService: true,
							services,
							hasDockerCompose: true,
							isMonorepo: false,
						};
					}
				}
			} catch (error) {
				console.error(`Error parsing docker-compose file: ${error}`);
			}
		}
	}

	return null;
}

/** Directories that commonly hold deployable apps inside a monorepo */
const MONOREPO_APP_ROOTS = ["apps", "services", "packages", "modules"];

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
 * Main function to detect multi-service configuration
 */
export function detectMultiService(appDir: string): MultiServiceConfig {
	// First, try docker-compose
	const composeConfig = detectDockerCompose(appDir);
	if (composeConfig) {
		return composeConfig;
	}

	// Then, try monorepo detection (pnpm workspaces, turborepo, nx, lerna)
	const monorepoConfig = detectMonorepoServices(appDir);
	if (monorepoConfig) {
		return monorepoConfig;
	}

	// Then, try algorithmic detection
	const patternConfig = detectMultiServicePatterns(appDir);
	if (patternConfig) {
		return patternConfig;
	}

	// Single service
	return {
		isMultiService: false,
		services: [],
		hasDockerCompose: false,
		isMonorepo: false,
	};
}
