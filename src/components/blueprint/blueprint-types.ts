import type { DeployConfig, SDArtifactsResponse } from "@/app/types";

export type BlueprintNodeKind =
	| "deployConfig"
	| "service"
	| "branch"
	| "envVars"
	| "dockerfile"
	| "compose"
	| "nginx"
	| "customDomain"
	| "infrastructure";

export type BlueprintEdgeKind = "input" | "reference";

export type BlueprintNode = {
	id: string;
	kind: BlueprintNodeKind;
	title: string;
	subtitle?: string;
	x: number;
	y: number;
	width?: number;
	height?: number;
	data?: Record<string, string | number | boolean | null | undefined>;
};

export type BlueprintEdge = {
	id: string;
	from: string;
	to: string;
	kind: BlueprintEdgeKind;
	label?: string;
};

export type BlueprintValidationSeverity = "warning" | "info";

export type BlueprintValidationIssue = {
	id: string;
	nodeId?: string;
	severity: BlueprintValidationSeverity;
	title: string;
	description: string;
};

export type BlueprintModel = {
	nodes: BlueprintNode[];
	edges: BlueprintEdge[];
	issues: BlueprintValidationIssue[];
	metrics: {
		serviceCount: number;
		publicEndpoints: number;
		artifactCount: number;
	};
};

export type BlueprintInput = {
	deployment: DeployConfig;
	scanResults: SDArtifactsResponse | null;
};
