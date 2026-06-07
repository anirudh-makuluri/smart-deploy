import type { DeployConfig, SDArtifactsResponse } from "@/app/types";

export type PreviewModeViewProps = {
	deployment: DeployConfig;
	scanResults: SDArtifactsResponse | null;
	branchOptions: string[];
	onUpdateDeployment: (partial: Partial<DeployConfig>) => Promise<void> | void;
	onUpdateScanResults: (updater: (current: SDArtifactsResponse) => SDArtifactsResponse) => Promise<void> | void;
};

export type Editor =
	| { kind: "branch" }
	| { kind: "compose" }
	| { kind: "dockerfile"; unitName?: string }
	| { kind: "infra" }
	| { kind: "envVars" }
	| { kind: "nginx" }
	| { kind: "customDomain" }
	| null;

export type HostedSubdomainStatus = {
	type: "success" | "error" | null;
	message?: string;
};

export type HostedSubdomainEditorState = {
	hostedSubdomain: string;
	draft: string;
	status: HostedSubdomainStatus;
};
