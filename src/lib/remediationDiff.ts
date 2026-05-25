import type { DeployConfig, SDArtifactsResponse } from "@/app/types";

export type RemediationDiffEntry = {
	target: string;
	changeType: "added" | "removed" | "modified";
	summary: string;
	before?: string;
	after?: string;
};

function normalizeText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function buildArtifactMap(scanResults: SDArtifactsResponse | Record<string, never> | null | undefined) {
	const map = new Map<string, string>();
	if (!scanResults || typeof scanResults !== "object") return map;

	const dockerfiles = "dockerfiles" in scanResults ? (scanResults.dockerfiles as Record<string, string> | undefined) : undefined;
	for (const [name, content] of Object.entries(dockerfiles ?? {})) {
		if (typeof content === "string") {
			map.set(`artifact:${name}`, content);
		}
	}

	const compose = "docker_compose" in scanResults ? normalizeText(scanResults.docker_compose) : null;
	if (compose) map.set("artifact:docker-compose.yml", compose);

	const nginx = "nginx_conf" in scanResults ? normalizeText(scanResults.nginx_conf) : null;
	if (nginx) map.set("artifact:nginx.conf", nginx);

	return map;
}

function buildRuntimeConfigMap(config: Partial<DeployConfig> | null | undefined) {
	const map = new Map<string, string>();
	if (!config) return map;

	const envVars = normalizeText(config.envVars);
	if (envVars) map.set("config:envVars", envVars);

	const runtimeSnapshot = {
		liveUrl: config.liveUrl ?? null,
		awsRegion: config.awsRegion ?? null,
		deploymentTarget: config.deploymentTarget ?? null,
	};
	map.set("config:runtime", JSON.stringify(runtimeSnapshot, null, 2));

	return map;
}

function summarizeChange(target: string, before: string | undefined, after: string | undefined) {
	if (before == null && after != null) return `Add ${target}`;
	if (before != null && after == null) return `Remove ${target}`;
	if (before === after) return `No change for ${target}`;

	const beforeLines = before?.split("\n").length ?? 0;
	const afterLines = after?.split("\n").length ?? 0;
	return `Update ${target} (${beforeLines} -> ${afterLines} lines)`;
}

function clip(value: string | undefined, maxLength = 4000) {
	if (!value) return value;
	return value.length > maxLength ? `${value.slice(0, maxLength)}\n...` : value;
}

export function buildRemediationDiffPreview(args: {
	currentScanResults?: SDArtifactsResponse | Record<string, never> | null;
	proposedScanResults?: SDArtifactsResponse | Record<string, never> | null;
	currentConfig?: Partial<DeployConfig> | null;
	proposedConfig?: Partial<DeployConfig> | null;
}): RemediationDiffEntry[] {
	const current = new Map<string, string>([
		...buildArtifactMap(args.currentScanResults),
		...buildRuntimeConfigMap(args.currentConfig),
	]);
	const proposed = new Map<string, string>([
		...buildArtifactMap(args.proposedScanResults),
		...buildRuntimeConfigMap(args.proposedConfig),
	]);

	const keys = new Set([...current.keys(), ...proposed.keys()]);
	const diffs: RemediationDiffEntry[] = [];

	for (const key of keys) {
		const before = current.get(key);
		const after = proposed.get(key);
		if (before === after) continue;
		diffs.push({
			target: key,
			changeType: before == null ? "added" : after == null ? "removed" : "modified",
			summary: summarizeChange(key, before, after),
			before: clip(before),
			after: clip(after),
		});
	}

	return diffs.sort((a, b) => a.target.localeCompare(b.target));
}
