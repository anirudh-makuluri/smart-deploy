import fs from "fs";
import path from "path";
import { MultiServiceConfig } from "../multiServiceDetector";
import { DatabaseConfig } from "../databaseDetector";

export type AWSTarget = 'amplify' | 'elastic-beanstalk' | 'ecs' | 'ec2';

export interface DeploymentAnalysis {
	target: AWSTarget;
	reason: string;
	warnings: string[];
}

// Languages supported by Elastic Beanstalk
const EB_SUPPORTED_LANGUAGES = [
	'node',
	'python',
	'java',
	'go',
	'dotnet',
	'php',
	'ruby'
];

// Elastic Beanstalk solution stack mappings
export const EB_SOLUTION_STACKS: Record<string, string> = {
	'node': '64bit Amazon Linux 2023 v6.7.2 running Node.js 20',
	'python': '64bit Amazon Linux 2023 v4.9.1 running Python 3.11',
	'java': '64bit Amazon Linux 2023 v5.9.2 running Corretto 17',
	'go': '64bit Amazon Linux 2023 v3.14.2 running Go 1',
	'dotnet': '64bit Windows Server 2022 v2.22.1 running IIS 10.0',
	'php': '64bit Amazon Linux 2023 v4.0.0 running PHP 8.2',
	'ruby': '64bit Amazon Linux 2023 v4.0.0 running Ruby 3.2'
};

interface FeaturesInfrastructure {
	uses_websockets: boolean;
	uses_cron: boolean;
	uses_mobile: boolean;
	uses_server?: boolean;
	cloud_run_compatible: boolean;
	is_library: boolean;
	requires_build_but_missing_cmd: boolean;
}

/** Language marker files/dirs per runtime */
const LANGUAGE_MARKERS: { marker: string; lang: string }[] = [
	{ marker: "package.json", lang: "node" },
	{ marker: "requirements.txt", lang: "python" },
	{ marker: "go.mod", lang: "go" },
	{ marker: "pom.xml", lang: "java" },
	{ marker: "build.gradle", lang: "java" },
	{ marker: "Cargo.toml", lang: "rust" },
	{ marker: "composer.json", lang: "php" },
	{ marker: "Gemfile", lang: "ruby" },
];

/** Common app subdirectories when repo root has no language markers */
const COMMON_APP_SUBDIRS = ["app", "src", "frontend", "web", "client", "server", "api", "backend"];

/** Monorepo roots that typically contain app folders */
const MONOREPO_ROOTS = ["apps", "packages", "services", "modules"];

function detectLanguageInDir(dir: string, debug = false): string | null {
	if (!fs.existsSync(dir)) {
		if (debug) console.log(`[detectLanguage] Dir does not exist: ${dir}`);
		return null;
	}
	try {
		if (!fs.statSync(dir).isDirectory()) {
			if (debug) console.log(`[detectLanguage] Not a directory: ${dir}`);
			return null;
		}
	} catch {
		return null;
	}
	
	if (debug) {
		try {
			const files = fs.readdirSync(dir);
			console.log(`[detectLanguage] Checking dir: ${dir}`);
			console.log(`[detectLanguage] Files found: ${files.slice(0, 20).join(", ")}${files.length > 20 ? "..." : ""}`);
		} catch { /* ignore */ }
	}
	
	for (const { marker, lang } of LANGUAGE_MARKERS) {
		const markerPath = path.join(dir, marker);
		if (fs.existsSync(markerPath)) {
			if (debug) console.log(`[detectLanguage] Found marker ${marker} -> ${lang}`);
			return lang;
		}
	}
	try {
		const files = fs.readdirSync(dir);
		if (files.some((f) => f.endsWith(".csproj") || f.endsWith(".sln"))) {
			if (debug) console.log(`[detectLanguage] Found .csproj/.sln -> dotnet`);
			return "dotnet";
		}
	} catch {
		// ignore
	}
	return null;
}

/**
 * Detects the primary language of the application (root and common subdirs).
 * Uses multi-service workdirs when present so apps in subdirs are detected.
 */
export function detectLanguage(appDir: string, multiServiceConfig?: MultiServiceConfig | null): string | null {
	console.log(`[detectLanguage] Starting detection for appDir: ${appDir}`);
	
	// 1. Check app root (current workdir)
	let lang = detectLanguageInDir(appDir, true);
	if (lang) {
		console.log(`[detectLanguage] Found at root: ${lang}`);
		return lang;
	}

	// 1b. When workdir is set to a subdir (e.g. "app"), package.json is often at repo root – check parent
	const parentDir = path.dirname(appDir);
	if (parentDir !== appDir && path.basename(appDir).match(/^(app|src|frontend|web|client|server|api|backend)$/)) {
		lang = detectLanguageInDir(parentDir);
		if (lang) {
			console.log(`[detectLanguage] Found at repo root (parent of workdir): ${lang}`);
			return lang;
		}
	}

	// 2. Known app subdirectories
	console.log(`[detectLanguage] Checking common subdirs: ${COMMON_APP_SUBDIRS.join(", ")}`);
	for (const sub of COMMON_APP_SUBDIRS) {
		const subPath = path.join(appDir, sub);
		lang = detectLanguageInDir(subPath);
		if (lang) {
			console.log(`[detectLanguage] Found in subdir ${sub}: ${lang}`);
			return lang;
		}
	}

	// 3. Multi-service: use first service workdir (may be relative to appDir)
	if (multiServiceConfig?.services?.length) {
		console.log(`[detectLanguage] Checking ${multiServiceConfig.services.length} service workdirs`);
		for (const svc of multiServiceConfig.services) {
			const workdir = path.isAbsolute(svc.workdir) ? svc.workdir : path.join(appDir, svc.workdir);
			console.log(`[detectLanguage] Service ${svc.name} workdir: ${workdir}`);
			lang = detectLanguageInDir(workdir);
			if (lang) {
				console.log(`[detectLanguage] Found in service ${svc.name}: ${lang}`);
				return lang;
			}
		}
	}

	// 4. One level of child directories (e.g. repo root apps)
	try {
		const entries = fs.readdirSync(appDir, { withFileTypes: true });
		const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules");
		console.log(`[detectLanguage] Checking ${dirs.length} child dirs: ${dirs.map(d => d.name).join(", ")}`);
		for (const e of dirs) {
			lang = detectLanguageInDir(path.join(appDir, e.name));
			if (lang) {
				console.log(`[detectLanguage] Found in child dir ${e.name}: ${lang}`);
				return lang;
			}
		}
	} catch (err) {
		console.log(`[detectLanguage] Error reading child dirs: ${err}`);
	}

	// 5. Monorepo roots (apps/*, packages/*, etc.)
	for (const root of MONOREPO_ROOTS) {
		const rootPath = path.join(appDir, root);
		try {
			const entries = fs.readdirSync(rootPath, { withFileTypes: true });
			for (const e of entries) {
				if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
					lang = detectLanguageInDir(path.join(rootPath, e.name));
					if (lang) {
						console.log(`[detectLanguage] Found in monorepo ${root}/${e.name}: ${lang}`);
						return lang;
					}
				}
			}
		} catch {
			// ignore - monorepo root doesn't exist
		}
	}

	console.log(`[detectLanguage] No language detected for ${appDir}`);
	return null;
}

/**
 * Checks if an application has a Dockerfile
 */
function hasDockerfile(appDir: string): boolean {
	return fs.existsSync(path.join(appDir, "Dockerfile"));
}

/**
 * Returns true if the app is a Next.js app (package.json has "next" in dependencies or devDependencies).
 * Checks appDir and, if not found, parent when appDir looks like a workdir subdir (e.g. app, frontend).
 */
function isNextJsApp(appDir: string): boolean {
	const tryDir = (dir: string): boolean => {
		const pkgPath = path.join(dir, "package.json");
		if (!fs.existsSync(pkgPath)) return false;
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
				dependencies?: Record<string, string>;
				devDependencies?: Record<string, string>;
			};
			return !!(pkg.dependencies?.next ?? pkg.devDependencies?.next);
		} catch {
			return false;
		}
	};
	if (tryDir(appDir)) return true;
	const parentDir = path.dirname(appDir);
	if (parentDir !== appDir && path.basename(appDir).match(/^(app|src|frontend|web|client|server|api|backend)$/)) {
		return tryDir(parentDir);
	}
	return false;
}

/**
 * Returns true if the app is suitable for AWS Amplify (zip deploy): Node frontend/static app
 * with a build script that produces static output (e.g. CRA build/, Vite dist/, Next.js static export out/).
 */
function isAmplifySuitable(appDir: string): boolean {
	const tryDir = (dir: string): boolean => {
		const pkgPath = path.join(dir, "package.json");
		if (!fs.existsSync(pkgPath)) return false;
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
				scripts?: { build?: string };
				dependencies?: Record<string, string>;
				devDependencies?: Record<string, string>;
			};
			if (!pkg.scripts?.build) return false;
			const isNext = !!(pkg.dependencies?.next ?? pkg.devDependencies?.next);
			if (isNext) {
				const nextConfigPath = path.join(dir, "next.config.js");
				const nextConfigMjs = path.join(dir, "next.config.mjs");
				const nextConfigTs = path.join(dir, "next.config.ts");
				const nextConfigPathToRead = fs.existsSync(nextConfigTs)
					? nextConfigTs
					: fs.existsSync(nextConfigMjs)
						? nextConfigMjs
						: nextConfigPath;
				if (fs.existsSync(nextConfigPathToRead)) {
					const content = fs.readFileSync(nextConfigPathToRead, "utf-8");
					if (/output\s*:\s*['"]export['"]/.test(content)) return true;
				}
				return false;
			}
			return true;
		} catch {
			return false;
		}
	};
	if (tryDir(appDir)) return true;
	const parentDir = path.dirname(appDir);
	if (parentDir !== appDir && path.basename(appDir).match(/^(app|src|frontend|web|client|server|api|backend)$/)) {
		return tryDir(parentDir);
	}
	return false;
}

/**
 * Selects the best AWS deployment target based on application analysis
 * 
 * Priority:
 * 1. Elastic Beanstalk - Simple, single-service apps without special requirements
 * 2. ECS Fargate - Containerized apps, multi-service, or apps with databases
 * 3. EC2 - Complex apps requiring full control
 */
export function selectAWSDeploymentTarget(
	appDir: string,
	multiServiceConfig: MultiServiceConfig,
	dbConfig: DatabaseConfig | null,
	features?: FeaturesInfrastructure | null
): DeploymentAnalysis {
	const warnings: string[] = [];
	const language = detectLanguage(appDir, multiServiceConfig);
	const dockerfile = hasDockerfile(appDir);
	
	// Check for multi-service application
	if (multiServiceConfig.isMultiService && multiServiceConfig.services.length > 1) {
		return {
			target: 'ecs',
			reason: `Multi-service application detected with ${multiServiceConfig.services.length} services. ECS Fargate provides container orchestration for multiple services.`,
			warnings
		};
	}
	
	// Check for database requirements
	if (dbConfig) {
		warnings.push(`Database detected (${dbConfig.type}). AWS RDS will be provisioned.`);
		return {
			target: 'ecs',
			reason: `Application requires ${dbConfig.type} database. ECS Fargate with RDS provides managed database connectivity.`,
			warnings
		};
	}
	
	// Check for WebSocket requirements
	if (features?.uses_websockets) {
		return {
			target: 'ecs',
			reason: 'Application uses WebSockets. ECS Fargate with Application Load Balancer supports WebSocket connections.',
			warnings
		};
	}

	// Prefer Amplify for Node frontend/static apps (zip deploy): SPA or Next.js static export
	if (language === 'node' && !dockerfile && isAmplifySuitable(appDir)) {
		return {
			target: 'amplify',
			reason: 'Frontend/static Node application. AWS Amplify Hosting is used for fast static deploys.',
			warnings
		};
	}
	
	// Check if language is supported by Elastic Beanstalk
	if (language && EB_SUPPORTED_LANGUAGES.includes(language)) {
		// If there's a Dockerfile, prefer ECS for consistency
		if (dockerfile) {
			warnings.push('Dockerfile detected. Using ECS for containerized deployment.');
			return {
				target: 'ecs',
				reason: 'Application has a Dockerfile. ECS Fargate provides native container support.',
				warnings
			};
		}

		// Next.js apps use ECS Fargate for reliable containerized builds and runtime
		if (language === 'node' && isNextJsApp(appDir)) {
			return {
				target: 'ecs',
				reason: 'Next.js application. ECS Fargate is used for Next.js deployments.',
				warnings
			};
		}
		
		// Simple app - use Elastic Beanstalk
		return {
			target: 'elastic-beanstalk',
			reason: `Simple ${language} application. Elastic Beanstalk provides easy deployment and auto-scaling.`,
			warnings
		};
	}
	
	// Unsupported language with Dockerfile - use ECS
	if (dockerfile) {
		return {
			target: 'ecs',
			reason: 'Application has a Dockerfile. ECS Fargate will build and deploy the container.',
			warnings
		};
	}
	
	// Rust or other unsupported languages - need to containerize with ECS
	if (language === 'rust') {
		warnings.push('Rust is not directly supported by Elastic Beanstalk. A Dockerfile will be generated.');
		return {
			target: 'ecs',
			reason: 'Rust application requires containerization. ECS Fargate will handle the deployment.',
			warnings
		};
	}
	
	// Complex app or unknown - fall back to EC2 for full control
	if (!language) {
		warnings.push('Could not detect application language. Full EC2 deployment provides maximum flexibility.');
	}
	
	return {
		target: 'ec2',
		reason: 'Complex application requirements. EC2 provides full control over the deployment environment.',
		warnings
	};
}

/**
 * Gets the Elastic Beanstalk solution stack for a language
 */
export function getEBSolutionStack(language: string): string | null {
	return EB_SOLUTION_STACKS[language] || null;
}

/**
 * Checks if a language is supported by Elastic Beanstalk
 */
export function isEBSupported(language: string): boolean {
	return EB_SUPPORTED_LANGUAGES.includes(language);
}
