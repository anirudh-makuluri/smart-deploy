import fs from "fs";
import path from "path";
import type { PackageManager, SDArtifactsResponse, StaticServiceType } from "@/app/types";

const PACKAGE_MANAGER_LOCKFILES: Array<{ manager: PackageManager; filenames: string[] }> = [
	{ manager: "pnpm", filenames: ["pnpm-lock.yaml"] },
	{ manager: "yarn", filenames: ["yarn.lock"] },
	{ manager: "npm", filenames: ["package-lock.json"] },
	{ manager: "bun", filenames: ["bun.lockb", "bun.lock"] },
];

type PackageJsonShape = {
	name?: string;
	packageManager?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
};

function normalizeServicePath(value?: string): string {
	return (value ?? ".").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "") || ".";
}

function readJsonIfExists<T>(filePath: string): T | null {
	try {
		if (!fs.existsSync(filePath)) return null;
		return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
	} catch {
		return null;
	}
}

function detectPackageManager(repoRoot: string, serviceRoot: string, pkg: PackageJsonShape | null): PackageManager {
	const packageManagerField = (pkg?.packageManager ?? "").trim().toLowerCase();
	if (packageManagerField.startsWith("pnpm")) return "pnpm";
	if (packageManagerField.startsWith("yarn")) return "yarn";
	if (packageManagerField.startsWith("bun")) return "bun";
	if (packageManagerField.startsWith("npm")) return "npm";

	for (const baseDir of [serviceRoot, repoRoot]) {
		for (const candidate of PACKAGE_MANAGER_LOCKFILES) {
			if (candidate.filenames.some((filename) => fs.existsSync(path.join(baseDir, filename)))) {
				return candidate.manager;
			}
		}
	}

	return "npm";
}

function scriptRunner(packageManager: PackageManager, scriptName: string): string {
	if (packageManager === "npm") return `npm run ${scriptName}`;
	if (packageManager === "bun") return `bun run ${scriptName}`;
	return `${packageManager} ${scriptName}`;
}

function installCommand(packageManager: PackageManager): string {
	switch (packageManager) {
		case "pnpm":
			return "pnpm install --frozen-lockfile";
		case "yarn":
			return "yarn install --frozen-lockfile";
		case "bun":
			return "bun install --frozen-lockfile";
		case "npm":
		default:
			return "npm install";
	}
}

function detectOutputDir(serviceType: StaticServiceType, serviceRoot: string): string {
	if (serviceType === "cra") return "build";
	if (serviceType === "next-export") return "out";
	if (serviceType === "static-html") return ".";
	if (serviceType === "angular") {
		const angularJson = readJsonIfExists<Record<string, unknown>>(path.join(serviceRoot, "angular.json"));
		const projects = angularJson?.projects as Record<string, unknown> | undefined;
		const firstProject = projects ? Object.values(projects)[0] as Record<string, unknown> | undefined : undefined;
		const architect = firstProject?.architect as Record<string, unknown> | undefined;
		const build = architect?.build as Record<string, unknown> | undefined;
		const options = build?.options as Record<string, unknown> | undefined;
		const outputPath = typeof options?.outputPath === "string" ? options.outputPath.trim() : "";
		return outputPath || "dist";
	}
	return "dist";
}

function shouldUseSpaFallback(serviceType: StaticServiceType): boolean {
	return ["vite", "cra", "vue", "angular", "svelte"].includes(serviceType);
}

function detectLanguage(serviceRoot: string, pkg: PackageJsonShape | null): string {
	const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
	if (deps.typescript || fs.existsSync(path.join(serviceRoot, "tsconfig.json"))) return "typescript";
	return "javascript";
}

function inferFrameworkLabel(serviceType: StaticServiceType): string {
	switch (serviceType) {
		case "cra":
			return "react";
		case "next-export":
			return "nextjs";
		case "static-html":
			return "static";
		default:
			return serviceType;
	}
}

export function generateStaticNginxConf(outputDir: string, spaFallback: boolean): string {
	const normalizedRoot = outputDir === "." ? "/var/www/app" : `/var/www/app/${outputDir.replace(/^\.?\//, "").replace(/\/+$/, "")}`;
	const fallbackLine = spaFallback
		? "            try_files $uri $uri/ /index.html;"
		: "            try_files $uri $uri/ =404;";

	return `events {}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    sendfile      on;

    server {
        listen 80 default_server;
        server_name _;
        root ${normalizedRoot};
        index index.html;

        location / {
${fallbackLine}
        }
    }
}
`;
}

export function buildDirectStaticScanResults(
	repoRoot: string,
	servicePath: string,
	serviceType: StaticServiceType
): SDArtifactsResponse {
	const normalizedServicePath = normalizeServicePath(servicePath);
	const serviceRoot = normalizedServicePath === "." ? repoRoot : path.join(repoRoot, normalizedServicePath);
	const pkg = readJsonIfExists<PackageJsonShape>(path.join(serviceRoot, "package.json"));
	const packageManager = detectPackageManager(repoRoot, serviceRoot, pkg);
	const buildScript = typeof pkg?.scripts?.build === "string" && pkg.scripts.build.trim() ? scriptRunner(packageManager, "build") : null;
	const outputDir = detectOutputDir(serviceType, serviceRoot);
	const spaFallback = shouldUseSpaFallback(serviceType);
	const stackSummary = `Prefilled rule-based static deployment for ${serviceType}`;
	const install = pkg ? [installCommand(packageManager)] : [];
	const build = buildScript ? [buildScript] : [];
	const framework = inferFrameworkLabel(serviceType);
	const language = detectLanguage(serviceRoot, pkg);

	return {
		commit_sha: "",
		stack_tokens: [],
		files: [],
		risks: [],
		confidence: 1,
		token_usage: {
			input_tokens: 0,
			output_tokens: 0,
			total_tokens: 0,
		},
		stack_summary: stackSummary,
		services: [],
		dockerfiles: {},
		docker_compose: "",
		nginx_conf: generateStaticNginxConf(outputDir, spaFallback),
		has_existing_dockerfiles: false,
		has_existing_compose: false,
		hadolint_results: {},
		serviceType,
		workdir: normalizedServicePath,
		package_manager: packageManager,
		install,
		build,
		output_dir: outputDir,
		spa_fallback: spaFallback,
		framework,
		language,
	};
}

export function isDirectStaticServiceType(value: unknown): value is StaticServiceType {
	return (
		value === "vite" ||
		value === "cra" ||
		value === "vue" ||
		value === "angular" ||
		value === "svelte" ||
		value === "astro" ||
		value === "next-export" ||
		value === "static-html"
	);
}
