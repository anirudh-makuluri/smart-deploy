import type {
	DeployConfig,
	DeploymentHealthCheck,
	DeploymentRemediationChange,
	RemediationRiskLevel,
	DeployStep,
	SDArtifactsResponse,
} from "@/app/types";
import { buildRemediationDiffPreview, type RemediationDiffEntry } from "@/lib/remediationDiff";

type DerivedRemediationProposal = {
	summary?: string;
	rootCause?: string | null;
	riskLevel: RemediationRiskLevel;
	confidence: number;
	changes: DeploymentRemediationChange[];
	filesToModify: string[];
	diffPreview: RemediationDiffEntry[];
	expectedOutcome: string | null;
	proposedConfigPatch: Partial<Pick<DeployConfig, "envVars">>;
};

function getPrimaryServicePort(scanResults: DeployConfig["scanResults"]): number | null {
	if (!scanResults || typeof scanResults !== "object" || !("services" in scanResults)) return null;
	const services = scanResults.services as Array<{ port?: number }> | undefined;
	const port = services?.[0]?.port;
	return typeof port === "number" && Number.isFinite(port) ? port : null;
}

function getServiceCount(scanResults: DeployConfig["scanResults"]): number {
	if (!scanResults || typeof scanResults !== "object" || !("services" in scanResults)) return 0;
	const services = scanResults.services as Array<unknown> | undefined;
	return Array.isArray(services) ? services.length : 0;
}

function updatePortEnvVars(envVars: string | null | undefined, port: number): string {
	const lines = (envVars || "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const existingIndex = lines.findIndex((line) => line.startsWith("PORT="));
	if (existingIndex >= 0) {
		lines[existingIndex] = `PORT=${port}`;
	} else {
		lines.push(`PORT=${port}`);
	}
	return lines.join("\n");
}

function updateComposePorts(compose: string, port: number): string {
	return compose.replace(/(^\s*-\s*["']?)(\d+):(\d+)(["']?\s*$)/gm, (_m, prefix, _host, _container, suffix) => {
		return `${prefix}${port}:${port}${suffix}`;
	});
}

function updateNginxPort(nginxConf: string, port: number): string {
	return nginxConf.replace(/127\.0\.0\.1:\d+/g, `127.0.0.1:${port}`);
}

function logsSuggestProxyOrPortIssue(steps: DeployStep[] = [], healthCheck?: Omit<DeploymentHealthCheck, "id"> | DeploymentHealthCheck | null) {
	const text = [
		healthCheck?.failure_type,
		healthCheck?.error_message,
		...steps.flatMap((step) => step.logs ?? []),
	]
		.filter(Boolean)
		.join("\n")
		.toLowerCase();
	return /502|504|upstream|connection refused|proxy_pass|timeout/.test(text);
}

export function deriveRemediationProposal(args: {
	deployConfig: DeployConfig;
	steps?: DeployStep[];
	healthCheck?: Omit<DeploymentHealthCheck, "id"> | DeploymentHealthCheck | null;
}): DerivedRemediationProposal {
	const { deployConfig, steps = [], healthCheck } = args;
	const currentScanResults = deployConfig.scanResults as SDArtifactsResponse;
	const proposedScanResults: SDArtifactsResponse = {
		...(currentScanResults || {}),
	} as SDArtifactsResponse;
	const proposedConfigPatch: Partial<Pick<DeployConfig, "envVars">> = {};
	const proposedConfig: Partial<DeployConfig> = { ...deployConfig };
	const changes: DeploymentRemediationChange[] = [];
	const filesToModify = new Set<string>();
	const primaryPort = getPrimaryServicePort(deployConfig.scanResults);
	const serviceCount = getServiceCount(deployConfig.scanResults);
	let summary: string | undefined;
	let rootCause: string | null = null;
	let riskLevel: RemediationRiskLevel = "moderate";
	let confidence = 0.38;

	if (primaryPort && logsSuggestProxyOrPortIssue(steps, healthCheck)) {
		const nginxConf = typeof currentScanResults?.nginx_conf === "string" ? currentScanResults.nginx_conf : "";
		if (nginxConf && !nginxConf.includes(`127.0.0.1:${primaryPort}`)) {
			proposedScanResults.nginx_conf = updateNginxPort(nginxConf, primaryPort);
			changes.push({
				title: "Align nginx upstream port",
				description: `Update nginx upstream references to use the detected service port ${primaryPort}.`,
				target: "nginx.conf",
			});
			filesToModify.add("nginx.conf");
		}

		const compose = typeof currentScanResults?.docker_compose === "string" ? currentScanResults.docker_compose : "";
		if (serviceCount === 1 && compose && !compose.includes(`${primaryPort}:${primaryPort}`)) {
			proposedScanResults.docker_compose = updateComposePorts(compose, primaryPort);
			changes.push({
				title: "Align docker-compose port mapping",
				description: `Update exposed compose ports to ${primaryPort}:${primaryPort} to match the detected service port.`,
				target: "docker-compose.yml",
			});
			filesToModify.add("docker-compose.yml");
		}
	}

	if (primaryPort) {
		const updatedEnvVars = updatePortEnvVars(deployConfig.envVars, primaryPort);
		if (updatedEnvVars !== (deployConfig.envVars || "")) {
			proposedConfigPatch.envVars = updatedEnvVars;
			proposedConfig.envVars = updatedEnvVars;
			changes.push({
				title: "Ensure PORT env var is wired",
				description: `Set PORT=${primaryPort} in the Smart Deploy runtime environment.`,
				target: "envVars",
			});
			filesToModify.add("envVars");
		}
	}

	if (changes.some((change) => change.target === "nginx.conf" || change.target === "docker-compose.yml")) {
		summary = "Smart Deploy found a likely proxy or port mismatch in the generated deployment artifacts.";
		rootCause = primaryPort
			? `Generated nginx or compose settings do not consistently route traffic to port ${primaryPort}.`
			: "Generated nginx or compose settings are likely pointing to the wrong upstream.";
		riskLevel = "safe";
		confidence = 0.84;
	} else if (changes.some((change) => change.target === "envVars")) {
		summary = "Smart Deploy found a likely runtime PORT wiring mismatch.";
		rootCause = primaryPort
			? `The Smart Deploy runtime environment is not exporting PORT=${primaryPort}.`
			: "The Smart Deploy runtime environment is missing the expected PORT value.";
		riskLevel = "safe";
		confidence = 0.72;
	}

	if (changes.length === 0) {
		changes.push({
			title: "Regenerate deployment artifacts",
			description: "Regenerate deployment artifacts with failure context and retry the deployment.",
			target: "generated-artifacts",
		});
		filesToModify.add("generated-artifacts");
	}

	const diffPreview = buildRemediationDiffPreview({
		currentScanResults: deployConfig.scanResults,
		proposedScanResults,
		currentConfig: deployConfig,
		proposedConfig,
	});

	return {
		summary,
		rootCause,
		riskLevel,
		confidence,
		changes,
		filesToModify: Array.from(filesToModify),
		diffPreview,
		expectedOutcome: primaryPort
			? `Application traffic and runtime configuration should consistently target port ${primaryPort}.`
			: "Updated deployment artifacts should produce a healthy EC2 deployment.",
		proposedConfigPatch,
	};
}
