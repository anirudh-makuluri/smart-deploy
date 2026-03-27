import fs from "fs";
import path from "path";
import { SDArtifactsResponse } from "@/app/types";
import { detectMultiService } from "@/lib/multiServiceDetector";
import { canonicalDockerfileDeployPath } from "@/lib/dockerfileDeployPath";
import { generateRuleBasedNginxConf } from "@/lib/nginxConf";

const COMPOSE_FILE_CANDIDATES = [
	"docker-compose.yml",
	"docker-compose.yaml",
	"compose.yml",
	"compose.yaml",
];

function normalizeRelPath(p: string): string {
	return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function isWithinScope(relPath: string, packagePath?: string): boolean {
	const normalizedPath = normalizeRelPath(relPath);
	const normalizedScope = normalizeRelPath(packagePath || "");
	if (!normalizedScope || normalizedScope === ".") return true;
	return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function walkFiles(rootDir: string, currentDir: string, files: string[] = []): string[] {
	for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
		if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".next") continue;
		const fullPath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) {
			walkFiles(rootDir, fullPath, files);
			continue;
		}
		files.push(normalizeRelPath(path.relative(rootDir, fullPath)));
	}
	return files;
}

function findComposePath(repoRoot: string): string | undefined {
	for (const candidate of COMPOSE_FILE_CANDIDATES) {
		const fullPath = path.join(repoRoot, candidate);
		if (fs.existsSync(fullPath)) return candidate;
	}
	return undefined;
}

function inferBuildContextFromDockerfile(relPath: string): string {
	const normalized = normalizeRelPath(relPath);
	const lastSlash = normalized.lastIndexOf("/");
	return lastSlash === -1 ? "." : normalized.slice(0, lastSlash) || ".";
}

function toRepoRelativeValue(repoRoot: string, value: string | undefined): string {
	if (!value) return "";
	if (path.isAbsolute(value)) {
		return normalizeRelPath(path.relative(repoRoot, value)) || ".";
	}
	return normalizeRelPath(value) || ".";
}

function findRelevantDockerfiles(repoRoot: string, packagePath?: string): Record<string, string> {
	const allFiles = walkFiles(repoRoot, repoRoot);
	const candidates = allFiles.filter((relPath) => {
		const base = path.posix.basename(relPath).toLowerCase();
		return base === "dockerfile" || base.startsWith("dockerfile.");
	});

	const scoped = candidates.filter((relPath) => isWithinScope(relPath, packagePath));
	const chosen = scoped.length > 0 ? scoped : candidates;

	return chosen.reduce<Record<string, string>>((acc, relPath) => {
		const fullPath = path.join(repoRoot, relPath);
		acc[canonicalDockerfileDeployPath(relPath)] = fs.readFileSync(fullPath, "utf8");
		return acc;
	}, {});
}

function findExistingNginxConf(repoRoot: string, packagePath?: string): string {
	const allFiles = walkFiles(repoRoot, repoRoot);
	const nginxCandidate = allFiles.find((relPath) => {
		const base = path.posix.basename(relPath).toLowerCase();
		return isWithinScope(relPath, packagePath) && (base === "nginx.conf" || base.endsWith(".nginx.conf"));
	});

	if (!nginxCandidate) return "";
	return fs.readFileSync(path.join(repoRoot, nginxCandidate), "utf8");
}

function buildServices(repoRoot: string, dockerfiles: Record<string, string>, packagePath?: string): SDArtifactsResponse["services"] {
	const detected = detectMultiService(repoRoot);
	const normalizedScope = normalizeRelPath(packagePath || "");
	const filteredDetected = detected.services.filter((svc) => {
		const rel = normalizeRelPath(svc.relativePath || svc.build_context || svc.workdir || ".");
		if (!normalizedScope || normalizedScope === ".") return true;
		return rel === normalizedScope || rel.startsWith(`${normalizedScope}/`);
	});

	if (filteredDetected.length > 0) {
		return filteredDetected.map((svc, index) => {
			const rawDockerfile = svc.dockerfile ? normalizeRelPath(svc.dockerfile) : "";
			const matchingDockerfile =
				Object.keys(dockerfiles).find((key) => key === canonicalDockerfileDeployPath(rawDockerfile)) ||
				Object.keys(dockerfiles)[index] ||
				Object.keys(dockerfiles)[0] ||
				"Dockerfile";
			const buildContextRaw =
				svc.relativePath ||
				(typeof svc.build_context === "string" ? toRepoRelativeValue(repoRoot, svc.build_context) : "") ||
				(typeof svc.workdir === "string" ? toRepoRelativeValue(repoRoot, svc.workdir) : "") ||
				inferBuildContextFromDockerfile(matchingDockerfile);

			return {
				name: svc.name || `service-${index + 1}`,
				build_context: buildContextRaw || ".",
				port: svc.port || 8080,
				dockerfile_path: matchingDockerfile,
				language: svc.language,
				framework: svc.framework,
			};
		});
	}

	const dockerfileKeys = Object.keys(dockerfiles);
	if (dockerfileKeys.length === 0) return [];

	return dockerfileKeys.map((dockerfilePath, index) => ({
		name: index === 0 ? "app" : `service-${index + 1}`,
		build_context: inferBuildContextFromDockerfile(dockerfilePath),
		port: 8080,
		dockerfile_path: dockerfilePath,
	}));
}

export function buildPrefilledScanResults(repoRoot: string, packagePath?: string): SDArtifactsResponse | null {
	const dockerfiles = findRelevantDockerfiles(repoRoot, packagePath);
	const composePath = findComposePath(repoRoot);
	const dockerCompose = composePath ? fs.readFileSync(path.join(repoRoot, composePath), "utf8") : "";
	const services = buildServices(repoRoot, dockerfiles, packagePath);
	const mainPort = services[0]?.port || 8080;
	const existingNginxConf = findExistingNginxConf(repoRoot, packagePath);
	const nginxConf = existingNginxConf || generateRuleBasedNginxConf(mainPort);

	if (Object.keys(dockerfiles).length === 0 && !dockerCompose) {
		return null;
	}

	return {
		stack_summary: "Prefilled from repository infrastructure files",
		services,
		dockerfiles,
		docker_compose: dockerCompose,
		nginx_conf: nginxConf,
		has_existing_dockerfiles: Object.keys(dockerfiles).length > 0,
		has_existing_compose: Boolean(dockerCompose),
		risks: [],
		confidence: 1,
		hadolint_results: {},
		token_usage: {
			input_tokens: 0,
			output_tokens: 0,
			total_tokens: 0,
		},
	};
}
