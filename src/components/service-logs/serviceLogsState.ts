import type { KeywordRule, LogEntry, LogFilter, LogListState } from "@/components/service-logs/types";
import {
	emptyLogListState,
	loadKeywordRulesFromStorage,
	shouldShowFilterInputInitially,
} from "@/components/service-logs/serviceLogsUtils";

export type ServiceLogsState = {
	showScrollToBottom: boolean;
	selectedLog: LogEntry | null;
	logFilter: LogFilter;
	keywordRules: KeywordRule[];
	ruleInput: string;
	ruleMode: "include" | "exclude";
	showFilterInput: boolean;
	logListState: LogListState;
	isLoadingOlderLogs: boolean;
};

export function createInitialServiceLogsState(logScopeKey: string): ServiceLogsState {
	return {
		showScrollToBottom: false,
		selectedLog: null,
		logFilter: "ALL",
		keywordRules: loadKeywordRulesFromStorage(),
		ruleInput: "",
		ruleMode: "exclude",
		showFilterInput: shouldShowFilterInputInitially(),
		logListState: emptyLogListState(logScopeKey),
		isLoadingOlderLogs: false,
	};
}

export type ServiceLogsAction =
	| { type: "set_show_scroll_to_bottom"; value: boolean }
	| { type: "set_selected_log"; value: LogEntry | null }
	| { type: "set_log_filter"; value: LogFilter }
	| { type: "set_keyword_rules"; value: KeywordRule[] }
	| { type: "set_rule_input"; value: string }
	| { type: "set_rule_mode"; value: "include" | "exclude" }
	| { type: "toggle_show_filter_input" }
	| { type: "update_log_list_state"; updater: (current: LogListState) => LogListState; scopeKey: string }
	| { type: "set_is_loading_older_logs"; value: boolean };

export function serviceLogsReducer(state: ServiceLogsState, action: ServiceLogsAction): ServiceLogsState {
	switch (action.type) {
		case "set_show_scroll_to_bottom":
			return { ...state, showScrollToBottom: action.value };
		case "set_selected_log":
			return { ...state, selectedLog: action.value };
		case "set_log_filter":
			return { ...state, logFilter: action.value };
		case "set_keyword_rules":
			return { ...state, keywordRules: action.value };
		case "set_rule_input":
			return { ...state, ruleInput: action.value };
		case "set_rule_mode":
			return { ...state, ruleMode: action.value };
		case "toggle_show_filter_input":
			return { ...state, showFilterInput: !state.showFilterInput };
		case "update_log_list_state": {
			const current =
				state.logListState.scopeKey === action.scopeKey
					? state.logListState
					: emptyLogListState(action.scopeKey);
			return { ...state, logListState: action.updater(current) };
		}
		case "set_is_loading_older_logs":
			return { ...state, isLoadingOlderLogs: action.value };
		default:
			return state;
	}
}
