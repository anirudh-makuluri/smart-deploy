import type { BlueprintEdge, BlueprintInput, BlueprintModel, BlueprintNode } from "@/components/blueprint/blueprint-types";
import config from "@/config";
import { DEFAULT_EC2_INSTANCE_TYPE } from "@/lib/aws/ec2InstanceTypes";
import { validateBlueprint } from "@/components/blueprint/blueprint-validators";
import { isSdArtifactsAnalyzeScan } from "@/lib/scanResultNormalization";

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

function serviceNodeId(name: string) {
	return `service-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function envVarCount(raw: string | null | undefined) {
	if (!raw?.trim()) return 0;
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#")).length;
}

type BlueprintServiceRow = {
	name: string;
	framework?: string;
	language?: string;
	port?: number;
	build_context?: string;
	dockerfile_path?: string;
};

function blueprintServicesFromScan(scanResults: NonNullable<BlueprintInput["scanResults"]>): BlueprintServiceRow[] {
	if (isSdArtifactsAnalyzeScan(scanResults)) {
		return scanResults.deploy_units.map((unit) => ({
			name: unit.name,
			framework: unit.framework ?? undefined,
			language: unit.provider,
			port: unit.port,
			build_context: unit.root,
			dockerfile_path: unit.type === "existing_docker" ? "Dockerfile" : `railpack:${unit.name}`,
		}));
	}
	return [];
}

function buildArtifactSummary(scanResults: NonNullable<BlueprintInput["scanResults"]>) {
	if (isSdArtifactsAnalyzeScan(scanResults)) {
		const n = scanResults.deploy_units.length;
		return `${scanResults.deploy_shape} · ${n} unit${n === 1 ? "" : "s"} · Railpack`;
	}
	return "No analyze data";
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
	const services = blueprintServicesFromScan(scanResults);
	const isRailpackScan = isSdArtifactsAnalyzeScan(scanResults);
	const artifactCount = isRailpackScan ? scanResults.deploy_units.length : 0;
	const primaryService = services.find((service) => service.name === deployment.serviceName) ?? services[0];
	const primaryDockerfile = isRailpackScan ? primaryService?.dockerfile_path : undefined;
	const envCount = envVarCount(deployment.envVars);
	const deployConfigId = "deploy-config";
	const issues = validateBlueprint(deployment, scanResults);

	nodes.push({
		id: deployConfigId,
		kind: "deployConfig",
		title: deployment.serviceName || "Deployment",
		subtitle: buildArtifactSummary(scanResults),
		x: COLUMN_X.config,
		y: 200,
		width: HUB_WIDTH,
		height: NODE_HEIGHT + 24,
		data: {
			branch: deployment.branch || "",
			envCount,
			target: deployment.deploymentTarget,
		},
	});

	for (const service of services) {
		const id = serviceNodeId(service.name);
		nodes.push({
			id,
			kind: "service",
			title: service.name,
			subtitle: [service.framework, service.language].filter(Boolean).join(" · ") || "Service",
			x: COLUMN_X.context,
			y: services.length === 1 ? ROW_Y.middle : ROW_Y.top + services.indexOf(service) * 120,
			width: NODE_WIDTH,
			height: NODE_HEIGHT,
			data: {
				port: service.port,
				buildContext: service.build_context,
				dockerfile: service.dockerfile_path,
			},
		});
		edges.push({
			id: `${id}-deploy-config`,
			from: id,
			to: deployConfigId,
			kind: "input",
			label: "service",
		});
	}

	if (isRailpackScan && primaryService) {
		const unit = scanResults.deploy_units.find((u) => u.name === primaryService.name) ?? scanResults.deploy_units[0];
		nodes.push({
			id: "railpack-plan",
			kind: "dockerfile",
			title: unit?.name ? `railpack:${unit.name}` : "Railpack plan",
			subtitle: "Railpack build plan",
			x: COLUMN_X.artifacts,
			y: ROW_Y.top,
			width: NODE_WIDTH,
			height: NODE_HEIGHT,
			data: {
				fileName: primaryDockerfile || "railpack",
				buildContext: unit?.root || ".",
				content: unit?.artifacts.railpack_plan ? JSON.stringify(unit.artifacts.railpack_plan, null, 2) : "",
			},
		});
		edges.push({
			id: "railpack-service",
			from: "railpack-plan",
			to: serviceNodeId(primaryService.name),
			kind: "reference",
			label: "builds",
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

	return {
		nodes,
		edges,
		issues,
		metrics: {
			serviceCount: services.length,
			publicEndpoints: deployment.liveUrl?.trim() ? 1 : 0,
			artifactCount,
		},
	};
}
