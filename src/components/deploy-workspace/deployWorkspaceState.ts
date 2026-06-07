import type { MenuSection } from "@/components/deploy-workspace/DeployWorkspaceMenu";
import type { FeedbackProgressPayload } from "@/components/FeedbackProgress";
import type { DeploymentHistoryEntry, ScanResultsPayload } from "@/app/types";
import { isSdArtifactsAnalyzeScan } from "@/lib/scanResultNormalization";

export type DeployWorkspaceUiState = {
	isDeploying: boolean;
	deployingCommitInfo: { sha: string; message: string; author: string; date: string } | null;
	activeSection: MenuSection;
	scanMode: "idle" | "scanning" | "results";
	scanResults: ScanResultsPayload | null;
	scanDuration: number;
	improveScanPayload: FeedbackProgressPayload | null;
	isSidebarCollapsed: boolean;
	isChangingDeploymentState: boolean;
	showRejectConfirm: boolean;
	showPauseResumeConfirm: boolean;
	showDeleteConfirm: boolean;
	showRollbackConfirm: boolean;
	rollbackEntry: DeploymentHistoryEntry | null;
};

export const initialDeployWorkspaceUiState: DeployWorkspaceUiState = {
	isDeploying: false,
	deployingCommitInfo: null,
	activeSection: "setup",
	scanMode: "idle",
	scanResults: null,
	scanDuration: 0,
	improveScanPayload: null,
	isSidebarCollapsed: false,
	isChangingDeploymentState: false,
	showRejectConfirm: false,
	showPauseResumeConfirm: false,
	showDeleteConfirm: false,
	showRollbackConfirm: false,
	rollbackEntry: null,
};

export type DeployWorkspaceUiAction =
	| { type: "set_deploying"; value: boolean }
	| { type: "set_deploying_commit_info"; value: DeployWorkspaceUiState["deployingCommitInfo"] }
	| { type: "set_active_section"; value: MenuSection }
	| { type: "set_scan_mode"; value: DeployWorkspaceUiState["scanMode"] }
	| { type: "set_scan_results"; value: ScanResultsPayload | null }
	| { type: "set_scan_duration"; value: number }
	| { type: "set_improve_scan_payload"; value: FeedbackProgressPayload | null }
	| { type: "toggle_sidebar_collapsed" }
	| { type: "set_changing_deployment_state"; value: boolean }
	| { type: "set_show_reject_confirm"; value: boolean }
	| { type: "set_show_pause_resume_confirm"; value: boolean }
	| { type: "set_show_delete_confirm"; value: boolean }
	| { type: "set_show_rollback_confirm"; value: boolean }
	| { type: "set_rollback_entry"; value: DeploymentHistoryEntry | null }
	| { type: "sync_deployment_scan"; scanResults: ScanResultsPayload | null | undefined; isDraft: boolean };

export function deployWorkspaceUiReducer(
	state: DeployWorkspaceUiState,
	action: DeployWorkspaceUiAction
): DeployWorkspaceUiState {
	switch (action.type) {
		case "set_deploying":
			return { ...state, isDeploying: action.value };
		case "set_deploying_commit_info":
			return { ...state, deployingCommitInfo: action.value };
		case "set_active_section":
			return { ...state, activeSection: action.value };
		case "set_scan_mode":
			return { ...state, scanMode: action.value };
		case "set_scan_results":
			return { ...state, scanResults: action.value };
		case "set_scan_duration":
			return { ...state, scanDuration: action.value };
		case "set_improve_scan_payload":
			return { ...state, improveScanPayload: action.value };
		case "toggle_sidebar_collapsed":
			return { ...state, isSidebarCollapsed: !state.isSidebarCollapsed };
		case "set_changing_deployment_state":
			return { ...state, isChangingDeploymentState: action.value };
		case "set_show_reject_confirm":
			return { ...state, showRejectConfirm: action.value };
		case "set_show_pause_resume_confirm":
			return { ...state, showPauseResumeConfirm: action.value };
		case "set_show_delete_confirm":
			return { ...state, showDeleteConfirm: action.value };
		case "set_show_rollback_confirm":
			return { ...state, showRollbackConfirm: action.value, rollbackEntry: action.value ? state.rollbackEntry : null };
		case "set_rollback_entry":
			return { ...state, rollbackEntry: action.value };
		case "sync_deployment_scan": {
			const nextSection = action.isDraft ? "setup" : "overview";
			if (isSdArtifactsAnalyzeScan(action.scanResults)) {
				return {
					...state,
					activeSection: nextSection,
					scanResults: action.scanResults,
					scanMode: "results",
				};
			}
			return {
				...state,
				activeSection: nextSection,
				scanResults: null,
				scanMode: "idle",
			};
		}
		default:
			return state;
	}
}
