import type { DeploymentLogsModalPrefetched } from "@/components/DeploymentLogsModal";

export const deploymentHistoryStatusOptions = ["all", "success", "failed"] as const;
export const deploymentHistoryEnvOptions = ["all", "production", "staging", "development"] as const;

export type DeploymentHistoryTableState = {
	logsModal: {
		repoName: string;
		serviceName: string;
		prefetched?: DeploymentLogsModalPrefetched;
	} | null;
	query: string;
	statusFilter: (typeof deploymentHistoryStatusOptions)[number];
	envFilter: (typeof deploymentHistoryEnvOptions)[number];
	page: number;
};

export type DeploymentHistoryTableAction =
	| { type: "set_logs_modal"; value: DeploymentHistoryTableState["logsModal"] }
	| { type: "set_query"; value: string }
	| { type: "set_status_filter"; value: DeploymentHistoryTableState["statusFilter"] }
	| { type: "set_env_filter"; value: DeploymentHistoryTableState["envFilter"] }
	| { type: "set_page"; value: number };

export const initialDeploymentHistoryTableState: DeploymentHistoryTableState = {
	logsModal: null,
	query: "",
	statusFilter: "all",
	envFilter: "all",
	page: 1,
};

export function deploymentHistoryTableReducer(
	state: DeploymentHistoryTableState,
	action: DeploymentHistoryTableAction,
): DeploymentHistoryTableState {
	switch (action.type) {
		case "set_logs_modal":
			return { ...state, logsModal: action.value };
		case "set_query":
			return { ...state, query: action.value };
		case "set_status_filter":
			return { ...state, statusFilter: action.value };
		case "set_env_filter":
			return { ...state, envFilter: action.value };
		case "set_page":
			return { ...state, page: action.value };
		default:
			return state;
	}
}
