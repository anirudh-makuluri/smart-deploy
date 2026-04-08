import type { BlueprintEdge, BlueprintInput, BlueprintModel, BlueprintNode } from "@/components/blueprint/blueprint-types";
import config from "@/config";
import { DEFAULT_EC2_INSTANCE_TYPE } from "@/lib/aws/ec2InstanceTypes";

const NODE_WIDTH = 232;
const HUB_WIDTH = 280;
const NODE_HEIGHT = 132;
const COLUMN_X = {
	artifacts: 30,
	context: 450,
	infrastructure: 870,
	config: 1290,
} as const;

const ROW_Y = {
	top: 92,
	middle: 266,
	bottom: 440,
} as const;

function envVarCount(raw: string | null | undefined) {
	if (!raw?.trim()) return 0;
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#")).length;
}

function buildArtifactSummary(scanResults: NonNullable<BlueprintInput["scanResults"]>) {
	const parts: string[] = [];
	const dockerfileCount = Object.keys(scanResults.dockerfiles ?? {}).length;
	if (dockerfileCount > 0) parts.push(`${dockerfileCount} Dockerfile${dockerfileCount === 1 ? "" : "s"}`);
	if (scanResults.docker_compose?.trim()) parts.push("Compose");
	if (scanResults.nginx_conf?.trim()) parts.push("Nginx");
	return parts.length > 0 ? parts.join(" / ") : "No generated artifacts";
}

export function buildBlueprintModel({ deployment, scanResults }: BlueprintInput): BlueprintModel {
	if (!scanResults) {
		return {
			nodes: [],
			edges: [],
			issues: [],
			metrics: {
				serviceCount: 0,
				publicEndpoints: 0,
				artifactCount: 0,
			},
		};
	}

	const nodes: BlueprintNode[] = [];
	const edges: BlueprintEdge[] = [];
	const services = scanResults.services ?? [];
	const dockerfileEntries = Object.entries(scanResults.dockerfiles ?? {});
	const artifactCount =
		dockerfileEntries.length +
		(scanResults.docker_compose?.trim() ? 1 : 0) +
		(scanResults.nginx_conf?.trim() ? 1 : 0);
	const primaryService = services.find((service) => service.name === deployment.serviceName) ?? services[0];
	const primaryDockerfile =
		(primaryService?.dockerfile_path && scanResults.dockerfiles?.[primaryService.dockerfile_path] !== undefined)
			? primaryService.dockerfile_path
			: dockerfileEntries[0]?.[0];
	const envCount = envVarCount(deployment.envVars);
	const deployConfigId = "deploy-config";

	nodes.push({
		id: deployConfigId,
		kind: "deployConfig",
		title: "DeployConfig",
		subtitle: `${deployment.cloudProvider.toUpperCase()} / ${deployment.deploymentTarget}`,
		x: COLUMN_X.config,
		y: 280,
		width: HUB_WIDTH,
		height: 168,
		data: {
			service: deployment.serviceName,
			branch: deployment.branch || "not set",
			target: deployment.deploymentTarget,
			provider: deployment.cloudProvider,
			region: deployment.awsRegion || config.AWS_REGION || "us-west-2",
			envVars: envCount,
			artifacts: buildArtifactSummary(scanResults),
		},
	});

	nodes.push({
		id: "service",
		kind: "service",
		title: deployment.serviceName,
		subtitle: primaryService ? [primaryService.framework, primaryService.language].filter(Boolean).join(" / ") || "Detected service" : "Selected service",
		x: COLUMN_X.context,
		y: ROW_Y.top,
		width: NODE_WIDTH,
		height: NODE_HEIGHT,
		data: {
			repo: deployment.repoName,
			service: deployment.serviceName,
			framework: primaryService?.framework || "unknown",
			language: primaryService?.language || "unknown",
		},
	});
	edges.push({
		id: "service-deploy-config",
		from: "service",
		to: deployConfigId,
		kind: "input",
		label: "service",
	});

	nodes.push({
		id: "branch",
		kind: "branch",
		title: deployment.branch || "No branch",
		subtitle: "Deployment branch",
		x: COLUMN_X.context,
		y: ROW_Y.middle,
		width: NODE_WIDTH,
		height: NODE_HEIGHT,
		data: {
			branch: deployment.branch || "not set",
			commit: scanResults.commit_sha ? scanResults.commit_sha.slice(0, 7) : "latest",
		},
	});
	edges.push({
		id: "branch-deploy-config",
		from: "branch",
		to: deployConfigId,
		kind: "input",
		label: "branch",
	});

	nodes.push({
		id: "env-vars",
		kind: "envVars",
		title: envCount > 0 ? `${envCount} variables` : "No env vars",
		subtitle: "Runtime configuration",
		x: COLUMN_X.context,
		y: ROW_Y.bottom,
		width: NODE_WIDTH,
		height: NODE_HEIGHT,
		data: {
			value: deployment.envVars || "",
			count: envCount,
			status: envCount > 0 ? "configured" : "empty",
		},
	});
	edges.push({
		id: "env-deploy-config",
		from: "env-vars",
		to: deployConfigId,
		kind: "input",
		label: "env vars",
	});

	if (primaryDockerfile) {
		const dockerfileContent = scanResults.dockerfiles?.[primaryDockerfile] || "";
		nodes.push({
			id: "dockerfile",
			kind: "dockerfile",
			title: primaryDockerfile,
			subtitle: "Build artifact",
			x: COLUMN_X.artifacts,
			y: ROW_Y.top,
			width: NODE_WIDTH,
			height: NODE_HEIGHT,
			data: {
				fileName: primaryDockerfile,
				buildContext: primaryService?.build_context || ".",
				content: dockerfileContent,
			},
		});
		edges.push({
			id: "dockerfile-service",
			from: "dockerfile",
			to: "service",
			kind: "reference",
			label: "builds",
		});
	}

	if (scanResults.docker_compose?.trim()) {
		nodes.push({
			id: "compose",
			kind: "compose",
			title: "docker-compose.yml",
			subtitle: "Compose artifact",
			x: COLUMN_X.artifacts,
			y: ROW_Y.middle,
			width: NODE_WIDTH,
			height: NODE_HEIGHT,
			data: {
				services: services.length || 1,
				included: "yes",
				content: scanResults.docker_compose,
			},
		});
		edges.push({
			id: "compose-deploy-config",
			from: "compose",
			to: deployConfigId,
			kind: "input",
			label: "artifact",
		});
		if (primaryDockerfile) {
			edges.push({
				id: "dockerfile-compose",
				from: "dockerfile",
				to: "compose",
				kind: "reference",
				label: "references",
			});
		}
	}

	if (scanResults.nginx_conf?.trim()) {
		nodes.push({
			id: "nginx",
			kind: "nginx",
			title: "nginx.conf",
			subtitle: "Routing artifact",
			x: COLUMN_X.artifacts,
			y: ROW_Y.bottom,
			width: NODE_WIDTH,
			height: NODE_HEIGHT,
			data: {
				present: "yes",
				content: scanResults.nginx_conf,
			},
		});
		edges.push({
			id: "nginx-deploy-config",
			from: "nginx",
			to: deployConfigId,
			kind: "input",
			label: "artifact",
		});
	}

	nodes.push({
		id: "infrastructure",
		kind: "infrastructure",
		title: `${deployment.cloudProvider.toUpperCase()} / ${deployment.deploymentTarget}`,
		subtitle: "Infrastructure target",
		x: COLUMN_X.infrastructure,
		y: 120,
		width: NODE_WIDTH,
		height: NODE_HEIGHT,
		data: {
			region: deployment.awsRegion || "",
			provider: deployment.cloudProvider,
			target: deployment.deploymentTarget,
			instanceType: deployment.ec2?.instanceType || DEFAULT_EC2_INSTANCE_TYPE,
		},
	});
	edges.push({
		id: "infrastructure-deploy-config",
		from: "infrastructure",
		to: deployConfigId,
		kind: "input",
		label: "infra",
	});

	nodes.push({
		id: "custom-domain",
		kind: "customDomain",
		title: deployment.liveUrl?.trim()
			? deployment.liveUrl.replace(/^https?:\/\//, "")
			: "No custom domain",
		subtitle: "Custom domain",
		x: COLUMN_X.infrastructure,
		y: 320,
		width: NODE_WIDTH,
		height: NODE_HEIGHT,
		data: {
			url: deployment.liveUrl || "",
		},
	});

	edges.push({
		id: "domain-deploy-config",
		from: "custom-domain",
		to: deployConfigId,
		kind: "input",
		label: "domain",
	});
	if (scanResults.nginx_conf?.trim()) {
		edges.push({
			id: "domain-nginx",
			from: "custom-domain",
			to: "nginx",
			kind: "reference",
			label: "uses",
		});
	}

	return {
		nodes,
		edges,
		issues: [],
		metrics: {
			serviceCount: services.length,
			publicEndpoints: deployment.liveUrl?.trim() ? 1 : 0,
			artifactCount,
		},
	};
}
