export type FeedbackProgressState = {
	activeNode: string;
	completedNodes: string[];
	failedNode: string | null;
	logs: string[];
	progress: number;
};

export const initialFeedbackProgressState: FeedbackProgressState = {
	activeNode: "clone_repo",
	completedNodes: [],
	failedNode: null,
	logs: [],
	progress: 0,
};

export type FeedbackProgressAction =
	| { type: "set_active_node"; value: string }
	| { type: "complete_node"; node: string; progress?: number }
	| { type: "increment_progress"; amount: number }
	| { type: "set_progress"; value: number }
	| { type: "set_failed_node"; value: string }
	| { type: "append_log"; message: string };

export function feedbackProgressReducer(
	state: FeedbackProgressState,
	action: FeedbackProgressAction
): FeedbackProgressState {
	switch (action.type) {
		case "set_active_node":
			return { ...state, activeNode: action.value };
		case "complete_node":
			return {
				...state,
				completedNodes: [...new Set([...state.completedNodes, action.node])],
				progress: action.progress ?? state.progress,
			};
		case "increment_progress":
			return { ...state, progress: Math.min(state.progress + action.amount, 95) };
		case "set_progress":
			return { ...state, progress: action.value };
		case "set_failed_node":
			return { ...state, failedNode: action.value };
		case "append_log":
			return { ...state, logs: [...state.logs, action.message] };
		default:
			return state;
	}
}
