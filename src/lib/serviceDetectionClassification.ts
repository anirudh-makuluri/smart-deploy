import fs from "fs";
import path from "path";
import type { StaticServiceType } from "@/app/types";

type ServiceClassification = {
	deployMode: "container";
	/** Optional UI hint for likely static framework (analyze determines actual deploy path). */
	serviceType?: StaticServiceType;
};

type ServiceLike = {
	workdir?: string;
	relativePath?: string;
	framework?: string;
	dockerfile?: string;
};

type PackageJsonShape = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
};

const STATIC_CONFIG_FILES = [
	"vite.config.ts",
	"vite.config.js",
	"vite.config.mjs",
	"vite.config.cjs",
	"astro.config.ts",
	"astro.config.js",
	"astro.config.mjs",
	"astro.config.cjs",
	"angular.json",
	"index.html",
];

const COMPOSE_FILE_NAMES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"] as const;
const NEXT_CONFIG_NAMES = ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs"] as const;
const ASTRO_CONFIG_NAMES = ["astro.config.js", "astro.config.mjs", "astro.config.ts", "astro.config.cjs"] as const;

function normalizeRelativePath(value?: string): string {
	return (value ?? ".").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "") || ".";
}

function resolveServiceRoot(repoRoot: string, service: ServiceLike): string {
	if (service.relativePath && service.relativePath.trim() && service.relativePath.trim() !== ".") {
		return path.join(repoRoot, normalizeRelativePath(service.relativePath));
	}
	if (service.workdir && path.isAbsolute(service.workdir)) return service.workdir;
	if (service.workdir && service.workdir.trim() && service.workdir.trim() !== ".") {
		return path.join(repoRoot, normalizeRelativePath(service.workdir));
	}
	return repoRoot;
}

function fileExists(dir: string, name: string): boolean {
	return fs.existsSync(path.join(dir, name));
}

function readUtf8IfExists(filePath: string): string | null {
	try {
		return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
	} catch {
		return null;
	}
}

function readPackageJson(serviceRoot: string): PackageJsonShape | null {
	const content = readUtf8IfExists(path.join(serviceRoot, "package.json"));
	if (!content) return null;
	try {
		return JSON.parse(content) as PackageJsonShape;
	} catch {
		return null;
	}
}

function collectDependencies(pkg: PackageJsonShape | null): Record<string, string> {
	return {
		...(pkg?.dependencies ?? {}),
		...(pkg?.devDependencies ?? {}),
	};
}

function hasBuildScript(pkg: PackageJsonShape | null): boolean {
	return typeof pkg?.scripts?.build === "string" && pkg.scripts.build.trim().length > 0;
}

function hasStaticConfigFile(serviceRoot: string): boolean {
	return STATIC_CONFIG_FILES.some((file) => fileExists(serviceRoot, file));
}

function hasComposeFile(serviceRoot: string): boolean {
	return COMPOSE_FILE_NAMES.some((file) => fileExists(serviceRoot, file));
}

function hasDockerfile(serviceRoot: string): boolean {
	try {
		return fs.readdirSync(serviceRoot).some((name) => name === "Dockerfile" || name.startsWith("Dockerfile."));
	} catch {
		return false;
	}
}

function isServerFramework(framework?: string): boolean {
	const normalized = (framework ?? "").trim().toLowerCase();
	return ["nextjs", "express", "fastify", "nestjs", "nuxt", "django", "flask", "fastapi"].includes(normalized);
}

function hasExplicitNextStaticExport(serviceRoot: string): boolean {
	for (const name of NEXT_CONFIG_NAMES) {
		const content = readUtf8IfExists(path.join(serviceRoot, name));
		if (!content) continue;
		if (/output\s*:\s*["']export["']/.test(content)) return true;
	}
	return false;
}

function isAstroServerOutput(serviceRoot: string): boolean {
	for (const name of ASTRO_CONFIG_NAMES) {
		const content = readUtf8IfExists(path.join(serviceRoot, name));
		if (!content) continue;
		if (/output\s*:\s*["'](server|hybrid)["']/.test(content)) return true;
	}
	return false;
}

function looksLikePlainStaticSite(serviceRoot: string): boolean {
	if (!fileExists(serviceRoot, "index.html")) return false;
	const pkg = readPackageJson(serviceRoot);
	if (pkg) return false;
	return !hasDockerfile(serviceRoot) && !hasComposeFile(serviceRoot);
}

/** Infer likely static framework for UI only; deploy mode is always container + analyze. */
function inferStaticServiceType(serviceRoot: string, framework: string | undefined): StaticServiceType | undefined {
	const pkg = readPackageJson(serviceRoot);
	const deps = collectDependencies(pkg);
	const frameworkName = (framework ?? "").trim().toLowerCase();

	if (serviceRoot && (hasComposeFile(serviceRoot) || hasDockerfile(serviceRoot))) {
		return undefined;
	}
	if (isServerFramework(frameworkName) && frameworkName !== "nextjs") {
		return undefined;
	}

	if (deps.next || frameworkName === "nextjs") {
		if (!hasExplicitNextStaticExport(serviceRoot) || !hasBuildScript(pkg)) return undefined;
		return "next-export";
	}

	if (deps.astro || frameworkName === "astro") {
		if (isAstroServerOutput(serviceRoot) || !hasBuildScript(pkg)) return undefined;
		return "astro";
	}

	if (deps["@angular/core"] || fileExists(serviceRoot, "angular.json") || frameworkName === "angular") {
		if (!hasBuildScript(pkg)) return undefined;
		return "angular";
	}

	if (deps["react-scripts"]) {
		if (!hasBuildScript(pkg)) return undefined;
		return "cra";
	}

	const hasVite = Boolean(deps.vite) || ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"].some((file) => fileExists(serviceRoot, file));
	if (hasVite) {
		if (!hasBuildScript(pkg)) return undefined;
		if (deps.vue || frameworkName === "vue") return "vue";
		if (deps.svelte || frameworkName === "svelte") return "svelte";
		return "vite";
	}

	if (looksLikePlainStaticSite(serviceRoot)) {
		return "static-html";
	}

	if (hasStaticConfigFile(serviceRoot) && hasBuildScript(pkg)) {
		return "vite";
	}

	return undefined;
}

export function classifyServiceForDetection(repoRoot: string, service: ServiceLike): ServiceClassification {
	if (service.dockerfile) return { deployMode: "container" };

	const serviceRoot = resolveServiceRoot(repoRoot, service);
	const serviceType = inferStaticServiceType(serviceRoot, service.framework);
	return serviceType ? { deployMode: "container", serviceType } : { deployMode: "container" };
}
