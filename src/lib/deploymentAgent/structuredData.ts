export type AgentDeploymentSummary = {
	repoName: string;
	serviceName: string;
	status: string;
	branch: string;
	deploymentTarget: string;
	lastDeployment: string | null;
	hostedUrl: string | null;
};

export type AgentDeployUnit = {
	name: string;
	type: string;
	framework: string | null;
	provider: string;
	port: number;
};

export type AgentDeploymentDetails = {
	repoName: string;
	serviceName: string;
	status: string;
	branch: string;
	commitSha: string | null;
	revision: number | null;
	deploymentTarget: string;
	region: string;
	hostedUrl: string | null;
	lastDeployment: string | null;
	scanResults: {
		deployShape: string | null;
		buildStatus: string | null;
		deployUnits: AgentDeployUnit[];
	};
};

export type AgentRuntimeHealthEntry = {
	checkedAt: string;
	appStatus: string;
	httpStatus: number | null;
	latencyMs: number | null;
	ecsStatus: string | null;
	rolloutState: string | null;
	healthyTargets: number | null;
	unhealthyTargets: number | null;
};

export type AgentHistoryEntry = {
	id: string;
	timestamp: string;
	success: boolean;
	branch: string | null;
	commitSha: string | null;
	failedStep: string | null;
	failureSummary: string | null;
	recentLogs: string[];
};

export type AgentStructuredDataBlock =
	| { kind: "deployment_list"; deployments: AgentDeploymentSummary[] }
	| { kind: "deployment_details"; deployment: AgentDeploymentDetails }
	| { kind: "runtime_health"; repoName: string; serviceName: string; entries: AgentRuntimeHealthEntry[] }
	| { kind: "deployment_history"; repoName: string; serviceName: string; history: AgentHistoryEntry[] };

export type AgentStructuredData = {
	blocks: AgentStructuredDataBlock[];
};

export const EMPTY_AGENT_STRUCTURED_DATA: AgentStructuredData = { blocks: [] };
