/** Matches `POST /analyze/stream` progress `node` ids. See `sd-artifacts-integration.md` §3.2. */
export const SCAN_PROGRESS_NODES = [
	{ id: "scanner", label: "Scanner", desc: "Resolve commit and repo scope" },
	{ id: "clone_repo", label: "Clone repo", desc: "Check out repository at commit" },
	{ id: "classifier", label: "Classifier", desc: "Detect deploy shape and deploy units" },
	{ id: "railpack_prepare", label: "Railpack prepare", desc: "Generate Railpack build plan" },
	{ id: "deploy_briefing", label: "Deploy briefing", desc: "Operator summary (markdown)" },
	{ id: "railpack_build_repair", label: "Build & repair", desc: "Verify build; AI repair loop" },
	{ id: "finalize", label: "Finalize", desc: "Schema version and final build status" },
] as const;

export type ScanProgressState = {
	activeNode: string;
	completedNodes: string[];
	failedNode: string | null;
	logs: string[];
	progress: number;
};

export const initialScanProgressState: ScanProgressState = {
	activeNode: "scanner",
	completedNodes: [],
	failedNode: null,
	logs: [],
	progress: 0,
};

export type ScanProgressAction =
	| { type: "set_active_node"; node: string }
	| { type: "complete_node"; node: string }
	| { type: "set_failed_node"; node: string | null }
	| { type: "append_log"; message: string }
	| { type: "set_progress"; value: number };

export function scanProgressReducer(
	state: ScanProgressState,
	action: ScanProgressAction
): ScanProgressState {
	switch (action.type) {
		case "set_active_node":
			return { ...state, activeNode: action.node };
		case "complete_node": {
			const completedNodes = [...new Set([...state.completedNodes, action.node])];
			const nodeIndex = SCAN_PROGRESS_NODES.findIndex((n) => n.id === action.node);
			let progress = state.progress;
			if (nodeIndex >= 0) {
				progress = Math.round(((nodeIndex + 1) / SCAN_PROGRESS_NODES.length) * 100);
			} else if (typeof action.node === "string" && action.node) {
				progress = Math.min(state.progress + 2, 95);
			}
			return { ...state, completedNodes, progress };
		}
		case "set_failed_node":
			return { ...state, failedNode: action.node };
		case "append_log":
			return { ...state, logs: [...state.logs, action.message] };
		case "set_progress":
			return { ...state, progress: action.value };
		default:
			return state;
	}
}
